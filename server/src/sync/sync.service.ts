import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG } from '../db/db.module';
import { SyncEnvelope } from './sync.dto';
import { InventoryReconciliationService } from '../inventory/inventory-reconciliation.service';

const allowedEntities = new Set(['product','sale','credit_sale','credit_sale_item','credit_payment','expenditure','supplier','supplier_payment','staff','order','order_item','stock_batch','stock_movement']);
function validate(e: SyncEnvelope) {
  if (e.protocolVersion !== 1) throw new BadRequestException('UNSUPPORTED_SYNC_PROTOCOL');
  if (!e.eventId || !e.entityId || !e.shopId || !e.deviceId) throw new BadRequestException('INVALID_SYNC_ENVELOPE');
  if (!allowedEntities.has(e.entityType)) throw new BadRequestException('UNSUPPORTED_ENTITY_TYPE');
  if (!['UPSERT','DELETE'].includes(e.operation)) throw new BadRequestException('INVALID_SYNC_OPERATION');
}
@Injectable()
export class SyncService {
  constructor(@Inject(PG) private readonly db: Pool, private readonly inventory: InventoryReconciliationService) {}
  async push(shopId: string, deviceId: string, events: SyncEnvelope[]) {
    if (!Array.isArray(events) || events.length > 500) throw new BadRequestException('INVALID_BATCH_SIZE');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // A JWT membership is not enough: the physical device must be registered to this shop.
      const registered = await client.query('SELECT 1 FROM devices WHERE id=$1 AND shop_id=$2 AND revoked_at IS NULL FOR UPDATE', [deviceId, shopId]);
      if (!registered.rowCount) throw new ForbiddenException('DEVICE_NOT_REGISTERED_FOR_SHOP');
      await client.query('UPDATE devices SET last_seen_at=now() WHERE id=$1 AND shop_id=$2', [deviceId, shopId]);
      const results = [] as any[];
      for (const e of events) results.push(await this.applyOne(client, shopId, deviceId, e));
      await client.query('COMMIT');
      return { protocolVersion: 1, results };
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  }
  private async applyOne(c: PoolClient, shopId: string, deviceId: string, e: SyncEnvelope) {
    validate(e);
    if (e.shopId !== shopId || e.deviceId !== deviceId) return { eventId: e.eventId, status: 'REJECTED', code: 'IDENTITY_MISMATCH' };
    const prior = await c.query('SELECT event_id FROM sync_events WHERE event_id=$1', [e.eventId]);
    if (prior.rowCount) return { eventId: e.eventId, status: 'ACK', duplicate: true };
    const current = await c.query('SELECT version,deleted_at,payload,source_device_id FROM entity_snapshots WHERE shop_id=$1 AND entity_type=$2 AND entity_id=$3 FOR UPDATE', [shopId,e.entityType,e.entityId]);
    // A reviewed legacy reset supersedes repair snapshots, not real purchases.
    // Reject attempts by an older device to resurrect these synthetic artifacts.
    const productId = String(e.entityType==='product' ? e.entityId : (e.payload?.product_id || current.rows[0]?.payload?.product_id || ''));
    if (productId && ['product','stock_batch','stock_movement'].includes(e.entityType)) {
      const repaired = await c.query(`SELECT 1 FROM entity_snapshots WHERE shop_id=$1 AND entity_type='stock_movement'
        AND deleted_at IS NULL AND payload->>'product_id'=$2
        AND payload->'metadata'->>'maintenance_id'='legacy_inventory_236_20260926' LIMIT 1`, [shopId,productId]);
      if (repaired.rowCount) {
        if (e.entityType==='product' && e.operation==='UPSERT' && current.rowCount) {
          // Product stock is projected by accepted movements after the repair.
          // An old device's cached product snapshot cannot restore a stale total.
          e = {...e,payload:{...e.payload,stock:current.rows[0].payload.stock}};
        }
        if (e.entityType==='stock_batch' && e.entityId.startsWith('batch_repair_')) {
          return {eventId:e.eventId,status:'CONFLICT',code:'LEGACY_REPAIR_SUPERSEDED',serverVersion:Number(current.rows[0]?.version||0),serverPayload:current.rows[0]?.payload||null};
        }
        if (e.entityType==='stock_movement' && current.rowCount) {
          const fields=['id','product_id','batch_id','movement_type','quantity_delta','unit_cost','reference_type','reference_id','created_at'];
          const identical=e.operation==='UPSERT' && fields.every(k => (e.payload?.[k]??null)===(current.rows[0].payload?.[k]??null));
          return identical ? {eventId:e.eventId,status:'ACK',duplicate:true} : {eventId:e.eventId,status:'REJECTED',code:'REPAIRED_HISTORY_IMMUTABLE'};
        }
        if (e.entityType==='stock_movement' && e.payload?.movement_type==='PURCHASE' && String(e.payload?.batch_id||'').startsWith('batch_repair_')) {
          return {eventId:e.eventId,status:'REJECTED',code:'LEGACY_SYNTHETIC_PURCHASE_BLOCKED'};
        }
      }
    }
    const incoming = Number(e.entityVersion || 1);
    const currentVersion = current.rowCount ? Number(current.rows[0].version) : 0;
    if (currentVersion > incoming) return { eventId: e.eventId, status: 'CONFLICT', code: 'STALE_VERSION', serverVersion: currentVersion, serverPayload: current.rows[0].deleted_at ? null : current.rows[0].payload };
    if (currentVersion > 0 && currentVersion === incoming && current.rows[0].source_device_id !== deviceId) return { eventId: e.eventId, status: 'CONFLICT', code: 'CONCURRENT_VERSION', serverVersion: currentVersion, serverPayload: current.rows[0].deleted_at ? null : current.rows[0].payload };
    await c.query(`INSERT INTO sync_events(event_id,shop_id,device_id,entity_type,entity_id,operation,entity_version,occurred_at,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [e.eventId,shopId,deviceId,e.entityType,e.entityId,e.operation,incoming,e.occurredAt,e.payload || e.tombstone || null]);
    await c.query(`INSERT INTO entity_snapshots(shop_id,entity_type,entity_id,version,payload,deleted_at,updated_at,source_device_id)
      VALUES($1,$2,$3,$4,$5,$6,now(),$7)
      ON CONFLICT(shop_id,entity_type,entity_id) DO UPDATE SET version=excluded.version,payload=excluded.payload,deleted_at=excluded.deleted_at,updated_at=now(),source_device_id=excluded.source_device_id`,
      [shopId,e.entityType,e.entityId,incoming,e.operation==='DELETE'?null:(e.payload||{}),e.operation==='DELETE'?(e.tombstone?.deletedAt || e.occurredAt):null,deviceId]);
    const change = await c.query(`INSERT INTO sync_changes(shop_id,event_id,entity_type,entity_id,operation,entity_version,payload,occurred_at,source_device_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING seq`, [shopId,e.eventId,e.entityType,e.entityId,e.operation,incoming,e.operation==='DELETE'?(e.tombstone||null):(e.payload||{}),e.occurredAt,deviceId]);
    if (e.entityType === 'stock_movement' && e.operation === 'UPSERT' && e.payload?.product_id) {
      await this.inventory.inspectProduct(c, shopId, String(e.payload.product_id), deviceId, Number(e.payload.quantity_delta || 0), String(e.payload.movement_type || ''));
    }
    return { eventId: e.eventId, status: 'ACK', cursor: String(change.rows[0].seq) };
  }
  async history(shopId: string, limit = 100) {
    const take = Math.max(1, Math.min(250, Number(limit)||100));
    const q = await this.db.query(`SELECT e.event_id,e.device_id,d.name AS device_name,e.entity_type,e.entity_id,e.operation,e.entity_version,e.occurred_at,e.received_at
      FROM sync_events e LEFT JOIN devices d ON d.id=e.device_id AND d.shop_id=e.shop_id
      WHERE e.shop_id=$1 ORDER BY e.received_at DESC LIMIT $2`, [shopId,take]);
    return { ok:true, events:q.rows };
  }
  async pull(shopId: string, deviceId: string, after: number, limit = 200) {
    if (!deviceId) throw new BadRequestException('DEVICE_ID_REQUIRED');
    const client = await this.db.connect();
    try {
      const registered = await client.query('SELECT 1 FROM devices WHERE id=$1 AND shop_id=$2 AND revoked_at IS NULL', [deviceId, shopId]);
      if (!registered.rowCount) throw new ForbiddenException('DEVICE_NOT_REGISTERED_FOR_SHOP');
      await client.query('UPDATE devices SET last_seen_at=now(),updated_at=now() WHERE id=$1 AND shop_id=$2', [deviceId, shopId]);
      const take = Math.max(1, Math.min(500, Number(limit)||200));
      const q = await client.query(`SELECT seq,event_id,entity_type,entity_id,operation,entity_version,payload,occurred_at,source_device_id
        FROM sync_changes WHERE shop_id=$1 AND seq>$2 ORDER BY seq ASC LIMIT $3`, [shopId, Math.max(0,Number(after)||0), take]);
      const cursor = q.rows.length ? String(q.rows[q.rows.length-1].seq) : String(Math.max(0,Number(after)||0));
      return { protocolVersion: 1, cursor, hasMore: q.rows.length === take, changes: q.rows };
    } finally { client.release(); }
  }
}
