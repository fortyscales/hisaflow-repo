const assert = require('node:assert/strict');
const expected = require('./expected-server.json');
const SHOP = '148a56f7-94af-402b-99fc-ccb843d5ed17';
const DEVICE = '0b64c2bc-5bda-47bf-b15e-972235d784a4';
const REPAIR = 'legacy_inventory_236_20260926';
const products = [
  { id:'p_1789833480567_kypwwz', name:'test-cola', before:9, target:8, cost:700, localLedger:27,
    extra:{id:'mov_4d0f6dea938f1f75bbc3dd3e9d3f75d4',batch:'batch_repair_p_1789833480567_kypwwz_2fa8z0',delta:9},
    sales:['s_5a05321e-d32f-4eb3-83f5-fb8e9f3f20a9','s_a1d8c5b8-8f5f-4b06-83b2-dc4cb6a74df4'] },
  { id:'p_1789897128841_nvkhvf', name:'iphone 18 pro max', before:337, target:337, cost:1200000, localLedger:674,
    extra:{id:'mov_264157c8ce1679469f9e5a9508e5fd24',batch:'batch_repair_p_1789897128841_nvkhvf_xji4q0',delta:337},
    sales:['s_f64cedfd-f2ed-4da8-b2b8-ee5f704f2897','s_af47174a-0cf5-4cd5-8206-5ef9f90e42a5'] }
];
const movementFields = ['id','product_id','batch_id','movement_type','quantity_delta','unit_cost','reference_type','reference_id','created_at'];
function same(a,b,fields,label) { for(const f of fields) assert.equal(a[f]??null,b[f]??null,`${label}: ${f} changed`); }
function validateLocal(data) {
  assert.equal(data.shopId,SHOP,'Wrong shop'); assert.equal(data.deviceId,DEVICE,'Export must use inspected Device A');
  assert.equal(data.pending,0,'Pending or dead-letter events exist; inspect before repair');
  for(const p of products) {
    const local=data.products.find(x=>x.id===p.id); assert(local,'Missing product');
    same(local,{id:p.id,name:p.name,stock:p.before,buying_price:p.cost},['id','name','stock','buying_price'],'Product');
    const batches=data.batches.filter(x=>x.product_id===p.id);
    const wantBatches=expected.filter(x=>x.entity_type==='stock_batch'&&x.payload.product_id===p.id).map(x=>x.payload);
    assert.deepEqual(batches.map(x=>x.id).sort(),wantBatches.map(x=>x.id).sort(),'Unexpected batch history');
    for(const b of batches) same(b,wantBatches.find(x=>x.id===b.id),['product_id','quantity','remaining','buying_price','date'],'Batch');
    const moves=data.movements.filter(x=>x.product_id===p.id);
    const server=expected.filter(x=>x.entity_type==='stock_movement'&&x.payload.product_id===p.id).map(x=>x.payload);
    assert.deepEqual(moves.map(x=>x.id).sort(),[...server.map(x=>x.id),p.extra.id].sort(),'Movement set changed');
    for(const m of server) same(moves.find(x=>x.id===m.id),m,movementFields,'Movement');
    const extra=moves.find(x=>x.id===p.extra.id);
    same(extra,{product_id:p.id,batch_id:p.extra.batch,movement_type:'PURCHASE',quantity_delta:p.extra.delta,unit_cost:p.cost,reference_type:'stock_batch',reference_id:p.extra.batch},['product_id','batch_id','movement_type','quantity_delta','unit_cost','reference_type','reference_id'],'Local repair artifact');
    assert.equal(extra.created_at,local.created_at,'Unexpected artifact timestamp');
    assert.equal(extra.shop_id,SHOP,'Artifact shop mismatch');
    assert.equal(moves.reduce((n,x)=>n+Number(x.quantity_delta),0),p.localLedger);
    const sales=data.sales.filter(x=>x.product_id===p.id);
    assert.deepEqual(sales.map(x=>x.id).sort(),[...p.sales].sort(),'Sales changed');
    for(const sale of sales) {
      const move=moves.find(x=>x.reference_type==='sale'&&x.reference_id===sale.id);
      assert(move); assert.equal(Number(sale.quantity),-move.quantity_delta,'Sale quantity mismatch');
    }
  }
  return true;
}
function buildPlan(data) {
  validateLocal(data);
  return products.map(p=>({ ...p, serverLedger:expected.filter(x=>x.entity_type==='stock_movement'&&x.payload.product_id===p.id).reduce((s,x)=>s+Number(x.payload.quantity_delta),0),
    movementId:`mov_${REPAIR}_${p.id}`,batchId:`batch_${REPAIR}_${p.id}`,
    correction:p.target-p.localLedger,
    history:[...expected.filter(x=>x.entity_type==='stock_movement'&&x.payload.product_id===p.id).map(x=>x.payload),data.movements.find(x=>x.id===p.extra.id)]
  }));
}
const lit = x => "'"+String(x).replace(/'/g,"''")+"'";
const json = x => lit(JSON.stringify(x))+'::jsonb';
function sql(data,apply=false) {
  const plan=buildPlan(data), ids=products.map(x=>lit(x.id)).join(',');
  const scope=`shop_id=${lit(SHOP)} AND ((entity_type='product' AND entity_id IN (${ids})) OR (entity_type IN ('stock_batch','stock_movement') AND payload->>'product_id' IN (${ids})))`;
  const receiptIds=plan.map(x=>lit(x.movementId)).join(',');
  const checks=expected.map(r=>`IF NOT EXISTS(SELECT 1 FROM entity_snapshots WHERE shop_id=${lit(SHOP)} AND entity_type=${lit(r.entity_type)} AND entity_id=${lit(r.entity_id)} AND deleted_at IS NULL AND payload=${json(r.payload)}) THEN RAISE EXCEPTION 'Server baseline changed: ${r.entity_id}'; END IF;`).join('\n');
  const guard=`SELECT count(*) INTO done FROM entity_snapshots WHERE shop_id=${lit(SHOP)} AND entity_type='stock_movement' AND entity_id IN (${receiptIds});
  IF done=2 THEN
    IF EXISTS(SELECT 1 FROM entity_snapshots WHERE shop_id=${lit(SHOP)} AND entity_type='stock_movement' AND entity_id IN (${receiptIds}) AND (deleted_at IS NOT NULL OR payload->'metadata'->>'maintenance_id' IS DISTINCT FROM ${lit(REPAIR)})) THEN RAISE EXCEPTION 'Invalid repair receipt'; END IF;
    RAISE NOTICE 'ALREADY APPLIED: no changes, including after later sales'; RETURN;
  END IF;
  IF done<>0 THEN RAISE EXCEPTION 'Partial repair receipts: investigate'; END IF;
  IF NOT EXISTS(SELECT 1 FROM devices WHERE id=${lit(DEVICE)} AND shop_id=${lit(SHOP)} AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Expected device not registered'; END IF;
  IF EXISTS(SELECT 1 FROM inventory_reconciliation_issues WHERE shop_id=${lit(SHOP)} AND product_id IN (${ids}) AND status<>'RESOLVED') THEN RAISE EXCEPTION 'Open reconciliation exists'; END IF;
  IF (SELECT count(*) FROM entity_snapshots WHERE ${scope})<>${expected.length} THEN RAISE EXCEPTION 'Server inventory record set changed'; END IF;
  ${checks}`;
  let out=`\\set ON_ERROR_STOP on\nBEGIN${apply?'':' READ ONLY'};\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\n`;
  if(apply) out+=`LOCK TABLE entity_snapshots, sync_events, sync_changes IN SHARE ROW EXCLUSIVE MODE;\n`;
  const publish=(type,id,payload)=>`PERFORM pg_temp.publish_inventory_repair(${lit(type)},${lit(id)},${json(payload)});`;
  let writes='';
  for(const p of plan) {
    // Republish the union so every device receives the exact same preserved history.
    for(const m of p.history) writes+=publish('stock_movement',m.id,m)+'\n';
    for(const b of expected.filter(x=>x.entity_type==='stock_batch'&&x.payload.product_id===p.id)) writes+=publish('stock_batch',b.entity_id,{...b.payload,remaining:0})+'\n';
    // Older devices may retain the original batches absent from server snapshots.
    // Publish closed snapshots for these historical IDs too, preserving references.
    for(const m of p.history.filter(m=>m.movement_type==='PURCHASE')) {
      if(expected.some(x=>x.entity_type==='stock_batch'&&x.entity_id===m.batch_id)) continue;
      writes+=publish('stock_batch',m.batch_id,{id:m.batch_id,product_id:p.id,quantity:m.quantity_delta,remaining:0,buying_price:m.unit_cost,date:m.created_at,shop_id:SHOP})+'\n';
    }
    writes+=publish('stock_batch',p.batchId,{id:p.batchId,product_id:p.id,quantity:p.target,remaining:p.target,buying_price:p.cost,date:'__REPAIR_TIME__',supplier_id:null,supplier_name:'Legacy inventory correction',payment_method:null,account_id:null,account_label:null,account_number:null,shop_id:SHOP})+'\n';
    writes+=publish('stock_movement',p.movementId,{id:p.movementId,product_id:p.id,batch_id:null,movement_type:'RECONCILIATION_COUNT',quantity_delta:p.correction,unit_cost:p.cost,reference_type:'inventory_reconciliation',reference_id:REPAIR,actor_name:'Maintenance repair',shop_id:SHOP,device_id:DEVICE,created_at:'__REPAIR_TIME__',metadata:{maintenance_id:REPAIR,reason:'Offset preserved legacy synthetic purchases; preserve original sales. Derived balance, not a claimed physical count.',physical_count:p.target,previous_authoritative_quantity:p.localLedger,reconciliation_batch_id:p.batchId,known_movement_ids:p.history.map(m=>m.id),legacy_batch_ids:expected.filter(x=>x.entity_type==='stock_batch'&&x.payload.product_id===p.id).map(x=>x.entity_id)}})+'\n';
    const product=expected.find(x=>x.entity_type==='product'&&x.entity_id===p.id).payload;
    writes+=publish('product',p.id,{...product,stock:p.target})+'\n';
    writes+=`IF (SELECT sum((payload->>'quantity_delta')::numeric) FROM entity_snapshots WHERE shop_id=${lit(SHOP)} AND entity_type='stock_movement' AND deleted_at IS NULL AND payload->>'product_id'=${lit(p.id)})<>${p.target} THEN RAISE EXCEPTION 'Ledger verification failed'; END IF;\n`;
    writes+=`IF (SELECT sum((payload->>'remaining')::numeric) FROM entity_snapshots WHERE shop_id=${lit(SHOP)} AND entity_type='stock_batch' AND deleted_at IS NULL AND payload->>'product_id'=${lit(p.id)})<>${p.target} THEN RAISE EXCEPTION 'Batch verification failed'; END IF;\n`;
  }
  if(apply) out+=`CREATE OR REPLACE FUNCTION pg_temp.publish_inventory_repair(kind text, eid text, body jsonb) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE ver bigint; event text; stamp text;
BEGIN
 SELECT COALESCE(max(version),0)+1 INTO ver FROM entity_snapshots WHERE shop_id=${lit(SHOP)} AND entity_type=kind AND entity_id=eid;
 stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 body:=replace(body::text,'__REPAIR_TIME__',stamp)::jsonb;
 IF kind<>'stock_movement' THEN body:=body||jsonb_build_object('version',ver,'updated_at',stamp); END IF;
 event:='srv_inventory_${REPAIR}_'||kind||'_'||eid;
 INSERT INTO sync_events(event_id,shop_id,device_id,entity_type,entity_id,operation,entity_version,occurred_at,payload) VALUES(event,${lit(SHOP)},${lit(DEVICE)},kind,eid,'UPSERT',ver,now(),body);
 INSERT INTO entity_snapshots(shop_id,entity_type,entity_id,version,payload,deleted_at,source_device_id) VALUES(${lit(SHOP)},kind,eid,ver,body,NULL,${lit(DEVICE)})
 ON CONFLICT(shop_id,entity_type,entity_id) DO UPDATE SET version=excluded.version,payload=excluded.payload,deleted_at=NULL,updated_at=now(),source_device_id=excluded.source_device_id;
 INSERT INTO sync_changes(shop_id,event_id,entity_type,entity_id,operation,entity_version,payload,occurred_at,source_device_id) VALUES(${lit(SHOP)},event,kind,eid,'UPSERT',ver,body,now(),${lit(DEVICE)});
END $fn$;\n`;
  out+=`DO $guard$ DECLARE done integer; BEGIN\n${guard}\n${apply?writes:"RAISE NOTICE 'PREVIEW PASSED: test-cola 8; iPhone 337. No data changed.';"}\nEND $guard$;\n${apply?'COMMIT':'ROLLBACK'};\n`;
  return out;
}
module.exports={SHOP,DEVICE,REPAIR,products,expected,validateLocal,buildPlan,sql};
