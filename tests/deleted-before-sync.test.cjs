const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hisaflow-delete-test-'));
process.env.HISAFLOW_DATA_DIR=root;
const {db}=require('../electron/db');
const sync=require('../electron/syncService');
const source=fs.readFileSync(path.join(__dirname,'../electron/syncService.js'),'utf8');
const Database=require('better-sqlite3');
const replicas=[];
try {
 db.prepare("UPDATE system_meta SET value='0' WHERE key='cloud_sync_requires_adoption'").run();
 function add(id,n){
  db.prepare('INSERT INTO products(id,name,stock,created_at) VALUES(?,?,?,?)').run(id,id,0,'2026-09-29T00:00:00Z');
  db.prepare('INSERT INTO stock_batches(id,product_id,quantity,remaining,buying_price,date) VALUES(?,?,?,?,?,?)').run('b_'+id,id,n,n,1000,'2026-09-29T00:00:00Z');
  db.prepare('UPDATE products SET stock=? WHERE id=?').run(n,id);
 }
 for(let i=0;i<6;i++)add('sample'+i,[24,50,40,30,20,35][i]);
 for(let i=0;i<6;i++)db.prepare('DELETE FROM products WHERE id=?').run('sample'+i);
 add('keep',5);
 const before=db.prepare('SELECT * FROM stock_movements ORDER BY id').all();
 assert.equal(before.length,7);
 const events=[];
 while(true){
  const page=sync.leasePendingEvents({limit:1});
  if(!page.events.length)break;
  const e=page.events[0];
  if(e.entityType==='product'||e.entityType==='stock_batch'){
   if(e.entityId.includes('sample'))assert.equal(e.operation,'DELETE');
   else assert(e.payload);
  }
  events.push(e);sync.acknowledgeEvents(page.leaseToken,[e.eventId]);
 }
 assert.equal(events.length,40);
 assert.equal(events.filter(e=>e.entityType==='stock_movement').length,7);
 assert.deepEqual(db.prepare('SELECT * FROM stock_movements ORDER BY id').all(),before);
 assert.equal(sync.leasePendingEvents().events.length,0);
 console.log('PASS: six deleted samples plus live product: 40 events, page size 1, no empty UPSERT, movement history retained');
 // Replay the real upload envelopes through the shipped SQLite pull path.
 for(const pageSize of [1,7,100]){
  const replica=new Database(':memory:');replicas.push(replica);
  // Copy the actual shipped schema, including triggers, with no source data.
  const schema=db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all();
  for(const r of schema)replica.exec(r.sql);
  replica.pragma('foreign_keys = ON');
  replica.prepare('INSERT INTO system_meta(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)').run('shop_id',sync.identity().shopId);
  replica.prepare('INSERT INTO system_meta(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)').run('device_id','other-device');
  const mod={exports:{}};
  vm.runInNewContext(source,{require:n=>n==='./db'?{db:replica}:require(path.resolve(__dirname,'../electron',n)),module:mod,exports:mod.exports,console});
  for(let i=0;i<events.length;i+=pageSize)mod.exports.applyRemoteChanges(events.slice(i,i+pageSize),String(i+pageSize));
  mod.exports.applyRemoteChanges(events,'40');
  assert.equal(replica.prepare('SELECT COUNT(*) n FROM products').get().n,1);
  assert.equal(replica.prepare("SELECT stock FROM products WHERE id='keep'").get().stock,5);
  assert.equal(replica.prepare('SELECT SUM(remaining) n FROM stock_batches').get().n,5);
  assert.equal(replica.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,7);
  assert.equal(replica.prepare('SELECT COUNT(*) n FROM sync_outbox').get().n,0);
 }
 console.log('PASS: fresh SQLite pull at multiple page sizes; replay, foreign keys, stock 5, no sync echo');
 db.prepare("INSERT INTO sync_outbox(event_id,entity_type,entity_id,operation,created_at) VALUES('broken','product','missing','UPSERT',CURRENT_TIMESTAMP)").run();
 assert.throws(()=>sync.leasePendingEvents(),/SYNC_MISSING_ENTITY_PAYLOAD/);
 const broken=db.prepare("SELECT * FROM sync_outbox WHERE event_id='broken'").get();
 assert.equal(broken.lease_token,null);assert.equal(broken.synced_at,null);
 db.prepare("UPDATE sync_outbox SET payload=? WHERE event_id='broken'").run(JSON.stringify({id:'missing',name:'saved historical payload'}));
 const saved=sync.leasePendingEvents();assert.equal(saved.events[0].payload.name,'saved historical payload');sync.releaseLease(saved.leaseToken);
 console.log('PASS: unexplained missing row fails atomically; stored payload remains usable');
} finally {for(const r of replicas)r.close();db.close();fs.rmSync(root,{recursive:true,force:true});}
