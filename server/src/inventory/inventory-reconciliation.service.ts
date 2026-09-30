import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { PG } from '../db/db.module';

@Injectable()
export class InventoryReconciliationService {
  constructor(@Inject(PG) private readonly db: Pool) {}

  async inspectProduct(c: PoolClient, shopId: string, productId: string, sourceDeviceId?: string, incomingDelta = 0, movementType = '') {
    if (!productId) return null;
    // stock_movement IDs are globally unique immutable business events. Summing their
    // quantity_delta values avoids last-write-wins on products.stock/stock_batches.
    const q = await c.query(`SELECT COALESCE(SUM((payload->>'quantity_delta')::numeric),0) quantity
      FROM entity_snapshots
      WHERE shop_id=$1 AND entity_type='stock_movement' AND deleted_at IS NULL
        AND payload->>'product_id'=$2`, [shopId, productId]);
    const quantity = Number(q.rows[0]?.quantity || 0);
    // Only auto-project products whose ledger was consistent immediately before
    // this newly accepted movement. This protects legacy shops whose historical
    // movement stream may contain duplicated bootstrap/audit rows.
    if (sourceDeviceId && quantity >= -0.000001) {
      await this.projectCanonicalInventory(c, shopId, productId, sourceDeviceId, quantity, incomingDelta);
    }
    const active = await c.query(`SELECT id,status FROM inventory_reconciliation_issues
      WHERE shop_id=$1 AND product_id=$2 AND issue_type='OVERSELL' AND status<>'RESOLVED'
      ORDER BY first_detected_at ASC LIMIT 1 FOR UPDATE`, [shopId, productId]);
    if (quantity < -0.000001) {
      if (active.rowCount) {
        await c.query(`UPDATE inventory_reconciliation_issues SET current_quantity=$1,last_detected_at=now() WHERE id=$2`, [quantity, active.rows[0].id]);
        return { issueId: active.rows[0].id, status: active.rows[0].status, productId, quantity };
      }
      const id = randomUUID();
      await c.query(`INSERT INTO inventory_reconciliation_issues
        (id,shop_id,product_id,issue_type,status,detected_quantity,current_quantity)
        VALUES($1,$2,$3,'OVERSELL','OPEN',$4,$4)`, [id,shopId,productId,quantity]);
      await c.query(`INSERT INTO inventory_reconciliation_activity(issue_id,shop_id,activity_type,note) VALUES($1,$2,'DETECTED',$3)`,[id,shopId,`Oversell detected at quantity ${quantity}`]);
      return { issueId:id,status:'OPEN',productId,quantity };
    }
    if (active.rowCount) {
      // A later purchase can make the arithmetic non-negative without explaining
      // the historical oversell. Keep the product quarantined until an explicit
      // physical-count reconciliation resolves the issue.
      await c.query(`UPDATE inventory_reconciliation_issues SET current_quantity=$1,last_detected_at=now() WHERE id=$2`,[quantity,active.rows[0].id]);
      return { issueId:active.rows[0].id,status:active.rows[0].status,productId,quantity,requiresPhysicalCount:true };
    }
    return { status:'OK',productId,quantity };
  }

  private async publishCanonicalSnapshot(c: PoolClient, shopId: string, sourceDeviceId: string, entityType: 'product'|'stock_batch', entityId: string, payload: any) {
    const current = await c.query(`SELECT version,payload FROM entity_snapshots
      WHERE shop_id=$1 AND entity_type=$2 AND entity_id=$3 FOR UPDATE`, [shopId,entityType,entityId]);
    const previous = current.rowCount ? (current.rows[0].payload || {}) : {};
    const field = entityType === 'product' ? 'stock' : 'remaining';
    if (Math.abs(Number(previous[field] || 0) - Number(payload[field] || 0)) <= 0.000001) return false;
    const version = Number(current.rows[0]?.version || 0) + 1;
    const merged = { ...previous, ...payload, id: entityId, version };
    const eventId = `srv_inventory_${randomUUID()}`;
    const occurredAt = new Date().toISOString();
    await c.query(`INSERT INTO sync_events(event_id,shop_id,device_id,entity_type,entity_id,operation,entity_version,occurred_at,payload)
      VALUES($1,$2,$3,$4,$5,'UPSERT',$6,$7,$8)`, [eventId,shopId,sourceDeviceId,entityType,entityId,version,occurredAt,merged]);
    await c.query(`INSERT INTO entity_snapshots(shop_id,entity_type,entity_id,version,payload,deleted_at,updated_at,source_device_id)
      VALUES($1,$2,$3,$4,$5,NULL,now(),$6)
      ON CONFLICT(shop_id,entity_type,entity_id) DO UPDATE SET version=excluded.version,payload=excluded.payload,deleted_at=NULL,updated_at=now(),source_device_id=excluded.source_device_id`, [shopId,entityType,entityId,version,merged,sourceDeviceId]);
    await c.query(`INSERT INTO sync_changes(shop_id,event_id,entity_type,entity_id,operation,entity_version,payload,occurred_at,source_device_id)
      VALUES($1,$2,$3,$4,'UPSERT',$5,$6,$7,$8)`, [shopId,eventId,entityType,entityId,version,merged,occurredAt,sourceDeviceId]);
    return true;
  }

  // Compatibility invariant: canonical projection publishes 'stock_batch', batchId snapshots.
  private async projectCanonicalInventory(c: PoolClient, shopId: string, productId: string, sourceDeviceId: string, quantity: number, incomingDelta: number) {
    const product = await c.query(`SELECT payload FROM entity_snapshots
      WHERE shop_id=$1 AND entity_type='product' AND entity_id=$2 AND deleted_at IS NULL`, [shopId,productId]);
    if (!product.rowCount) return;
    const projectedBefore = quantity - Number(incomingDelta || 0);
    const snapshotBefore = Number(product.rows[0].payload?.stock || 0);
    if (Math.abs(projectedBefore - snapshotBefore) > 0.000001) return;

    // The immutable movement stream is the authority. Product stock is a projection.
    await this.publishCanonicalSnapshot(c, shopId, sourceDeviceId, 'product', productId, { stock: Math.max(0, quantity) });

    const movementRows = await c.query(`SELECT payload FROM entity_snapshots
      WHERE shop_id=$1 AND entity_type='stock_movement' AND deleted_at IS NULL
        AND payload->>'product_id'=$2 ORDER BY payload->>'created_at' ASC, entity_id ASC`, [shopId,productId]);
    const movements = movementRows.rows.map((r:any)=>r.payload || {});
    let resetIndex = -1;
    for (let i=0;i<movements.length;i++) if (movements[i].movement_type === 'RECONCILIATION_COUNT') resetIndex=i;
    if (resetIndex >= 0) {
      const reset = movements[resetIndex];
      const meta = typeof reset.metadata === 'string' ? (()=>{try{return JSON.parse(reset.metadata)}catch{return {}}})() : (reset.metadata || {});
      const balances = new Map<string,number>();
      const baselineBatch = String(meta.reconciliation_batch_id || '');
      if (baselineBatch) balances.set(baselineBatch, Math.max(0, Number(meta.physical_count || 0)));
      for (const m of movements.slice(resetIndex+1)) {
        const batchId=String(m.batch_id || ''); if(!batchId) continue;
        balances.set(batchId, Number(balances.get(batchId)||0) + Number(m.quantity_delta||0));
      }
      const snapshots=await c.query(`SELECT entity_id FROM entity_snapshots WHERE shop_id=$1 AND entity_type='stock_batch' AND deleted_at IS NULL AND payload->>'product_id'=$2`,[shopId,productId]);
      for(const row of snapshots.rows){ const batchId=String(row.entity_id); await this.publishCanonicalSnapshot(c,shopId,sourceDeviceId,'stock_batch',batchId,{remaining:Math.max(0,Number(balances.get(batchId)||0))}); }
    } else {
      const balances = new Map<string,number>();
      for(const m of movements){ const batchId=String(m.batch_id||''); if(!batchId)continue; balances.set(batchId,Number(balances.get(batchId)||0)+Number(m.quantity_delta||0)); }
      for(const [batchId,balance] of balances) await this.publishCanonicalSnapshot(c,shopId,sourceDeviceId,'stock_batch',batchId,{remaining:Math.max(0,balance)});
    }
  }

  async resolveByPhysicalCount(shopId:string, issueId:string, deviceId:string, physicalQuantity:number, note?:string) {
    const physical=Number(physicalQuantity);
    if(!Number.isFinite(physical) || physical < 0) throw new BadRequestException('INVALID_PHYSICAL_QUANTITY');
    const c=await this.db.connect();
    try{
      await c.query('BEGIN');
      const device=await c.query('SELECT 1 FROM devices WHERE id=$1 AND shop_id=$2 AND revoked_at IS NULL FOR UPDATE',[deviceId,shopId]);
      if(!device.rowCount) throw new BadRequestException('DEVICE_NOT_REGISTERED_FOR_SHOP');
      const issueQ=await c.query(`SELECT * FROM inventory_reconciliation_issues WHERE id=$1 AND shop_id=$2 FOR UPDATE`,[issueId,shopId]);
      if(!issueQ.rowCount) throw new NotFoundException('RECONCILIATION_ISSUE_NOT_FOUND');
      const issue=issueQ.rows[0];
      const productId=String(issue.product_id);
      if(issue.status==='RESOLVED') {
        const resolvedPhysical=Number(issue.current_quantity);
        if(Math.abs(resolvedPhysical-physical) <= 0.000001) {
          // Network/client retries are expected. The first committed physical count
          // is authoritative; an identical retry must not create another movement.
          await c.query('COMMIT');
          return {success:true,issueId,productId,physicalQuantity:resolvedPhysical,status:'RESOLVED',alreadyResolved:true,idempotentReplay:true};
        }
        throw new ConflictException('RECONCILIATION_ALREADY_RESOLVED_DIFFERENT_PHYSICAL_COUNT');
      }
      const q=await c.query(`SELECT COALESCE(SUM((payload->>'quantity_delta')::numeric),0) quantity FROM entity_snapshots WHERE shop_id=$1 AND entity_type='stock_movement' AND deleted_at IS NULL AND payload->>'product_id'=$2`,[shopId,productId]);
      const authoritative=Number(q.rows[0]?.quantity||0);
      const delta=physical-authoritative;
      const productQ=await c.query(`SELECT payload FROM entity_snapshots WHERE shop_id=$1 AND entity_type='product' AND entity_id=$2 AND deleted_at IS NULL`,[shopId,productId]);
      if(!productQ.rowCount) throw new NotFoundException('PRODUCT_NOT_FOUND');
      const product=productQ.rows[0].payload||{};
      const now=new Date().toISOString();
      const batchId=physical>0?`batch_recon_${randomUUID()}`:'';
      {
        const movementId=`mov_recon_${randomUUID()}`; const eventId=`srv_inventory_${randomUUID()}`;
        const payload={id:movementId,shop_id:shopId,batch_id:null,metadata:{issue_id:issueId,physical_count:physical,previous_authoritative_quantity:authoritative,reconciliation_batch_id:batchId,reason:note||'Physical stock count'},device_id:deviceId,unit_cost:Number(product.buying_price||0),actor_name:'Owner',created_at:now,product_id:productId,reference_id:issueId,movement_type:'RECONCILIATION_COUNT',quantity_delta:delta,reference_type:'inventory_reconciliation'};
        await c.query(`INSERT INTO sync_events(event_id,shop_id,device_id,entity_type,entity_id,operation,entity_version,occurred_at,payload) VALUES($1,$2,$3,'stock_movement',$4,'UPSERT',1,$5,$6)`,[eventId,shopId,deviceId,movementId,now,payload]);
        await c.query(`INSERT INTO entity_snapshots(shop_id,entity_type,entity_id,version,payload,deleted_at,updated_at,source_device_id) VALUES($1,'stock_movement',$2,1,$3,NULL,now(),$4)`,[shopId,movementId,payload,deviceId]);
        await c.query(`INSERT INTO sync_changes(shop_id,event_id,entity_type,entity_id,operation,entity_version,payload,occurred_at,source_device_id) VALUES($1,$2,'stock_movement',$3,'UPSERT',1,$4,$5,$6)`,[shopId,eventId,movementId,payload,now,deviceId]);
      }
      await this.publishCanonicalSnapshot(c,shopId,deviceId,'product',productId,{stock:physical});
      const batches=await c.query(`SELECT entity_id FROM entity_snapshots WHERE shop_id=$1 AND entity_type='stock_batch' AND deleted_at IS NULL AND payload->>'product_id'=$2`,[shopId,productId]);
      for(const row of batches.rows) await this.publishCanonicalSnapshot(c,shopId,deviceId,'stock_batch',String(row.entity_id),{remaining:0});
      if(physical>0){
        await this.publishCanonicalSnapshot(c,shopId,deviceId,'stock_batch',batchId,{id:batchId,product_id:productId,quantity:physical,remaining:physical,buying_price:Number(product.buying_price||0),date:now,supplier_id:null,supplier_name:'Reconciliation',payment_method:null,account_id:null,account_label:null,account_number:null,updated_at:now,version:1});
      }
      await c.query(`UPDATE inventory_reconciliation_issues SET status='RESOLVED',current_quantity=$1,last_detected_at=now(),resolved_at=now(),resolution_note=$2 WHERE id=$3`,[physical,note||`Resolved by physical stock count: ${physical}`,issueId]);
      await c.query(`INSERT INTO inventory_reconciliation_activity(issue_id,shop_id,activity_type,note) VALUES($1,$2,'RESOLVED',$3)`,[issueId,shopId,`Physical count ${physical}; ledger correction ${delta>=0?'+':''}${delta}`]);
      await c.query('COMMIT');
      return {success:true,issueId,productId,previousAuthoritativeQuantity:authoritative,physicalQuantity:physical,adjustment:delta,status:'RESOLVED'};
    }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  }

  async list(shopId: string, includeResolved = false) {
    const q = await this.db.query(`SELECT i.id,i.product_id,i.issue_type,i.status,i.detected_quantity,i.current_quantity,
      i.first_detected_at,i.last_detected_at,i.acknowledged_at,i.resolved_at,i.resolution_note,
      COALESCE(p.payload->>'name',p.payload->>'product_name',i.product_id) AS product_name
      FROM inventory_reconciliation_issues i
      LEFT JOIN entity_snapshots p ON p.shop_id=i.shop_id AND p.entity_type='product' AND p.entity_id=i.product_id AND p.deleted_at IS NULL WHERE i.shop_id=$1 ${includeResolved ? '' : "AND i.status<>'RESOLVED'"}
      ORDER BY CASE i.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END,last_detected_at DESC`, [shopId]);
    return { issues:q.rows };
  }


  async details(shopId:string, issueId:string) {
    const issue=await this.db.query(`SELECT i.*,COALESCE(p.payload->>'name',p.payload->>'product_name',i.product_id) product_name
      FROM inventory_reconciliation_issues i LEFT JOIN entity_snapshots p ON p.shop_id=i.shop_id AND p.entity_type='product' AND p.entity_id=i.product_id AND p.deleted_at IS NULL
      WHERE i.id=$1 AND i.shop_id=$2`,[issueId,shopId]);
    if(!issue.rowCount) throw new Error('RECONCILIATION_ISSUE_NOT_FOUND');
    const productId=issue.rows[0].product_id;
    const movements=await this.db.query(`SELECT e.event_id,e.device_id,d.name device_name,e.occurred_at,e.payload,
        e.payload->>'movement_type' movement_type,e.payload->>'reference_type' reference_type,e.payload->>'reference_id' reference_id,
        COALESCE((e.payload->>'quantity_delta')::numeric,0) quantity_delta
      FROM sync_events e LEFT JOIN devices d ON d.id=e.device_id
      WHERE e.shop_id=$1 AND e.entity_type='stock_movement' AND e.payload->>'product_id'=$2
      ORDER BY e.occurred_at DESC,e.received_at DESC LIMIT 100`,[shopId,productId]);
    const activity=await this.db.query(`SELECT id,activity_type,note,created_at FROM inventory_reconciliation_activity WHERE issue_id=$1 AND shop_id=$2 ORDER BY created_at DESC,id DESC`,[issueId,shopId]);
    return { issue:issue.rows[0], movements:movements.rows, activity:activity.rows };
  }

  async acknowledge(shopId:string, issueId:string, note?:string) {
    const q=await this.db.query(`UPDATE inventory_reconciliation_issues
      SET status=CASE WHEN status='OPEN' THEN 'ACKNOWLEDGED' ELSE status END,
          acknowledged_at=CASE WHEN status='OPEN' THEN now() ELSE acknowledged_at END,
          resolution_note=COALESCE($3,resolution_note)
      WHERE id=$1 AND shop_id=$2 RETURNING id,product_id,status,current_quantity`,[issueId,shopId,note||null]);
    if (!q.rowCount) throw new Error('RECONCILIATION_ISSUE_NOT_FOUND');
    await this.db.query(`INSERT INTO inventory_reconciliation_activity(issue_id,shop_id,activity_type,note) VALUES($1,$2,'ACKNOWLEDGED',$3)`,[issueId,shopId,note||'Issue acknowledged for investigation']);
    return q.rows[0];
  }
}
