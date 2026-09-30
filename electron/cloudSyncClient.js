const sync = require('./syncService');
const sessionStore = require('./cloudSession');

let running = null;
const DEFAULT_CLOUD_BASE_URL = String(process.env.HISAFLOW_CLOUD_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
function cloudBaseUrl(value) { return String(value || DEFAULT_CLOUD_BASE_URL).trim().replace(/\/$/, ''); }
function timeoutSignal(ms = 15000) { return AbortSignal.timeout(Math.max(1000, ms)); }
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: timeoutSignal(options.timeout || 15000), headers: { 'content-type':'application/json', ...(options.headers||{}) } });
  const text = await response.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!response.ok) {
    const raw = body?.message ?? body?.error ?? body?.code ?? `HTTP_${response.status}`;
    const detail = Array.isArray(raw) ? raw.join(', ') : (typeof raw === 'object' ? (raw.code || raw.message || JSON.stringify(raw)) : String(raw));
    const code = body?.code || (typeof body?.error === 'object' ? body.error?.code : null) || (typeof raw === 'string' && /^[A-Z0-9_]+$/.test(raw) ? raw : null);
    const e = new Error(code ? `${code}: ${detail}` : detail); e.status = response.status; e.code = code || null; e.body = body; throw e;
  }
  return body;
}
// Refresh tokens rotate once. All callers in this Electron process must share
// a refresh and re-read the saved session instead of reusing a captured token.
let refreshInFlight = null;
function currentSession(expected) {
  const current = sessionStore.getSession();
  if (!current?.baseUrl || !current?.refreshToken) {
    const e = new Error('CLOUD_NOT_CONFIGURED'); e.code = 'CLOUD_NOT_CONFIGURED'; e.status = 401; throw e;
  }
  if (expected && (current.baseUrl !== expected.baseUrl || current.user?.id !== expected.user?.id)) {
    const e = new Error('CLOUD_SESSION_CHANGED'); e.code = 'CLOUD_SESSION_CHANGED'; throw e;
  }
  return current;
}
async function refresh(session) {
  const current = currentSession(session);
  // Another request may already have completed token rotation.
  if (current.refreshToken !== session.refreshToken) return current;
  if (refreshInFlight && refreshInFlight.baseUrl === current.baseUrl && refreshInFlight.token === current.refreshToken) {
    return refreshInFlight.promise;
  }
  const flight = { baseUrl: current.baseUrl, token: current.refreshToken };
  flight.promise = (async () => {
    const r = await jsonRequest(`${current.baseUrl}/api/v1/auth/refresh`, { method:'POST', body:JSON.stringify({ refreshToken:current.refreshToken }) });
    const latest = currentSession(current);
    // Do not overwrite a new login or restore a session cleared during refresh.
    if (latest.refreshToken !== current.refreshToken) return latest;
    sessionStore.saveSession({ ...latest, ...r });
    return sessionStore.getSession();
  })();
  refreshInFlight = flight;
  try { return await flight.promise; }
  finally { if (refreshInFlight === flight) refreshInFlight = null; }
}
async function authorized(session, path, options = {}) {
  const active = currentSession(session);
  const run = s => jsonRequest(`${s.baseUrl}/api/v1${path}`, { ...options, headers:{ ...(options.headers||{}), authorization:`Bearer ${s.accessToken}` } });
  try { return await run(active); }
  catch (e) {
    if (e.status !== 401) throw e;
    const latest = currentSession(active);
    const next = latest.accessToken !== active.accessToken || latest.refreshToken !== active.refreshToken
      ? latest : await refresh(active);
    return run(next); // One bounded retry; genuine authentication failures surface.
  }
}
async function login({ baseUrl, email, password }) {
  const clean = cloudBaseUrl(baseUrl);
  const r = await jsonRequest(`${clean}/api/v1/auth/login`, { method:'POST', body:JSON.stringify({ email,password }) });
  sessionStore.saveSession({ baseUrl:clean, ...r });
  const session = sessionStore.getSession();
  const mine = await authorized(session, '/shops/mine');
  const shops = mine?.shops || [];
  sessionStore.saveSession({ memberships: shops });
  const ident = sync.identity();
  const already = shops.find(x => x.id === ident.shopId);
  let binding = null;
  let bootstrap = null;
  if (!already && shops.length === 1 && sync.getLocalBusinessFootprint().fresh) {
    binding = sync.bindFreshLocalShopToCloud(shops[0].id);
    await registerDevice();
    const pulled = await pull(sessionStore.getSession());
    const reconciliation = await refreshReconciliation(sessionStore.getSession());
    sync.markSyncSuccess();
    bootstrap = { pulled, reconciliation };
  }
  return { ...sessionStore.publicSession(), shops, binding, bootstrap, needsShopSelection: !already && shops.length > 1 && sync.getLocalBusinessFootprint().fresh };
}
async function joinShop(shopId) {
  const s = sessionStore.getSession();
  const mine = await authorized(s, '/shops/mine');
  const shops = mine?.shops || [];
  if (!shops.some(x => x.id === shopId)) { const e=new Error('SHOP_ACCESS_DENIED'); e.code='SHOP_ACCESS_DENIED'; throw e; }
  const binding = sync.bindFreshLocalShopToCloud(shopId);
  await registerDevice();
  const pulled = await pull(sessionStore.getSession());
  const reconciliation = await refreshReconciliation(sessionStore.getSession());
  sync.markSyncSuccess();
  return { success:true, binding, identity:sync.identity(), pulled, reconciliation };
}
async function register(payload) {
  const clean = cloudBaseUrl(payload.baseUrl);
  const ident = sync.identity();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(ident.shopId||''))) {
    const e = new Error('LOCAL_SHOP_ID_INVALID: restart HisaFlow so database migration 22 can repair the cloud identity'); e.code='LOCAL_SHOP_ID_INVALID'; throw e;
  }
  const r = await jsonRequest(`${clean}/api/v1/auth/register`, { method:'POST', body:JSON.stringify({ ...payload, shopId: ident.shopId }) });
  sessionStore.saveSession({ baseUrl:clean, ...r }); return sessionStore.publicSession();
}
async function registerDevice(name = 'HisaFlow Desktop') {
  const s = sessionStore.getSession(); const ident = sync.identity();
  const options = { method:'POST', body:JSON.stringify({ shopId:ident.shopId, deviceId:ident.deviceId, name }) };
  try { return await authorized(s, '/devices/register', options); }
  catch (error) {
    // Only recover a stale shop claim after the server confirms live membership.
    // Other 403s (including device revocation) must remain failures.
    if (error.status !== 403 || error.code !== 'SHOP_ACCESS_DENIED') throw error;
    const mine = await authorized(currentSession(s), '/shops/mine');
    if (!(mine?.shops || []).some(shop => shop.id === ident.shopId)) throw error;
    await refreshShopAccess(s, ident.shopId);
    return authorized(currentSession(s), '/devices/register', options);
  }
}
async function push(session) {
  const safety = sync.getFirstSyncSafety();
  if (safety.requiresAdoption) { const e=new Error(`CLOUD_EXISTING_DATA_ADOPTION_REQUIRED: ${safety.pending} existing local events will not be uploaded automatically.`); e.code=safety.code; e.pending=safety.pending; throw e; }
  const leased = sync.leasePendingEvents({ limit:100, leaseSeconds:90 });
  if (!leased.events.length) return { pushed:0, conflicts:0, failed:0 };
  try {
    const ident = sync.identity();
    const r = await authorized(session, '/sync/push', { method:'POST', body:JSON.stringify({ shopId:ident.shopId, deviceId:ident.deviceId, events:leased.events }) });
    const ack = [], failures = [], conflictRows = []; let conflicts = 0;
    for (const x of r.results || []) {
      if (x.status === 'ACK') ack.push(x.eventId);
      else if (x.status === 'CONFLICT') {
        conflicts++;
        // A conflict is terminal for this exact local event. Persist it for audit/UI,
        // ACK the event so it cannot retry forever, then pull the authoritative server state.
        ack.push(x.eventId);
        const original=leased.events.find(e=>e.eventId===x.eventId) || {};
        conflictRows.push({ eventId:x.eventId, entityType:original.entityType, entityId:original.entityId, localVersion:original.entityVersion, serverVersion:x.serverVersion, serverPayload:x.serverPayload, code:x.code||'CONFLICT' });
      } else failures.push({ eventId:x.eventId, error:x.code||x.status, permanent:x.status==='REJECTED' });
    }
    sync.recordConflicts(conflictRows); sync.acknowledgeEvents(leased.leaseToken, ack); sync.failEvents(leased.leaseToken, failures);
    return { pushed:ack.length, conflicts, failed:failures.length };
  } catch (e) { sync.releaseLease(leased.leaseToken); throw e; }
}
async function pull(session) {
  const ident = sync.identity(); let total=0, loops=0;
  while (loops++ < 20) {
    const cursor = sync.getPullCursor();
    const r = await authorized(session, `/sync/pull?shopId=${encodeURIComponent(ident.shopId)}&deviceId=${encodeURIComponent(ident.deviceId)}&after=${encodeURIComponent(cursor)}&limit=200`);
    // Pass the complete ordered server page to the transactional applier. It
    // validates/records own-device events and rejects suspicious device-id
    // collisions instead of filtering first and then advancing past lost data.
    const page = Array.isArray(r.changes) ? r.changes : [];
    const result = sync.applyRemoteChanges(page, r.cursor);
    total += result.applied;
    if (!r.hasMore) return { pulled:total, cursor:result.cursor, received:result.received, own:result.own, skipped:result.skipped };
  }
  return { pulled:total, cursor:sync.getPullCursor(), hasMore:true };
}
async function refreshReconciliation(session) {
  const ident=sync.identity();
  const r=await authorized(session, `/inventory/reconciliation/issues?shopId=${encodeURIComponent(ident.shopId)}`);
  return sync.replaceReconciliationIssues(r.issues || []);
}

async function getReconciliationIssues() { const s=sessionStore.getSession(),ident=sync.identity(); return authorized(s, `/inventory/reconciliation/issues?shopId=${encodeURIComponent(ident.shopId)}`); }
async function getReconciliationDetails(issueId) { const s=sessionStore.getSession(),ident=sync.identity(); return authorized(s, `/inventory/reconciliation/details?shopId=${encodeURIComponent(ident.shopId)}&issueId=${encodeURIComponent(issueId)}`); }
async function acknowledgeReconciliation(issueId,note='') { const s=sessionStore.getSession(),ident=sync.identity(); const r=await authorized(s, '/inventory/reconciliation/acknowledge', {method:'POST',body:JSON.stringify({shopId:ident.shopId,issueId,note})}); await refreshReconciliation(sessionStore.getSession()); return r; }
async function resolveReconciliation(issueId,physicalQuantity,note='') {
  const s=sessionStore.getSession(),ident=sync.identity();
  const r=await authorized(s, '/inventory/reconciliation/resolve', {method:'POST',body:JSON.stringify({shopId:ident.shopId,issueId,deviceId:ident.deviceId,physicalQuantity,note})});
  await pull(sessionStore.getSession());
  await refreshReconciliation(sessionStore.getSession());
  sync.markSyncSuccess();
  return r;
}

async function listShops() { const s=sessionStore.getSession(); return authorized(s, '/shops/mine'); }
async function getOwnerOverview() { const s=sessionStore.getSession(); return authorized(s, '/shops/overview'); }
async function refreshShopAccess(expected, shopId) {
  let next = await refresh(currentSession(expected));
  const includesShop = session => (session.memberships || []).some(m => (m.shopId || m.id) === shopId);
  // A shared refresh may have started before the shop creation committed.
  if (!includesShop(next)) next = await refresh(currentSession(expected));
  if (!includesShop(next)) throw new Error('SHOP_ACCESS_REFRESH_REQUIRED');
  return next;
}
async function createShop(name) {
  const s = currentSession();
  const result = await authorized(s, '/shops', {method:'POST',body:JSON.stringify({name})});
  // Creation has committed. A subsequent refresh failure must not look like a
  // failed creation and invite another POST of the same shop.
  try {
    if (!result?.shop?.id) throw new Error('SHOP_CREATION_RESPONSE_INVALID');
    await refreshShopAccess(s, result.shop.id);
    return {...result, accessReady:true};
  } catch (error) {
    return {...result, accessReady:false, accessCode:'SHOP_ACCESS_REFRESH_REQUIRED'};
  }
}
async function renameShop(shopId,name) { const s=sessionStore.getSession(); return authorized(s, `/shops/${encodeURIComponent(shopId)}`, {method:'PATCH',body:JSON.stringify({name})}); }
async function getSyncHistory(limit=100) { const s=sessionStore.getSession(),ident=sync.identity(); return authorized(s, `/sync/history?shopId=${encodeURIComponent(ident.shopId)}&limit=${encodeURIComponent(limit)}`); }
async function listDevices() { const s=sessionStore.getSession(),ident=sync.identity(); return authorized(s, `/devices?shopId=${encodeURIComponent(ident.shopId)}`); }
async function renameDevice(deviceId,name) { const s=sessionStore.getSession(),ident=sync.identity(); return authorized(s, '/devices/rename', {method:'POST',body:JSON.stringify({shopId:ident.shopId,deviceId,name})}); }
async function revokeDevice(deviceId) { const s=sessionStore.getSession(),ident=sync.identity(); return authorized(s, '/devices/revoke', {method:'POST',body:JSON.stringify({shopId:ident.shopId,deviceId})}); }
async function storefront(action, payload = {}) {
  const allowed = {get:['GET',''], catalog:['GET','/catalog'], save:['POST','/draft'], preview:['POST','/preview'], publish:['POST','/publish'], unpublish:['POST','/unpublish']};
  if (!allowed[action]) throw new Error('STOREFRONT_ACTION_INVALID');
  if (action === 'publish') {
    const status=sync.getSyncStatus();
    if(status.pending||status.deadLetter)throw new Error('STOREFRONT_SYNC_FIRST');
  }
  const session=currentSession(),shopId=sync.identity().shopId;
  const [method,suffix]=allowed[action];
  const body=method==='POST'?JSON.stringify({draft:payload.draft,revision:payload.revision}):undefined;
  const result=await authorized(session,'/storefront/manage/'+encodeURIComponent(shopId)+suffix,{method,body});
  if(action==='get')return {...result,shopId,publicUrl:session.baseUrl+'/api/v1/storefront/public/'+encodeURIComponent(shopId)};
  return result;
}
async function triggerSync() {
  if (running) return running;
  running = (async()=>{
    const s = sessionStore.getSession(); if (!s.baseUrl || !s.refreshToken) return { success:false, reason:'not_configured' };
    sync.markSyncAttempt();
    try { await registerDevice(); const p=await push(sessionStore.getSession()); const fresh=sessionStore.getSession(); const q=await pull(fresh); const reconciliation=await refreshReconciliation(sessionStore.getSession()); sync.markSyncSuccess(); return { success:true, ...p, ...q, reconciliation, status:sync.getSyncStatus() }; }
    catch(e) { sync.markSyncAttempt(e.message||e); return { success:false, reason:'sync_failed', error:String(e.message||e), status:sync.getSyncStatus() }; }
    finally { running=null; }
  })();
  return running;
}
module.exports = { storefront, login, register, joinShop, registerDevice, triggerSync, listShops, getOwnerOverview, createShop, renameShop, getSyncHistory, listDevices, renameDevice, revokeDevice, getReconciliationIssues, getReconciliationDetails, acknowledgeReconciliation, resolveReconciliation, publicSession:sessionStore.publicSession, clearSession:sessionStore.clearSession };
