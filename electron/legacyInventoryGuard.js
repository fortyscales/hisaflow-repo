// Scoped guard for the reviewed v2.3.6 legacy repair, not a general stock reset.
const SHOP = '148a56f7-94af-402b-99fc-ccb843d5ed17';
const REPAIR = 'legacy_inventory_236_20260926';
const history = [
  {
    "id": "mov_0d09a8161e27714f1f4b24b7aa2b4a02",
    "product_id": "p_1789897128841_nvkhvf",
    "batch_id": "batch_1789897128842_o68xat",
    "movement_type": "PURCHASE",
    "quantity_delta": 350,
    "unit_cost": 1200000,
    "reference_type": "stock_batch",
    "reference_id": "batch_1789897128842_o68xat",
    "created_at": "2026-09-20T09:38:48.842Z"
  },
  {
    "id": "mov_0e2559b0f4a14393bf9f6d27013262cf",
    "product_id": "p_1789833480567_kypwwz",
    "batch_id": "batch_repair_p_1789833480567_kypwwz_77w2a5",
    "movement_type": "SALE",
    "quantity_delta": -1,
    "unit_cost": 700,
    "reference_type": "sale",
    "reference_id": "s_5a05321e-d32f-4eb3-83f5-fb8e9f3f20a9",
    "created_at": "2026-09-20T10:09:56.932Z"
  },
  {
    "id": "mov_1a8b2a2102f9197904b383460440d86f",
    "product_id": "p_1789833480567_kypwwz",
    "batch_id": "batch_1789833480568_6ge828",
    "movement_type": "SALE",
    "quantity_delta": -1,
    "unit_cost": 700,
    "reference_type": "sale",
    "reference_id": "s_a1d8c5b8-8f5f-4b06-83b2-dc4cb6a74df4",
    "created_at": "2026-09-20T09:58:56.598Z"
  },
  {
    "id": "mov_372c3548658514688d0f63947348fb8c",
    "product_id": "p_1789897128841_nvkhvf",
    "batch_id": "batch_1789897128842_o68xat",
    "movement_type": "SALE",
    "quantity_delta": -1,
    "unit_cost": 1200000,
    "reference_type": "sale",
    "reference_id": "s_f64cedfd-f2ed-4da8-b2b8-ee5f704f2897",
    "created_at": "2026-09-20T10:09:52.293Z"
  },
  {
    "id": "mov_47de17abb32bb667efdd5288cd352ec9",
    "product_id": "p_1789833480567_kypwwz",
    "batch_id": "batch_1789833480568_6ge828",
    "movement_type": "PURCHASE",
    "quantity_delta": 10,
    "unit_cost": 700,
    "reference_type": "stock_batch",
    "reference_id": "batch_1789833480568_6ge828",
    "created_at": "2026-09-19T15:58:00.568Z"
  },
  {
    "id": "mov_9d332dd50ae7e60d77ffe52d2782a889",
    "product_id": "p_1789897128841_nvkhvf",
    "batch_id": "batch_1789897128842_o68xat",
    "movement_type": "SALE",
    "quantity_delta": -11,
    "unit_cost": 1200000,
    "reference_type": "sale",
    "reference_id": "s_af47174a-0cf5-4cd5-8206-5ef9f90e42a5",
    "created_at": "2026-09-20T09:39:06.387Z"
  },
  {
    "id": "mov_acb7def28747f815e4788fd071b3e5c8",
    "product_id": "p_1789897128841_nvkhvf",
    "batch_id": "batch_1789897128842_o68xat",
    "movement_type": "SALE",
    "quantity_delta": -1,
    "unit_cost": 1200000,
    "reference_type": "credit_sale",
    "reference_id": "cs_2b1c2d91-d29b-4777-b4c0-6a20af2ee06e",
    "created_at": "2026-09-20T09:39:35.490Z"
  },
  {
    "id": "mov_c70c793d8f45d51dc0e919072411c463",
    "product_id": "p_1789833480567_kypwwz",
    "batch_id": "batch_repair_p_1789833480567_kypwwz_77w2a5",
    "movement_type": "PURCHASE",
    "quantity_delta": 10,
    "unit_cost": 700,
    "reference_type": "stock_batch",
    "reference_id": "batch_repair_p_1789833480567_kypwwz_77w2a5",
    "created_at": "2026-09-19T15:58:00.567Z"
  },
  {
    "id": "mov_4d0f6dea938f1f75bbc3dd3e9d3f75d4",
    "product_id": "p_1789833480567_kypwwz",
    "batch_id": "batch_repair_p_1789833480567_kypwwz_2fa8z0",
    "movement_type": "PURCHASE",
    "quantity_delta": 9,
    "unit_cost": 700,
    "reference_type": "stock_batch",
    "reference_id": "batch_repair_p_1789833480567_kypwwz_2fa8z0",
    "created_at": "2026-09-19T15:58:00.567Z"
  },
  {
    "id": "mov_264157c8ce1679469f9e5a9508e5fd24",
    "product_id": "p_1789897128841_nvkhvf",
    "batch_id": "batch_repair_p_1789897128841_nvkhvf_xji4q0",
    "movement_type": "PURCHASE",
    "quantity_delta": 337,
    "unit_cost": 1200000,
    "reference_type": "stock_batch",
    "reference_id": "batch_repair_p_1789897128841_nvkhvf_xji4q0",
    "created_at": "2026-09-20T09:38:48.842Z"
  }
];
function preflightLegacyRepair(db, changes, identity) {
  const repairs = changes.filter(c => String(c.eventId || c.event_id || '').startsWith(`srv_inventory_${REPAIR}_`));
  if (!repairs.length) return;
  if (identity.shopId !== SHOP) throw new Error('LEGACY_REPAIR_WRONG_SHOP');
  const pids = new Set(repairs.map(c => c.payload?.product_id || (c.entityType === 'product' || c.entity_type === 'product' ? (c.entityId || c.entity_id) : null)).filter(Boolean));
  for (const pid of pids) {
    if (!history.some(m => m.product_id === pid)) throw new Error('LEGACY_REPAIR_UNKNOWN_PRODUCT');
    if (db.prepare('SELECT 1 FROM stock_movements WHERE id=?').get(`mov_${REPAIR}_${pid}`)) continue;
    if (db.prepare('SELECT count(*) n FROM sync_outbox WHERE synced_at IS NULL').get().n) throw new Error('LEGACY_REPAIR_PENDING_EVENTS: stop and inspect before receiving repair');
    for (const local of db.prepare('SELECT * FROM stock_movements WHERE product_id=?').all(pid)) {
      const expected = history.find(m => m.id === local.id);
      if (!expected || Object.keys(expected).some(k => (expected[k] ?? null) !== (local[k] ?? null))) {
        throw new Error(`LEGACY_REPAIR_LOCAL_HISTORY_CHANGED: ${local.id}`);
      }
    }
    const known = new Set(history.filter(m => m.product_id === pid).map(m => m.batch_id));
    // Two synced snapshot-only repairs have no corresponding historical movement.
    known.add(pid === 'p_1789833480567_kypwwz' ? 'batch_repair_p_1789833480567_kypwwz_xey1cd' : 'batch_repair_p_1789897128841_nvkhvf_d5960l');
    known.add(`batch_${REPAIR}_${pid}`);
    for (const b of db.prepare('SELECT id,remaining FROM stock_batches WHERE product_id=?').all(pid)) {
      if (!known.has(b.id) && Number(b.remaining) !== 0) throw new Error(`LEGACY_REPAIR_UNKNOWN_ACTIVE_BATCH: ${b.id}`);
    }
  }
}
module.exports = { preflightLegacyRepair };
