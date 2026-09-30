// Isolated Node process: initializes ONLY a new empty directory supplied by main.
const fs=require('fs'),path=require('path');
let input='';
process.stdin.setEncoding('utf8'); process.stdin.on('data',s=>input+=s);
process.stdin.on('end',()=>{
  let db;
  try {
    const options=JSON.parse(input);
    const dir=process.env.HISAFLOW_DATA_DIR;
    if(!dir || fs.readdirSync(dir).length) throw new Error('NEW_WORKSPACE_MUST_BE_EMPTY');
    db=require('./db').db;
    const sync=require('./syncService');
    sync.bindFreshLocalShopToCloud(options.shopId);
    require('./queries').saveSettings({businessName:options.name,ownerPin:options.ownerPin,ownerPhone:'',language:options.language||'sw',paymentAccounts:[]});
    // Licensing belongs to this installation; creating another shop must not reset its trial.
    if(options.license) {
      const l=options.license;
      db.prepare('INSERT OR REPLACE INTO license(id,machine_id,install_date,licensed,license_key) VALUES(1,?,?,?,?)').run(l.machine_id,l.install_date,l.licensed,l.license_key);
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    process.stdout.write('\nWORKSPACE_READY\n');
  } catch(e) { console.error(e.message); process.exitCode=1; }
  finally { if(db) db.close(); }
});
