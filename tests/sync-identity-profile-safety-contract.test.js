const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const db=fs.readFileSync(path.join(root,'electron/db.js'),'utf8');
const mig=fs.readFileSync(path.join(root,'electron/migrations.js'),'utf8');
const sync=fs.readFileSync(path.join(root,'electron/syncService.js'),'utf8');
const cloud=fs.readFileSync(path.join(root,'electron/cloudSyncClient.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'src/screens/CloudScreen.jsx'),'utf8');
function ok(x,m){if(!x)throw new Error(m)}
ok(db.includes('HISAFLOW_DATA_DIR'),'explicit data-root override missing');
ok(mig.includes("version: 23")&&mig.includes('cloud_sync_requires_adoption'),'migration 23 gate missing');
ok(sync.includes('CLOUD_EXISTING_DATA_ADOPTION_REQUIRED'),'lease safety missing');
ok(cloud.includes('getFirstSyncSafety'),'cloud push preflight missing');
ok(!ui.includes('await window.hisaflow.cloudRegister(form);else await window.hisaflow.cloudLogin(form);await syncService.triggerSync()'),'registration still auto-syncs');
ok(ui.includes('Automatic first upload is blocked'),'merchant safety copy missing');
console.log('Sync identity + profile safety contract: PASS');
