const { db } = require('./db');
const { preflightLegacyRepair } = require('./legacyInventoryGuard');

const ENTITY_TABLES = Object.freeze({
  product: 'products', sale: 'sales', credit_sale: 'credit_sales',
  credit_sale_item: 'credit_sale_items', credit_payment: 'credit_sale_payments',
  expenditure: 'expenditures', supplier: 'suppliers', supplier_payment: 'supplier_payments',
  staff: 'staff', order: 'orders', order_item: 'order_items', stock_batch: 'stock_batches', stock_movement: 'stock_movements',
});

function meta(key) {
  return db.prepare('SELECT value FROM system_meta WHERE key=?').pluck().get(key) || null;
}
function identity() { return { shopId: meta('shop_id'), deviceId: meta('device_id'), protocolVersion: 1 }; }
function getLocalBusinessFootprint() {
  const tables = ['products','sales','credit_sales','expenditures','suppliers','staff','orders','stock_batches','stock_movements'];
  const counts = {};
  let total = 0;
  for (const table of tables) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const n = exists ? Number(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() || 0) : 0;
    counts[table] = n; total += n;
  }
  const pendingOutbox = Number(db.prepare(`SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL AND dead_lettered_at IS NULL`).pluck().get() || 0);
  return { total, pendingOutbox, counts, fresh: total === 0 && pendingOutbox === 0 };
}
function bindFreshLocalShopToCloud(cloudShopId) {
  const shopId = String(cloudShopId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shopId)) {
    const e = new Error('CLOUD_SHOP_ID_INVALID'); e.code = 'CLOUD_SHOP_ID_INVALID'; throw e;
  }
  const footprint = getLocalBusinessFootprint();
  if (!footprint.fresh) {
    const e = new Error(`CLOUD_SHOP_BIND_REQUIRES_EMPTY_LOCAL_DATABASE: local business data=${footprint.total}, pending=${footprint.pendingOutbox}`);
    e.code = 'CLOUD_SHOP_BIND_REQUIRES_EMPTY_LOCAL_DATABASE'; e.footprint = footprint; throw e;
  }
  const current = meta('shop_id');
  if (current === shopId) return { changed:false, shopId, footprint };
  db.transaction(() => {
    setMeta('shop_id', shopId);
    setMeta('sync_pull_cursor', '0');
    setMeta('cloud_sync_requires_adoption', '0');
    setMeta('cloud_shop_bound_at', new Date().toISOString());
  })();
  return { changed:true, previousShopId:current, shopId, footprint };
}
function getFirstSyncSafety() {
  const pending = db.prepare(`SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL AND dead_lettered_at IS NULL`).pluck().get() || 0;
  const requiresAdoption = meta('cloud_sync_requires_adoption') === '1' && pending > 0;
  return { requiresAdoption, pending, code: requiresAdoption ? 'CLOUD_EXISTING_DATA_ADOPTION_REQUIRED' : null };
}
function safeParse(value) { try { return value ? JSON.parse(value) : null; } catch { return null; } }
function rowSnapshot(entityType, entityId) {
  const table = ENTITY_TABLES[entityType];
  if (!table) return null;
  return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(entityId) || null;
}
function envelope(row) {
  const ident = identity();
  const snapshot = row.operation === 'DELETE' ? null : rowSnapshot(row.entity_type, row.entity_id);
  const stored = safeParse(row.payload);
  let deletion = row.operation === 'DELETE' ? row : null;
  if (!deletion && !snapshot && !stored) {
    // The outbox stores references, not historical snapshots. A later deletion
    // proves that this missing UPSERT is obsolete, even across upload pages.
    // Keep every event ID and acknowledge only after the server accepts it.
    deletion = db.prepare(`SELECT * FROM sync_outbox
      WHERE entity_type=? AND entity_id=? AND operation='DELETE' AND id>?
      ORDER BY id DESC LIMIT 1`).get(row.entity_type, row.entity_id, row.id);
    if (!deletion) {
      const error = new Error('SYNC_MISSING_ENTITY_PAYLOAD: ' + row.entity_type + ':' + row.entity_id);
      error.code = 'SYNC_MISSING_ENTITY_PAYLOAD';
      throw error;
    }
  }
  return {
    protocolVersion: 1,
    eventId: row.event_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: deletion ? 'DELETE' : 'UPSERT',
    shopId: row.shop_id || ident.shopId,
    deviceId: row.device_id || ident.deviceId,
    occurredAt: row.created_at,
    entityVersion: deletion?.entity_version ?? snapshot?.version ?? row.entity_version ?? null,
    payload: deletion ? null : (snapshot || stored),
    tombstone: deletion ? { id: row.entity_id, deletedAt: deletion.created_at } : null,
  };
}

function setMeta(key, value) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO system_meta(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, String(value ?? ''), now);
}
function getPullCursor() { return meta('sync_pull_cursor') || '0'; }
function markSyncAttempt(error = null) {
  setMeta('last_sync_attempt_at', new Date().toISOString());
  if (error) setMeta('last_sync_error', String(error).slice(0,1000));
  else setMeta('last_sync_error', '');
}
function markSyncSuccess() {
  const now = new Date().toISOString();
  setMeta('last_successful_sync_at', now);
  setMeta('last_sync_error', '');
  return now;
}

function recordConflicts(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return { recorded:0 };
  const stmt=db.prepare(`INSERT INTO sync_conflicts(event_id,entity_type,entity_id,local_version,server_version,server_payload,code,detected_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET server_version=excluded.server_version,server_payload=excluded.server_payload,code=excluded.code,detected_at=excluded.detected_at`);
  let n=0; db.transaction(()=>{ for(const r of rows){ stmt.run(r.eventId,r.entityType||null,r.entityId||null,r.localVersion??null,r.serverVersion??null,JSON.stringify(r.serverPayload??null),r.code||'CONFLICT',new Date().toISOString()); n++; } })();
  return { recorded:n };
}
function getConflicts(limit=100) {
  const take=Math.max(1,Math.min(500,Number(limit)||100));
  return db.prepare(`SELECT * FROM sync_conflicts ORDER BY detected_at DESC LIMIT ?`).all(take).map(r=>({...r,server_payload:safeParse(r.server_payload)}));
}
function tableColumns(table) { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name)); }
function normalizeRemoteChange(raw = {}) {
  // PostgreSQL currently emits snake_case. Accept camelCase too so the desktop
  // protocol boundary is explicit and a server serializer change cannot silently
  // turn a valid remote event into a skipped event.
  return {
    seq: raw.seq ?? raw.cursor ?? null,
    eventId: raw.event_id ?? raw.eventId ?? null,
    sourceDeviceId: raw.source_device_id ?? raw.sourceDeviceId ?? raw.device_id ?? raw.deviceId ?? null,
    entityType: raw.entity_type ?? raw.entityType ?? null,
    entityId: raw.entity_id ?? raw.entityId ?? null,
    operation: String(raw.operation || '').toUpperCase(),
    entityVersion: raw.entity_version ?? raw.entityVersion ?? null,
    payload: raw.payload ?? null,
  };
}
function applyRemoteChanges(changes = [], cursor = null) {
  if (!Array.isArray(changes)) {
    const e = new Error('SYNC_PULL_INVALID_CHANGES'); e.code = 'SYNC_PULL_INVALID_CHANGES'; throw e;
  }
  let applied=0, skipped=0, own=0;
  const ident = identity();
  db.transaction(()=>{
    preflightLegacyRepair(db, changes, ident);
    const maxBefore=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM sync_outbox').get().id || 0;
    const inboxHas=db.prepare('SELECT 1 FROM sync_inbox WHERE event_id=?');
    const localOutboxHas=db.prepare('SELECT 1 FROM sync_outbox WHERE event_id=?');
    const insertInbox=db.prepare(`INSERT INTO sync_inbox(event_id,source_device_id,entity_type,entity_id,operation,entity_version,cursor,applied_at) VALUES(?,?,?,?,?,?,?,?)`);
    for(const raw of changes){
      const c=normalizeRemoteChange(raw);
      if (!c.eventId || !c.entityType || !c.entityId || !['UPSERT','DELETE'].includes(c.operation)) {
        const e = new Error(`SYNC_PULL_MALFORMED_CHANGE: ${c.eventId || 'missing-event-id'}`); e.code='SYNC_PULL_MALFORMED_CHANGE'; e.change=raw; throw e;
      }
      if (inboxHas.get(c.eventId)) { skipped++; continue; }

      // A change sourced from this device is safe to consume only if this local
      // database knows the originating outbox event. Otherwise two installations
      // are sharing a device identity; advancing the cursor would silently lose
      // the other installation's data.
      const serverInventoryProjection = String(c.eventId || '').startsWith('srv_inventory_');
      if (c.sourceDeviceId && c.sourceDeviceId === ident.deviceId && !serverInventoryProjection) {
        if (!localOutboxHas.get(c.eventId)) {
          const e = new Error(`CLOUD_DEVICE_ID_COLLISION: server event ${c.eventId} claims this device id but is absent from the local outbox`);
          e.code='CLOUD_DEVICE_ID_COLLISION'; e.eventId=c.eventId; e.deviceId=ident.deviceId; throw e;
        }
        insertInbox.run(c.eventId,c.sourceDeviceId,c.entityType,c.entityId,c.operation,c.entityVersion,String(c.seq??cursor??''),new Date().toISOString());
        own++; continue;
      }

      const table=ENTITY_TABLES[c.entityType];
      if (!table) {
        const e = new Error(`SYNC_PULL_UNSUPPORTED_ENTITY: ${c.entityType}`); e.code='SYNC_PULL_UNSUPPORTED_ENTITY'; e.entityType=c.entityType; throw e;
      }
      if (c.operation==='DELETE') db.prepare(`DELETE FROM ${table} WHERE id=?`).run(c.entityId);
      else {
        const payload=(c.payload && typeof c.payload==='object' && !Array.isArray(c.payload)) ? {...c.payload} : {};
        const cols=tableColumns(table); const keys=Object.keys(payload).filter(k=>cols.has(k));
        if (!keys.includes('id') && cols.has('id')) { payload.id=c.entityId; keys.unshift('id'); }
        if (!keys.length) {
          const e = new Error(`SYNC_PULL_EMPTY_PAYLOAD: ${c.entityType}/${c.entityId}`); e.code='SYNC_PULL_EMPTY_PAYLOAD'; throw e;
        }
        const q=keys.map(()=>'?').join(','); const updates=keys.filter(k=>k!=='id').map(k=>`${k}=excluded.${k}`).join(',');
        const sql=updates ? `INSERT INTO ${table}(${keys.join(',')}) VALUES(${q}) ON CONFLICT(id) DO UPDATE SET ${updates}` : `INSERT OR IGNORE INTO ${table}(${keys.join(',')}) VALUES(${q})`;

        // Applying a remote stock_batch fires the local inventory audit triggers.
        // Those triggers are correct for a LOCAL purchase/update, but during pull
        // the authoritative stock_movement arrives as its own immutable event.
        // Capture the batch's movement IDs before the upsert and remove only the
        // synthetic movement(s) created by this remote write, preventing duplicate
        // inventory while preserving all pre-existing ledger events.
        let movementIdsBefore = null;
        if (c.entityType === 'stock_batch') {
          movementIdsBefore = new Set(db.prepare('SELECT id FROM stock_movements WHERE batch_id=?').all(c.entityId).map(r=>r.id));
        }
        // PostgreSQL JSON payloads can contain nested objects/arrays (for example
        // stock_movement.metadata). better-sqlite3 only binds scalar SQLite values,
        // so preserve JSON fields as TEXT at the local database boundary.
        const values = keys.map(k => {
          const value = payload[k];
          return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
        });
        db.prepare(sql).run(...values);
        if (movementIdsBefore) {
          const generated = db.prepare('SELECT id FROM stock_movements WHERE batch_id=?').all(c.entityId).filter(r=>!movementIdsBefore.has(r.id));
          const delMovement = db.prepare('DELETE FROM stock_movements WHERE id=?');
          for (const r of generated) delMovement.run(r.id);
        }
      }
      insertInbox.run(c.eventId,c.sourceDeviceId,c.entityType,c.entityId,c.operation,c.entityVersion,String(c.seq??cursor??''),new Date().toISOString());
      applied++;
    }
    // Remote writes fire the same local outbox triggers as user writes. Remove only
    // trigger rows created by this isolated transaction to prevent sync echo loops.
    db.prepare('DELETE FROM sync_outbox WHERE id > ?').run(maxBefore);
    // Cursor advancement is deliberately the LAST write in this transaction.
    // Any malformed/unapplicable change above throws, rolling back entity writes,
    // inbox receipts, trigger cleanup, and the cursor together.
    if (cursor != null) setMeta('sync_pull_cursor', String(cursor));
  })();
  return { received:changes.length, applied, skipped, own, cursor:getPullCursor() };
}
function replaceReconciliationIssues(issues=[]) {
  if (!Array.isArray(issues)) issues=[];
  const now=new Date().toISOString();
  db.transaction(()=>{
    db.prepare('DELETE FROM reconciliation_cache').run();
    const ins=db.prepare('INSERT INTO reconciliation_cache(id,payload,status,product_id,last_detected_at,cached_at) VALUES(?,?,?,?,?,?)');
    for(const x of issues) ins.run(String(x.id),JSON.stringify(x),x.status||null,x.product_id||null,x.last_detected_at||null,now);
  })();
  return { count:issues.length };
}
function getCachedReconciliationIssues() { return db.prepare('SELECT payload FROM reconciliation_cache ORDER BY last_detected_at DESC').all().map(r=>safeParse(r.payload)).filter(Boolean); }

function getSyncStatus() {
  const counts = db.prepare(`SELECT
    SUM(CASE WHEN synced_at IS NULL AND dead_lettered_at IS NULL THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN synced_at IS NOT NULL THEN 1 ELSE 0 END) synced,
    SUM(CASE WHEN dead_lettered_at IS NOT NULL THEN 1 ELSE 0 END) deadLetter,
    COALESCE(MAX(attempts),0) maxAttempts
    FROM sync_outbox`).get();
  const safety = getFirstSyncSafety();
  return { ...identity(), ...safety, pending: counts.pending || 0, synced: counts.synced || 0, deadLetter: counts.deadLetter || 0, maxAttempts: counts.maxAttempts || 0, lastSuccessfulSyncAt: meta('last_successful_sync_at') };
}

function leasePendingEvents({ limit = 100, leaseSeconds = 60 } = {}) {
  const safety = getFirstSyncSafety();
  if (safety.requiresAdoption) { const e = new Error(`CLOUD_EXISTING_DATA_ADOPTION_REQUIRED: ${safety.pending} existing local events are waiting. Automatic first upload is blocked.`); e.code=safety.code; e.pending=safety.pending; throw e; }
  limit = Math.max(1, Math.min(500, Number(limit) || 100));
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + Math.max(15, leaseSeconds) * 1000).toISOString();
  const token = `lease_${require('crypto').randomUUID()}`;
  const rows = db.transaction(() => {
    const selected = db.prepare(`SELECT * FROM sync_outbox
      WHERE synced_at IS NULL AND dead_lettered_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
      ORDER BY id ASC LIMIT ?`).all(now.toISOString(), now.toISOString(), limit);
    const lock = db.prepare('UPDATE sync_outbox SET lease_token=?, lease_expires_at=? WHERE id=?');
    for (const r of selected) lock.run(token, leaseUntil, r.id);
    return selected.map(envelope);
  })();
  return { leaseToken: token, leaseExpiresAt: leaseUntil, events: rows };
}

function acknowledgeEvents(leaseToken, eventIds) {
  if (!leaseToken || !Array.isArray(eventIds) || !eventIds.length) return { acknowledged: 0 };
  const now = new Date().toISOString();
  const stmt = db.prepare(`UPDATE sync_outbox SET synced_at=?, last_error=NULL, lease_token=NULL, lease_expires_at=NULL
    WHERE event_id=? AND lease_token=? AND synced_at IS NULL`);
  let acknowledged = 0;
  db.transaction(() => {
    for (const id of eventIds) acknowledged += stmt.run(now, id, leaseToken).changes;
    if (acknowledged) db.prepare(`INSERT INTO system_meta(key,value,updated_at) VALUES('last_successful_sync_at',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(now, now);
  })();
  return { acknowledged };
}

function failEvents(leaseToken, failures = []) {
  if (!leaseToken || !Array.isArray(failures)) return { failed: 0 };
  const get = db.prepare('SELECT attempts FROM sync_outbox WHERE event_id=? AND lease_token=? AND synced_at IS NULL');
  const update = db.prepare(`UPDATE sync_outbox SET attempts=?, last_error=?, next_attempt_at=?, lease_token=NULL, lease_expires_at=NULL,
    dead_lettered_at=? WHERE event_id=? AND lease_token=? AND synced_at IS NULL`);
  let failed = 0;
  db.transaction(() => {
    for (const f of failures) {
      const row = get.get(f.eventId, leaseToken); if (!row) continue;
      const attempts = row.attempts + 1;
      const permanent = Boolean(f.permanent) || attempts >= 12;
      const delaySeconds = Math.min(3600, 5 * (2 ** Math.min(attempts - 1, 9)));
      const next = permanent ? null : new Date(Date.now() + delaySeconds * 1000).toISOString();
      failed += update.run(attempts, String(f.error || 'SYNC_FAILED').slice(0, 1000), next, permanent ? new Date().toISOString() : null, f.eventId, leaseToken).changes;
    }
  })();
  return { failed };
}

function releaseLease(leaseToken) {
  return { released: db.prepare(`UPDATE sync_outbox SET lease_token=NULL, lease_expires_at=NULL WHERE lease_token=? AND synced_at IS NULL`).run(leaseToken).changes };
}

module.exports = { identity, getLocalBusinessFootprint, bindFreshLocalShopToCloud, getFirstSyncSafety, getSyncStatus, leasePendingEvents, acknowledgeEvents, failEvents, releaseLease, getPullCursor, markSyncAttempt, markSyncSuccess, recordConflicts, getConflicts, applyRemoteChanges, replaceReconciliationIssues, getCachedReconciliationIssues };
