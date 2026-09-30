const {spawnSync}=require('node:child_process');
const path=require('node:path');
const r=spawnSync(require('electron'),[path.resolve(__dirname,'../tests/deleted-before-sync.test.cjs')],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
if(r.error)console.error(r.error);
process.exit(r.status??1);
