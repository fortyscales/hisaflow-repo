const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawn}=require('child_process');
const {createRegistry,inspect,canonical,samePath,acquireLock}=require('./workspaceRegistry');
function createWorkspaceManager({root,dir,Database,db,sync,cloud,queries,license,dialog,getWindow,restart}) {
  const registry=createRegistry(root);
  function list() { const r=registry.read(); return {activeShopId:sync.identity().shopId,workspaces:Object.values(r?.entries||{}).map(e=>({shopId:e.shopId,name:e.name,deviceId:e.deviceId}))}; }
  async function open({shopId,pin,mode='saved'}) {
    const ident=sync.identity(),settings=queries.getSettings();
    if(!settings.ownerPin||String(pin)!==String(settings.ownerPin)) throw new Error('OWNER_PIN_REQUIRED');
    if(!['saved','existing','new'].includes(mode)) throw new Error('WORKSPACE_MODE_INVALID');
    const status=sync.getSyncStatus();
    if(status.pending||status.deadLetter) throw new Error('WORKSPACE_SYNC_REQUIRED');
    if(shopId===ident.shopId) return {unchanged:true};
    const session=cloud.publicSession();
    if(!session.configured) throw new Error('CLOUD_NOT_CONFIGURED');
    const shops=(await cloud.listShops())?.shops||[];
    const target=shops.find(s=>s.id===shopId&&s.role==='owner');
    if(!target||!shops.some(s=>s.id===ident.shopId&&s.role==='owner')) throw new Error('WORKSPACE_OWNER_ACCESS_REQUIRED');
    let r=registry.read();
    if(r && (r.userId!==session.user?.id||r.baseUrl!==session.baseUrl)) throw new Error('WORKSPACE_ACCOUNT_CHANGED');
    if(!r) r={version:1,userId:session.user.id,baseUrl:session.baseUrl,active:ident.shopId,entries:{[ident.shopId]:{shopId:ident.shopId,deviceId:ident.deviceId,dir:canonical(dir),name:shops.find(s=>s.id===ident.shopId).name}}};
    let entry=r.entries[shopId], release;
    try {
      if(!entry) {
        if(mode==='saved') throw new Error('WORKSPACE_SETUP_REQUIRED');
        let targetDir;
        if(mode==='existing') {
          const choice=await dialog.showOpenDialog(getWindow(),{title:'Select the existing HisaFlow shop folder',properties:['openDirectory']});
          if(choice.canceled) return {canceled:true};
          targetDir=canonical(choice.filePaths[0]);
          if(samePath(targetDir,dir)) throw new Error('WORKSPACE_WRONG_SHOP');
          release=acquireLock(targetDir);
          const info=inspect(targetDir,Database);
          if(info.shopId!==shopId) throw new Error('WORKSPACE_WRONG_SHOP');
          const rawSession=path.join(targetDir,'cloud-session.json');
          if(fs.existsSync(rawSession)) {
            const saved=JSON.parse(fs.readFileSync(rawSession,'utf8'));
            if((saved.baseUrl&&saved.baseUrl!==session.baseUrl)||(saved.user?.id&&saved.user.id!==session.user.id)) throw new Error('WORKSPACE_ACCOUNT_CHANGED');
          }
          entry={...info,name:target.name};
        } else {
          const parent=path.join(root,'shop-workspaces'); fs.mkdirSync(parent,{recursive:true});
          targetDir=fs.mkdtempSync(path.join(parent,`${shopId}-`));
          await new Promise((resolve,reject)=>{
            const child=spawn(process.execPath,[path.join(__dirname,'workspaceBootstrap.js')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',HISAFLOW_DATA_DIR:targetDir},stdio:['pipe','pipe','pipe']});
            let errors='';child.stderr.on('data',s=>errors=(errors+s).slice(-1500));child.stdout.resume();
            child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`WORKSPACE_CREATE_FAILED: ${errors}`)));
            child.stdin.on('error',()=>{});
            child.stdin.end(JSON.stringify({shopId,name:target.name,ownerPin:settings.ownerPin,language:settings.language,license:license()}));
          });
          release=acquireLock(targetDir);
          entry={...inspect(targetDir,Database),name:target.name,initializing:true,returnTo:ident.shopId};
        }
        if(Object.values(r.entries).some(e=>e.deviceId===entry.deviceId||samePath(e.dir,entry.dir))) throw new Error('WORKSPACE_DUPLICATE_DEVICE');
      } else {
        if(!samePath(entry.dir,root)) release=acquireLock(entry.dir);
        const info=inspect(entry.dir,Database);
        if(info.shopId!==entry.shopId||info.deviceId!==entry.deviceId) throw new Error('WORKSPACE_IDENTITY_CHANGED');
      }
      // Source DB remains open and all IPC is frozen until the process exits.
      // Committing the pointer only after every check leaves failures on the source.
      db.pragma('wal_checkpoint(FULL)');
      const prior=registry.read();
      r.entries[shopId]=entry;r.active=shopId;
      registry.write(r);
      try { restart(); } catch(e) { if(prior) registry.write(prior);else fs.unlinkSync(registry.file); throw e; }
      return {restarting:true};
    } finally { if(release) release(); }
  }
  return {list,open};
}
module.exports={createWorkspaceManager};
