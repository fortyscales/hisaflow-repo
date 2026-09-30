const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SHOP,DEVICE,REPAIR,products,expected,buildPlan,sql}=require('../tools/legacy-inventory/plan.cjs');
let Database; try { Database=require('better-sqlite3'); } catch(e) { try { Database=require('node:sqlite').DatabaseSync; } catch { throw new Error('Run this test using Electron Node mode with better-sqlite3 installed.'); } }
function fixture(){
  const data={shopId:SHOP,deviceId:DEVICE,pending:0,products:expected.filter(x=>x.entity_type==='product').map(x=>({...x.payload})),batches:expected.filter(x=>x.entity_type==='stock_batch').map(x=>({...x.payload})),movements:expected.filter(x=>x.entity_type==='stock_movement').map(x=>({...x.payload})),sales:[]};
  for(const p of products){const original=data.products.find(x=>x.id===p.id);data.movements.push({id:p.extra.id,product_id:p.id,batch_id:p.extra.batch,movement_type:'PURCHASE',quantity_delta:p.extra.delta,unit_cost:p.cost,reference_type:'stock_batch',reference_id:p.extra.batch,created_at:original.created_at,shop_id:SHOP,device_id:DEVICE,metadata:null});
    for(const id of p.sales){const m=data.movements.find(x=>x.reference_id===id);data.sales.push({id,product_id:p.id,quantity:-m.quantity_delta});}}
  return data;
}
const data=fixture(),plan=buildPlan(data);
assert.deepEqual(plan.map(x=>x.correction),[-19,-337]);
assert.deepEqual(plan.map(x=>x.serverLedger),[18,337]);
for(const mutate of [d=>d.shopId='other',d=>d.pending=1,d=>d.movements[0].quantity_delta=99,d=>d.batches.push({...d.batches[0],id:'new'}),d=>d.products[0].stock=8,d=>d.sales.pop()]) {const d=structuredClone(data);mutate(d);assert.throws(()=>buildPlan(d));}
assert(sql(data,false).includes('BEGIN READ ONLY'));
assert(!sql(data,false).includes('INSERT INTO'));
assert(sql(data,true).includes('LOCK TABLE'));
assert(sql(data,true).includes('ALREADY APPLIED'));
console.log('PASS: exact baseline guards, wrong shop, changed stock/history, pending events and preview');
function setup(source=data){
  const native=new Database(':memory:');
  const db={exec:s=>native.exec(s),prepare:s=>{
    const st=native.prepare(s);return {get:(...a)=>st.get(...a),all:(...a)=>st.all(...a),run:(...a)=>st.run(...a),pluck:()=>({get:(...a)=>{const r=st.get(...a);return r?Object.values(r)[0]:undefined;}})};
  },transaction:fn=>(...args)=>{native.exec('BEGIN');try{const r=fn(...args);native.exec('COMMIT');return r;}catch(e){native.exec('ROLLBACK');throw e;}}};
  db.exec(`CREATE TABLE system_meta(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
  CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,stock REAL,buying_price REAL,version INTEGER,updated_at TEXT);
  CREATE TABLE stock_batches(id TEXT PRIMARY KEY,product_id TEXT,quantity REAL,remaining REAL,buying_price REAL,date TEXT,version INTEGER,updated_at TEXT);
  CREATE TABLE stock_movements(id TEXT PRIMARY KEY,product_id TEXT,batch_id TEXT,movement_type TEXT,quantity_delta REAL,unit_cost REAL,reference_type TEXT,reference_id TEXT,created_at TEXT,shop_id TEXT,device_id TEXT,actor_name TEXT,metadata TEXT);
  CREATE TABLE sales(id TEXT PRIMARY KEY,product_id TEXT,quantity REAL);
  CREATE TABLE sync_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT,entity_type TEXT,entity_id TEXT,operation TEXT,synced_at TEXT);
  CREATE TABLE sync_inbox(event_id TEXT PRIMARY KEY,source_device_id TEXT,entity_type TEXT,entity_id TEXT,operation TEXT,entity_version INTEGER,cursor TEXT,applied_at TEXT);`);
  db.prepare('INSERT INTO system_meta(key,value) VALUES(?,?)').run('shop_id',SHOP);db.prepare('INSERT INTO system_meta(key,value) VALUES(?,?)').run('device_id',DEVICE);
  for(const [table,rows] of [['products',source.products],['stock_batches',source.batches],['stock_movements',source.movements],['sales',source.sales]]){
    const cols=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name));
    for(const row of rows){const keys=Object.keys(row).filter(x=>cols.has(x));db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?')})`).run(...keys.map(k=>row[k]??null));}
  }
  // Real batch audit trigger definitions from the shipped migrations (v7).
  const migrations=fs.readFileSync(path.join(__dirname,'../electron/migrations.js'),'utf8');
  for(const name of ['trg_stock_movement_batch_insert','trg_stock_movement_batch_remaining']){
    const start=migrations.indexOf('CREATE TRIGGER '+name+'\n');const end=migrations.indexOf('\n        END;',start)+'\n        END;'.length;
    if(!start||start<0)throw Error('Trigger missing');
    if(name==='trg_stock_movement_batch_insert') db.exec('CREATE TABLE stock_movement_context(batch_id TEXT,movement_type TEXT,reference_type TEXT,reference_id TEXT,actor_name TEXT,created_at TEXT,metadata TEXT)');
    db.exec(migrations.slice(start,end));
  }
  for(const table of ['products','stock_batches','stock_movements'])for(const action of ['INSERT','UPDATE'])db.exec(`CREATE TRIGGER echo_${table}_${action} AFTER ${action} ON ${table} BEGIN INSERT INTO sync_outbox(event_id) VALUES('echo'); END`);
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/syncService.js'),'utf8'),{module,require:n=>n==='./db'?{db}:require('../electron/legacyInventoryGuard'),console});
  return {db,api:module.exports,native};
}
function changes(){let seq=1000;const result=[];for(const p of plan){
  const add=(type,id,payload)=>result.push({event_id:`srv_inventory_${REPAIR}_${type}_${id}`,entity_type:type,entity_id:id,operation:'UPSERT',entity_version:10,payload,source_device_id:DEVICE,seq:++seq});
  for(const m of p.history)add('stock_movement',m.id,m);
  for(const b of data.batches.filter(x=>x.product_id===p.id))add('stock_batch',b.id,{...b,remaining:0});
  for(const m of p.history.filter(m=>m.movement_type==='PURCHASE'&&!data.batches.some(b=>b.id===m.batch_id)))add('stock_batch',m.batch_id,{id:m.batch_id,product_id:p.id,quantity:m.quantity_delta,remaining:0,buying_price:m.unit_cost,date:m.created_at});
  add('stock_batch',p.batchId,{id:p.batchId,product_id:p.id,quantity:p.target,remaining:p.target,buying_price:p.cost,date:'2026-09-27T00:00:00Z'});
  add('stock_movement',p.movementId,{id:p.movementId,product_id:p.id,batch_id:null,movement_type:'RECONCILIATION_COUNT',quantity_delta:p.correction,unit_cost:p.cost,reference_type:'inventory_reconciliation',reference_id:REPAIR,created_at:'2026-09-27T00:00:00Z',metadata:{maintenance_id:REPAIR,physical_count:p.target,reconciliation_batch_id:p.batchId}});
  add('product',p.id,{...data.products.find(x=>x.id===p.id),stock:p.target});
}return result;}
const events=changes();
const older=structuredClone(data);
for(const p of plan) for(const m of p.history.filter(m=>m.movement_type==='PURCHASE'&&!older.batches.some(b=>b.id===m.batch_id)))older.batches.push({id:m.batch_id,product_id:p.id,quantity:m.quantity_delta,remaining:m.quantity_delta,buying_price:m.unit_cost,date:m.created_at});
for(const source of [older,data,{...data,movements:data.movements.filter(m=>!products.some(p=>p.extra.id===m.id))}]){
 const f=setup(source),before=f.db.prepare('SELECT * FROM sales ORDER BY id').all();
 // Exercise all page boundary positions, including batches before reset marker.
 for(const page of events.map(e=>[e]))f.api.applyRemoteChanges(page,String(page[0].seq));
 for(const p of plan){assert.equal(f.db.prepare('SELECT stock FROM products WHERE id=?').get(p.id).stock,p.target);assert.equal(f.db.prepare('SELECT sum(remaining) n FROM stock_batches WHERE product_id=?').get(p.id).n,p.target);assert.equal(f.db.prepare('SELECT sum(quantity_delta) n FROM stock_movements WHERE product_id=?').get(p.id).n,p.target);}
 assert.deepEqual(f.db.prepare('SELECT * FROM sales ORDER BY id').all(),before);
 assert.equal(f.db.prepare('SELECT count(*) n FROM sync_outbox').get().n,0);
 const count=f.db.prepare('SELECT count(*) n FROM stock_movements').get().n;
 f.api.applyRemoteChanges(events,String(events.at(-1).seq));assert.equal(f.db.prepare('SELECT count(*) n FROM stock_movements').get().n,count);
 f.native.close();
}
console.log('PASS: actual SQLite pull + shipped audit triggers; both ledger variants converge to 8/337; sales preserved; page boundaries; no sync echo; replay idempotent');
for(const kind of ['history','pending','shop']){
 const f=setup();
 if(kind==='history')f.db.prepare('UPDATE stock_movements SET quantity_delta=99 WHERE id=?').run(data.movements[0].id);
 if(kind==='pending')f.db.prepare('INSERT INTO sync_outbox(event_id) VALUES(?)').run('pending');
 if(kind==='shop')f.db.prepare('UPDATE system_meta SET value=? WHERE key=?').run('other-shop','shop_id');
 const before=f.db.prepare('SELECT stock FROM products ORDER BY id').all();
 assert.throws(()=>f.api.applyRemoteChanges(events,'9999'));
 assert.deepEqual(f.db.prepare('SELECT stock FROM products ORDER BY id').all(),before);
 assert.equal(f.db.prepare('SELECT count(*) n FROM sync_inbox').get().n,0); f.native.close();
}
console.log('PASS: changed local history, pending events and cross-shop pull fail atomically');
if(process.env.REPAIR_FIXTURE_OUT){fs.mkdirSync(process.env.REPAIR_FIXTURE_OUT,{recursive:true});fs.writeFileSync(path.join(process.env.REPAIR_FIXTURE_OUT,'apply.sql'),sql(data,true));fs.writeFileSync(path.join(process.env.REPAIR_FIXTURE_OUT,'preview.sql'),sql(data,false));}
