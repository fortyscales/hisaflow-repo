const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {spawnSync}=require('child_process');
const Database=require('better-sqlite3');
const {createRegistry,inspect,acquireLock}=require('../electron/workspaceRegistry');
const {createWorkspaceManager}=require('../electron/workspaceManager');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hisaflow-workspaces-'));
const A='148a56f7-94af-402b-99fc-ccb843d5ed17',B='a0afdbd8-3081-4b4c-afbd-abcef450db7f',C='45ce4351-8c24-4609-9f69-cafdd70b565c';
const DA='0b64c2bc-5bda-47bf-b15e-972235d784a4',DB='35cd67b1-5183-436b-821a-7a2c7d15b05c';
function make(dir,shop,device,marker){fs.mkdirSync(dir);const db=new Database(path.join(dir,'hisaflow.db'));db.exec('CREATE TABLE system_meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE settings(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE documents(id TEXT PRIMARY KEY); CREATE TABLE products(id TEXT PRIMARY KEY,stock INTEGER);');for(const [k,v] of [['shop_id',shop],['device_id',device]])db.prepare('INSERT INTO system_meta VALUES(?,?)').run(k,v);db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify({paymentAccounts:[marker]}));db.prepare('INSERT INTO documents VALUES(?)').run(marker);db.prepare('INSERT INTO products VALUES(?,7)').run(marker);db.close();}
const source=path.join(root,'A'),target=path.join(root,'B'),wrong=path.join(root,'wrong');make(source,A,DA,'A-only');make(target,B,DB,'B-only');make(wrong,A,'other','wrong');
const releaseRoot=acquireLock(source);
let dirChoice=target,pending=0,failRestart=false,owner=true,canceled=false,restarts=0;
const user={id:'owner'},baseUrl='http://127.0.0.1:4100';
const cloud={publicSession:()=>({configured:true,user,baseUrl}),listShops:async()=>({shops:[{id:A,name:'A',role:'owner'},{id:B,name:'B',role:owner?'owner':'staff'},{id:C,name:'C',role:'owner'}]})};
function manager(dir,shop,device){return createWorkspaceManager({root:source,dir,Database,db:{pragma:()=>{}},sync:{identity:()=>({shopId:shop,deviceId:device}),getSyncStatus:()=>({pending,deadLetter:0})},cloud,queries:{getSettings:()=>({ownerPin:'1234',language:'sw'})},license:()=>({machine_id:'license-original',install_date:'2026-09-01',licensed:0,license_key:null}),dialog:{showOpenDialog:async()=>({canceled,filePaths:[dirChoice]})},getWindow:()=>null,restart:()=>{if(failRestart)throw new Error('RESTART_FAILED');restarts++}});}
(async()=>{
 try {
  const m=manager(source,A,DA),r=createRegistry(source);
  await assert.rejects(m.open({shopId:B,pin:'bad',mode:'existing'}),/OWNER_PIN/);
  pending=1;await assert.rejects(m.open({shopId:B,pin:'1234',mode:'existing'}),/SYNC_REQUIRED/);pending=0;
  owner=false;await assert.rejects(m.open({shopId:B,pin:'1234',mode:'existing'}),/OWNER_ACCESS/);owner=true;
  dirChoice=wrong;await assert.rejects(m.open({shopId:B,pin:'1234',mode:'existing'}),/WRONG_SHOP/);dirChoice=target;
  const unlock=acquireLock(target);await assert.rejects(m.open({shopId:B,pin:'1234',mode:'existing'}),/ALREADY_OPEN/);unlock();
  canceled=true;assert.equal((await m.open({shopId:B,pin:'1234',mode:'existing'})).canceled,true);canceled=false;assert.equal(r.read(),null);
  failRestart=true;await assert.rejects(m.open({shopId:B,pin:'1234',mode:'existing'}),/RESTART_FAILED/);assert.equal(r.read(),null);failRestart=false;
  console.log('PASS: wrong PIN/shop/role, unsynced events, concurrent workspace, cancel and restart failure leave source active');
  const beforeA=fs.readFileSync(path.join(source,'hisaflow.db')),beforeB=fs.readFileSync(path.join(target,'hisaflow.db'));
  await m.open({shopId:B,pin:'1234',mode:'existing'});assert.equal(r.resolve(Database).dir,target);assert.equal(r.read().entries[B].deviceId,DB);
  assert.deepEqual(fs.readFileSync(path.join(source,'hisaflow.db')),beforeA);assert.deepEqual(fs.readFileSync(path.join(target,'hisaflow.db')),beforeB);
  const mb=manager(target,B,DB);await mb.open({shopId:A,pin:'1234'});assert.equal(r.resolve(Database).dir,source);
  const rogue=new Database(path.join(target,'hisaflow.db'));rogue.prepare("UPDATE system_meta SET value='changed' WHERE key='device_id'").run();rogue.close();
  await assert.rejects(m.open({shopId:B,pin:'1234'}),/IDENTITY_CHANGED/);assert.equal(r.read().active,A);
  const restore=new Database(path.join(target,'hisaflow.db'));restore.prepare("UPDATE system_meta SET value=? WHERE key='device_id'").run(DB);restore.close();
  console.log('PASS: A → B → A preserves exact SQLite bytes, accounts, documents and device IDs; changed target identity rejected');
  await m.open({shopId:C,pin:'1234',mode:'new'});
  const entry=r.read().entries[C];assert.equal(entry.initializing,true);assert.equal(entry.returnTo,A);assert.notEqual(entry.deviceId,DA);assert.notEqual(entry.deviceId,DB);
  const fresh=new Database(path.join(entry.dir,'hisaflow.db'),{readonly:true});
  const settings=JSON.parse(fresh.prepare('SELECT data FROM settings WHERE id=1').get().data);
  assert.equal(settings.businessName,'C');assert.equal(settings.ownerPin,'1234');assert.deepEqual(settings.paymentAccounts,[]);
  assert.equal(fresh.prepare('SELECT COUNT(*) n FROM products').get().n,0);assert.equal(fresh.prepare('SELECT COUNT(*) n FROM sync_outbox WHERE synced_at IS NULL').get().n,0);
  assert.equal(fresh.prepare('SELECT machine_id FROM license WHERE id=1').get().machine_id,'license-original');fresh.close();
  console.log('PASS: isolated bootstrap creates fresh shop/device, no copied business data or outbox, preserves installation license');
  assert(restarts===3);
 }finally{releaseRoot();fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
