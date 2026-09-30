const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function canonical(dir) { return fs.realpathSync(path.resolve(dir)); }
function samePath(a,b) { const norm = p => process.platform === 'win32' ? p.toLowerCase() : p; return norm(canonical(a)) === norm(canonical(b)); }
function atomicJson(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const fd=fs.openSync(tmp,'wx',0o600);
    try { fs.writeFileSync(fd,JSON.stringify(data,null,2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp,file);
  } finally { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function acquireLock(dir) {
  const file=path.join(dir,'.hisaflow-workspace.lock');
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const fd=fs.openSync(file,'wx',0o600);
      fs.writeFileSync(fd,JSON.stringify({pid:process.pid})); fs.closeSync(fd);
      return () => { try { if(JSON.parse(fs.readFileSync(file,'utf8')).pid===process.pid) fs.unlinkSync(file); } catch {} };
    } catch(e) {
      if(e.code!=='EEXIST') throw e;
      let pid; try { pid=JSON.parse(fs.readFileSync(file,'utf8')).pid; } catch { throw new Error('WORKSPACE_LOCK_INVALID'); }
      if(!Number.isInteger(pid)||pid<=0) throw new Error('WORKSPACE_LOCK_INVALID');
      let alive=true; try { process.kill(pid,0); } catch(err) { if(err.code==='ESRCH') alive=false; }
      if(alive) throw new Error('WORKSPACE_ALREADY_OPEN');
      fs.unlinkSync(file);
    }
  }
  throw new Error('WORKSPACE_ALREADY_OPEN');
}
function inspect(dir, Database) {
  const real=canonical(dir);
  const db=new Database(path.join(real,'hisaflow.db'),{readonly:true,fileMustExist:true});
  try {
    const meta=k=>db.prepare('SELECT value FROM system_meta WHERE key=?').get(k)?.value;
    const shopId=meta('shop_id'),deviceId=meta('device_id');
    if(!shopId||!deviceId) throw new Error('WORKSPACE_IDENTITY_MISSING');
    if(db.pragma('quick_check',{simple:true})!=='ok') throw new Error('WORKSPACE_DATABASE_DAMAGED');
    return {dir:real,shopId,deviceId};
  } finally { db.close(); }
}
function createRegistry(root) {
  root=canonical(root);
  const file=path.join(root,'workspaces.json');
  function read() {
    if(!fs.existsSync(file)) return null;
    const r=JSON.parse(fs.readFileSync(file,'utf8'));
    if(r.version!==1 || !r.active || !r.entries?.[r.active] || !r.userId || !r.baseUrl) throw new Error('WORKSPACE_REGISTRY_INVALID');
    return r;
  }
  function resolve(Database) {
    const r=read(); if(!r) return {dir:root,registry:null,entry:null};
    const e=r.entries[r.active], info=inspect(e.dir,Database);
    if(info.shopId!==e.shopId||info.deviceId!==e.deviceId) throw new Error('WORKSPACE_IDENTITY_CHANGED');
    return {dir:info.dir,registry:r,entry:e};
  }
  return {root,file,read,resolve,write:r=>atomicJson(file,r)};
}
module.exports={canonical,samePath,atomicJson,acquireLock,inspect,createRegistry};
