const {spawnSync}=require('child_process');
const path=require('path');
const session=spawnSync(process.execPath,[path.resolve(__dirname,'../tests/workspace-session.test.cjs')],{stdio:'inherit'});
if(session.status!==0)process.exit(session.status||1);
const lifecycle=spawnSync(process.execPath,[path.resolve(__dirname,'../tests/workspace-lifecycle.test.cjs')],{stdio:'inherit'});
if(lifecycle.status!==0)process.exit(lifecycle.status||1);
const result=spawnSync(require('electron'),[path.resolve(__dirname,'../tests/workspaces.test.cjs')],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
if(result.error){console.error(result.error.message);process.exit(1)}
process.exit(result.status??1);
