const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
require('reflect-metadata');
const {StorefrontService,validateDraft}=require('../dist/storefront/storefront.service');
const {renderStorefront}=require('../dist/storefront/storefront.page');
const {StorefrontAdminController,StorefrontPublicController}=require('../dist/storefront/storefront.controller');
(async()=>{
 let db,cleanup;
 if(process.env.HISAFLOW_TEST_PGLITE){
  const {PGlite}=require(process.env.HISAFLOW_TEST_PGLITE),pg=new PGlite();await pg.waitReady;
  const c={query:async(s,p)=>{const r=await pg.query(s,p);return {...r,rowCount:r.rows.length||r.affectedRows||0}},release(){}};
  db={query:c.query,connect:async()=>c};cleanup=()=>pg.close();
 }else{
  if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL for a test PostgreSQL database; the test uses its own isolated schema.');
  const {Pool}=require('pg'),admin=new Pool({connectionString:process.env.DATABASE_URL});
  const schema='sf_test_'+crypto.randomBytes(8).toString('hex');await admin.query('CREATE SCHEMA '+schema);
  db=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});
  cleanup=async()=>{await db.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()};
 }
 try{
  for(const file of ['001_sync_foundation.sql','006_storefront.sql']){
   const sql=fs.readFileSync(path.join(__dirname,'../sql',file),'utf8');
   // Each statement is independent here; no semicolons occur inside these migrations' literals.
   for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
  }
  const A=crypto.randomUUID(),B=crypto.randomUUID(),owner=crypto.randomUUID(),other=crypto.randomUUID(),staff=crypto.randomUUID();
  for(const [id,email] of [[owner,'owner@test.invalid'],[other,'other@test.invalid'],[staff,'staff@test.invalid']])await db.query('INSERT INTO users(id,email) VALUES($1,$2)',[id,email]);
  for(const [id,name,user] of [[A,'Shop A',owner],[B,'Shop B',other]]){await db.query('INSERT INTO shops(id,name) VALUES($1,$2)',[id,name]);await db.query("INSERT INTO shop_memberships(shop_id,user_id,role) VALUES($1,$2,'owner')",[id,user]);}
  await db.query("INSERT INTO shop_memberships(shop_id,user_id,role) VALUES($1,$2,'staff')",[A,staff]);
  const privateProduct={id:'shared-id',name:'Tea <script>alert(1)</script>',category:'Drinks',selling_price:1500,buying_price:1000,stock:17,supplier_name:'SECRET_SUPPLIER',staff_pin:'SECRET_PIN'};
  await db.query("INSERT INTO entity_snapshots(shop_id,entity_type,entity_id,payload) VALUES($1,'product','shared-id',$2)",[A,JSON.stringify(privateProduct)]);
  await db.query("INSERT INTO entity_snapshots(shop_id,entity_type,entity_id,payload) VALUES($1,'product','shared-id',$2)",[B,JSON.stringify({...privateProduct,name:'Other shop',selling_price:999})]);
  await db.query("INSERT INTO entity_snapshots(shop_id,entity_type,entity_id,payload) VALUES($1,'product','foreign-only',$2)",[B,JSON.stringify({...privateProduct,id:'foreign-only'})]);
  const service=new StorefrontService(db),draft={name:'Kariakoo & Sons',description:'Tea and essentials </script><script>alert(2)</script>',location:'Dar es Salaam',hours:'Mon–Sat 8–19',whatsapp:'+255 712 345 678',language:'sw',products:[{id:'shared-id',image:''}]};
  assert.equal((await service.get(owner,A)).live,false);await assert.rejects(service.publicShop(A));
  for(const who of [other,staff]){await assert.rejects(service.get(who,A));await assert.rejects(service.catalog(who,A));await assert.rejects(service.save(who,A,{draft,revision:0}));await assert.rejects(service.preview(who,A,{draft}));await assert.rejects(service.publish(who,A,{revision:0}));await assert.rejects(service.unpublish(who,A,{revision:0}));}
  let saved=await service.save(owner,A,{draft,revision:0});assert.equal(saved.revision,1);assert.equal(saved.draft.whatsapp,'255712345678');await assert.rejects(service.publicShop(A));
  await assert.rejects(service.save(owner,A,{draft,revision:0}),/STOREFRONT_CHANGED_RELOAD/);
  await assert.rejects(service.preview(owner,A,{draft:{...draft,products:[{id:'foreign-only',image:''}]}}),/PRODUCT_UNAVAILABLE/);
  const preview=await service.preview(owner,A,{draft});assert.equal(preview.products[0].price,1500);assert.equal(preview.products[0].buying_price,undefined);assert.equal(preview.products[0].stock,undefined);
  let live=await service.publish(owner,A,{revision:1});assert.equal(live.live,true);assert.equal(live.revision,2);
  const publicData=await service.publicShop(A);assert.equal(publicData.products.length,1);assert.equal(publicData.products[0].price,1500);
  const encoded=JSON.stringify(publicData);for(const secret of ['SECRET_SUPPLIER','SECRET_PIN','buying_price','stock','other@test'])assert(!encoded.includes(secret));
  const html=renderStorefront(publicData).html;assert(!html.includes('</script><script>alert(2)'));assert(html.includes('\\u003c/script'));assert(html.includes('Content-Security-Policy'));assert(html.includes('sandbox')===false);
  const draft2={...draft,name:'Unpublished edits'};saved=await service.save(owner,A,{draft:draft2,revision:2});assert.equal((await service.publicShop(A)).name,draft.name);
  await assert.rejects(service.publish(owner,A,{revision:2}),/CHANGED_RELOAD/);
  await service.unpublish(owner,A,{revision:saved.revision});await assert.rejects(service.publicShop(A));assert.equal((await service.get(owner,A)).draft.name,'Unpublished edits');
  await assert.rejects(service.publicShop(B));
  assert.throws(()=>validateDraft({...draft,whatsapp:'0712345678'}),/INTERNATIONAL/);
  assert.throws(()=>validateDraft({...draft,products:[{id:'x',image:'data:image/svg+xml,<svg onload=alert(1)>'}]}),/JPEG/);
  assert.throws(()=>validateDraft({...draft,products:[{id:'x',image:'https://example.test/a.jpg'}]}),/JPEG/);
  assert.throws(()=>validateDraft({...draft,products:[{id:'x'},{id:'x'}]}),/DUPLICATE/);
  assert(Reflect.getMetadata('__guards__',StorefrontAdminController)?.length);assert(!Reflect.getMetadata('__guards__',StorefrontPublicController));
  const stored=await db.query("SELECT payload FROM entity_snapshots WHERE shop_id=$1 AND entity_id='shared-id'",[A]);assert.deepEqual(stored.rows[0].payload,privateProduct);
  assert.equal((await db.query('SELECT * FROM sync_events')).rowCount,0);
  console.log('PASS: owner-only access, cross-shop product selection blocked, draft private, publish/unpublish, optimistic revisions, public allowlist, XSS escaping, image/phone validation, inventory and sync untouched');
  if(process.env.HISAFLOW_TEST_HTML)fs.writeFileSync(process.env.HISAFLOW_TEST_HTML,html);
 }finally{await cleanup()}
})().catch(e=>{console.error(e);process.exitCode=1});
