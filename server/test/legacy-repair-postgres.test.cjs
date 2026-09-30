// Optional integration test: requires @electric-sql/pglite and typescript.
const {PGlite}=require('@electric-sql/pglite');
const ts=require('typescript'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {SHOP,DEVICE,products,expected,sql}=require('../../tools/legacy-inventory/plan.cjs');
function fixture(){
 const data={shopId:SHOP,deviceId:DEVICE,pending:0,products:expected.filter(x=>x.entity_type==='product').map(x=>({...x.payload})),batches:expected.filter(x=>x.entity_type==='stock_batch').map(x=>({...x.payload})),movements:expected.filter(x=>x.entity_type==='stock_movement').map(x=>({...x.payload})),sales:[]};
 for(const p of products){data.movements.push({id:p.extra.id,product_id:p.id,batch_id:p.extra.batch,movement_type:'PURCHASE',quantity_delta:p.extra.delta,unit_cost:p.cost,reference_type:'stock_batch',reference_id:p.extra.batch,created_at:data.products.find(x=>x.id===p.id).created_at,shop_id:SHOP,device_id:DEVICE,metadata:null});for(const id of p.sales){const m=data.movements.find(x=>x.reference_id===id);data.sales.push({id,product_id:p.id,quantity:-m.quantity_delta});}}
 return data;
}
function loadService(file){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>n==='crypto'?require('node:crypto'):n==='@nestjs/common'?{Inject:()=>()=>{},Injectable:()=>()=>{},BadRequestException:Error,ForbiddenException:Error,ConflictException:Error,NotFoundException:Error}:{},console});return module.exports;}
(async()=>{
 const db=new PGlite();await db.waitReady;
 for(const f of fs.readdirSync(path.join(__dirname,'../sql')).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(__dirname,'../sql',f),'utf8'));
 const other='a0afdbd8-3081-4b4c-afbd-abcef450db7f';
 await db.query('INSERT INTO shops(id,name) VALUES($1,$2),($3,$4)',[SHOP,'Shop1',other,'Shop2']);
 await db.query('INSERT INTO devices(id,shop_id,name) VALUES($1,$2,$3)',[DEVICE,SHOP,'Device A']);
 for(const r of expected)await db.query('INSERT INTO entity_snapshots(shop_id,entity_type,entity_id,version,payload,source_device_id) VALUES($1,$2,$3,$4,$5,$6)',[SHOP,r.entity_type,r.entity_id,Number(r.payload.version||1),r.payload,DEVICE]);
 await db.query("INSERT INTO entity_snapshots(shop_id,entity_type,entity_id,payload) VALUES($1,'product','other-product',$2)",[other,{stock:7}]);
 const data=fixture(),strip=s=>s.replace(/^\\set.*\n/,'');
 const preview=strip(sql(data,false)),apply=strip(sql(data,true));
 await db.exec(preview);assert.equal((await db.query('SELECT count(*) n FROM sync_changes')).rows[0].n,0);
 await db.query("UPDATE entity_snapshots SET payload=jsonb_set(payload,'{stock}','10') WHERE entity_type='product' AND entity_id=$1",[products[0].id]);
 await assert.rejects(db.exec(apply),/baseline changed/);await db.exec('ROLLBACK');
 assert.equal((await db.query('SELECT count(*) n FROM sync_events')).rows[0].n,0);
 await db.query("UPDATE entity_snapshots SET payload=jsonb_set(payload,'{stock}','9') WHERE entity_type='product' AND entity_id=$1",[products[0].id]);
 // Inject a mid-publication failure: transaction must restore all prior rows.
 await db.exec(`CREATE FUNCTION fail_repair() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='stock_batch' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_failure BEFORE INSERT ON sync_changes FOR EACH ROW EXECUTE FUNCTION fail_repair();`);
 await assert.rejects(db.exec(apply),/injected failure/);await db.exec('ROLLBACK');
 assert.equal((await db.query('SELECT count(*) n FROM sync_changes')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*) n FROM entity_snapshots')).rows[0].n,15);
 await db.exec('DROP TRIGGER test_failure ON sync_changes');
 await db.exec(apply);
 for(const p of products){const r=await db.query(`SELECT (SELECT (payload->>'stock')::int FROM entity_snapshots WHERE shop_id=$1 AND entity_type='product' AND entity_id=$2) stock,
 (SELECT sum((payload->>'remaining')::int)::int FROM entity_snapshots WHERE shop_id=$1 AND entity_type='stock_batch' AND payload->>'product_id'=$2) batches,
 (SELECT sum((payload->>'quantity_delta')::int)::int FROM entity_snapshots WHERE shop_id=$1 AND entity_type='stock_movement' AND payload->>'product_id'=$2) ledger`,[SHOP,p.id]);assert.deepEqual(r.rows[0],{stock:p.target,batches:p.target,ledger:p.target});}
 for(const r of expected.filter(x=>x.entity_type==='stock_movement'))assert.deepEqual((await db.query('SELECT payload FROM entity_snapshots WHERE shop_id=$1 AND entity_type=$2 AND entity_id=$3',[SHOP,r.entity_type,r.entity_id])).rows[0].payload,r.payload);
 assert.deepEqual((await db.query('SELECT payload FROM entity_snapshots WHERE shop_id=$1',[other])).rows,[{payload:{stock:7}}]);
 const count=(await db.query('SELECT count(*) n FROM sync_events')).rows[0].n;
 await db.exec(apply);assert.equal((await db.query('SELECT count(*) n FROM sync_events')).rows[0].n,count);
 console.log('PASS: PostgreSQL preview, baseline rejection, injected rollback, 8/337 convergence, preserved history, other-shop isolation, repeat no-op');
 // Run actual service code on repaired PostgreSQL snapshots.
 const client={query:async(s,p)=>{const r=await db.query(s,p);return {...r,rowCount:r.rows.length||r.affectedRows||0};},release:()=>{}};
 const pool={...client,connect:async()=>client};
 const {InventoryReconciliationService}=loadService('inventory/inventory-reconciliation.service.ts');
 const inventory=new InventoryReconciliationService(pool);
 const {SyncService}=loadService('sync/sync.service.ts');const service=new SyncService(pool,inventory);
 const send=async(type,id,payload,operation='UPSERT')=>service.push(SHOP,DEVICE,[{protocolVersion:1,shopId:SHOP,deviceId:DEVICE,eventId:`test-${id}-${operation}`,entityId:id,entityType:type,entityVersion:999,operation,occurredAt:new Date().toISOString(),payload}]);
 let result=await send('stock_batch',data.batches[0].id,{...data.batches[0],remaining:999});assert.equal(result.results[0].code,'LEGACY_REPAIR_SUPERSEDED');
 const ghost={...data.movements.find(x=>x.id===products[0].extra.id),id:'new-fake-purchase'};
 result=await send('stock_movement',ghost.id,ghost);assert.equal(result.results[0].code,'LEGACY_SYNTHETIC_PURCHASE_BLOCKED');
 result=await send('stock_movement',data.movements[0].id,{...data.movements[0],quantity_delta:999});assert.equal(result.results[0].code,'REPAIRED_HISTORY_IMMUTABLE');
 const plan=require('../../tools/legacy-inventory/plan.cjs').buildPlan(data);
 const movement={id:'legitimate-sale-after-repair',product_id:products[0].id,batch_id:plan[0].batchId,movement_type:'SALE',quantity_delta:-1,unit_cost:700,reference_type:'sale',reference_id:'future-sale',created_at:new Date(Date.now()+1000).toISOString()};
 result=await send('stock_movement',movement.id,movement);assert.equal(result.results[0].status,'ACK');
 const balance=await db.query("SELECT (payload->>'stock')::int stock FROM entity_snapshots WHERE entity_type='product' AND entity_id=$1",[products[0].id]);assert.equal(balance.rows[0].stock,7);
 await db.exec(apply);assert.equal((await db.query("SELECT (payload->>'stock')::int stock FROM entity_snapshots WHERE entity_type='product' AND entity_id=$1",[products[0].id])).rows[0].stock,7);
 await send('product',products[0].id,{...data.products[0],stock:999});
 assert.equal((await db.query("SELECT (payload->>'stock')::int stock FROM entity_snapshots WHERE entity_type='product' AND entity_id=$1",[products[0].id])).rows[0].stock,7);
 console.log('PASS: actual server blocks artifact resurrection/history rewrite; subsequent real sale projects stock to 7; repair replay does not reset later activity');
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
