const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(options = {}) {
  let session = { baseUrl: 'http://test', accessToken: 'expired', refreshToken: 'r0', user: { id: 'owner' } };
  let validRefresh = 'r0', validAccess = 'a0', refreshes = 0, pending = 1, cursor = '0', success = false, releases = 0;
  const calls = [];
  const store = { getSession: () => structuredClone(session), saveSession: s => { session = { ...session, ...s }; }, publicSession: () => ({}), clearSession: () => { session = {}; } };
  const sync = {
    identity: () => ({ shopId: 'shop2', deviceId: 'device2' }),
    getFirstSyncSafety: () => ({ requiresAdoption: false }),
    leasePendingEvents: () => ({ leaseToken: 'lease', events: pending ? [{ eventId: 'event1', entityType: 'staff', entityId: 'staff1' }] : [] }),
    acknowledgeEvents: (_, ids) => { if (ids.includes('event1')) pending = 0; },
    recordConflicts: () => {}, failEvents: () => {}, releaseLease: () => { releases++; },
    markSyncAttempt: () => {}, markSyncSuccess: () => { success = true; },
    getSyncStatus: () => ({ pending }), getPullCursor: () => cursor,
    applyRemoteChanges: (_, next) => { cursor = next; return { applied: 0, cursor, received: 0, own: 0, skipped: 0 }; },
    replaceReconciliationIssues: () => ({ count: 0 })
  };
  const response = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const fetch = async (url, args) => {
    const u = new URL(url); const body = args.body ? JSON.parse(args.body) : null;
    calls.push({ path: u.pathname, auth: args.headers.authorization, body });
    if (u.pathname.endsWith('/auth/refresh')) {
      refreshes++;
      if (options.logoutDuringRefresh) store.clearSession();
      if (options.rejectRefresh || body.refreshToken !== validRefresh) return response(401, { message: 'INVALID_REFRESH_TOKEN' });
      validRefresh = `r${refreshes}`; validAccess = `a${refreshes}`;
      await new Promise(resolve => setTimeout(resolve, 5));
      return response(200, { accessToken: validAccess, refreshToken: validRefresh });
    }
    if (options.networkFailure) throw new Error('fetch failed');
    if (options.forbidden) return response(403, { message: 'SHOP_ACCESS_DENIED' });
    if (args.headers.authorization !== `Bearer ${validAccess}`) return response(401, { message: 'EXPIRED' });
    if (u.pathname.endsWith('/sync/push')) {
      assert.equal(body.shopId, 'shop2'); assert.equal(body.deviceId, 'device2');
      return response(200, { results: [{ eventId: 'event1', status: 'ACK' }] });
    }
    if (u.pathname.endsWith('/sync/pull')) {
      if (options.expireOnPull && cursor === '0' && !options.didExpire) {
        options.didExpire = true; validAccess = 'expired-again'; return response(401, { message: 'EXPIRED' });
      }
      const first = cursor === '0';
      return response(200, { changes: [], cursor: first ? '1' : '2', hasMore: first });
    }
    return response(200, { shops: [], issues: [] });
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/cloudSyncClient.js'), 'utf8'), {
    module, require: name => name === './syncService' ? sync : store,
    process: { env: {} }, fetch, AbortSignal, console
  });
  return { api: module.exports, state: () => ({ session, refreshes, pending, success, releases, calls }) };
}

(async () => {
  const f = fixture(); const first = await f.api.triggerSync();
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(first.pushed, 1); assert.equal(first.cursor, '2');
  assert.equal(f.state().refreshes, 1); assert.equal(f.state().pending, 0);
  assert.equal((await f.api.triggerSync()).pushed, 0);
  console.log('PASS: expired registration token, pending upload, paginated pull, repeat sync');

  const pages = fixture({ expireOnPull: true });
  assert.equal((await pages.api.triggerSync()).success, true);
  assert.equal(pages.state().refreshes, 2);
  console.log('PASS: token rotation during paginated pull');

  const concurrent = fixture();
  await Promise.all([concurrent.api.listShops(), concurrent.api.getOwnerOverview(), concurrent.api.triggerSync()]).then(r => assert.equal(r[2].success, true));
  assert.equal(concurrent.state().refreshes, 1);
  console.log('PASS: concurrent requests share one refresh');

  for (const options of [{ rejectRefresh: true }, { networkFailure: true }, { forbidden: true }]) {
    const bad = fixture(options); assert.equal((await bad.api.triggerSync()).success, false);
    assert.equal(bad.state().pending, 1); assert.equal(bad.state().success, false);
    if (!options.rejectRefresh) assert.equal(bad.state().refreshes, 0);
  }
  console.log('PASS: invalid refresh, network failure and forbidden access retain pending event');

  const logout = fixture({ logoutDuringRefresh: true });
  assert.equal((await logout.api.triggerSync()).success, false);
  assert.deepEqual(logout.state().session, {});
  assert.equal(logout.state().pending, 1);
  console.log('PASS: logout during refresh cannot restore the old session');
})().catch(e => { console.error(e); process.exitCode = 1; });
