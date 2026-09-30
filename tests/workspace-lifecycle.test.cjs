const assert=require('node:assert/strict');
const {installWorkspaceGate}=require('../electron/workspaceGate');
(async()=>{
 const handlers=new Map(),ipc={handle:(name,fn)=>handlers.set(name,fn)};
 installWorkspaceGate(ipc);
 let finish,switched=false;
 ipc.handle('sale',()=>new Promise(resolve=>{finish=resolve}));
 ipc.handle('workspace:open',()=>{switched=true;return 'opened'});
 const sale=handlers.get('sale')();await Promise.resolve();
 const switching=handlers.get('workspace:open')();
 assert.equal(switched,false);
 assert.throws(()=>handlers.get('sale')(),/SWITCH_IN_PROGRESS/);
 assert.throws(()=>handlers.get('workspace:open')(),/SWITCH_IN_PROGRESS/);
 finish();await sale;assert.equal(await switching,'opened');assert.equal(switched,true);
 ipc.handle('workspace:open',()=>{throw new Error('WRONG_PIN')});
 await assert.rejects(handlers.get('workspace:open')(),/WRONG_PIN/);
 ipc.handle('read',()=>42);assert.equal(await handlers.get('read')(),42);
 console.log('PASS: switch drains admitted writes, blocks new/duplicate requests, and unlocks IPC on failure');
})().catch(e=>{console.error(e);process.exitCode=1});
const {completeWorkspaceDownload}=require('../electron/workspaceDownload');
(async()=>{
 let r={active:'B',entries:{B:{initializing:true,returnTo:'A'}}},calls=0,restarts=0;
 const registry={read:()=>structuredClone(r),write:v=>{r=v}};
 const args={state:{entry:r.entries.B},registry,cloud:{triggerSync:async()=>({success:true,hasMore:++calls<3})},dialog:{showMessageBox:async()=>({response:0})},restart:()=>restarts++};
 assert.equal(await completeWorkspaceDownload(args),true);assert.equal(calls,3);assert.equal(r.entries.B.initializing,false);
 r={active:'B',entries:{B:{initializing:true,returnTo:'A'}}};args.state={entry:r.entries.B};args.cloud.triggerSync=async()=>({success:false,error:'offline'});
 assert.equal(await completeWorkspaceDownload(args),false);assert.equal(r.active,'A');assert.equal(r.entries.B.initializing,true);assert.equal(restarts,1);
 console.log('PASS: new-shop download completes every page before opening; network failure returns to source and retains resumable workspace');
})().catch(e=>{console.error(e);process.exitCode=1});
