const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hf-session-'));
try {
 const source=fs.readFileSync(path.join(__dirname,'../electron/cloudSession.js'),'utf8');
 function load(active){const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,process:{env:{HISAFLOW_WORKSPACE_ROOT:dir}},Buffer,require:name=>name==='electron'?{safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('sealed:'+s),decryptString:b=>b.toString().slice(7)}}:name==='./db'?{DATA_DIR:active}:name==='./workspaceRegistry'?require('../electron/workspaceRegistry'):require(name)});return module.exports;}
 const a=load(path.join(dir,'A')),b=load(path.join(dir,'B'));
 a.saveSession({baseUrl:'http://127.0.0.1:4100',user:{id:'u'},accessToken:'a1',refreshToken:'r1'});
 assert.equal(b.getSession().refreshToken,'r1');b.saveSession({accessToken:'a2',refreshToken:'r2'});assert.equal(a.getSession().refreshToken,'r2');
 assert.equal(a.publicSession().accessToken,undefined);assert.equal(a.publicSession().refreshToken,undefined);
 a.clearSession();assert.equal(b.publicSession().configured,false);
 console.log('PASS: workspaces share one protected rotating cloud session; public API hides tokens; logout applies to all managed shops');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
