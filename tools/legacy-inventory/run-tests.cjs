const {spawnSync}=require('node:child_process');
const path=require('node:path');
const result=spawnSync(require('electron'),[path.resolve(__dirname,'../../tests/legacy-inventory-repair.test.cjs')],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
if(result.error){console.error(result.error.message);process.exit(1);}
process.exit(result.status??1);
