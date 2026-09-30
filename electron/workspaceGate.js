// All admitted IPC promises finish on the source database before switching.
function installWorkspaceGate(ipcMain) {
  let switching=false;
  const active=new Set(),register=ipcMain.handle.bind(ipcMain);
  ipcMain.handle=(channel,handler)=>register(channel,(event,...args)=>{
    if(switching) throw new Error('WORKSPACE_SWITCH_IN_PROGRESS');
    if(channel==='workspace:open') {
      switching=true;
      return Promise.allSettled([...active]).then(()=>handler(event,...args)).finally(()=>{switching=false});
    }
    const work=Promise.resolve().then(()=>handler(event,...args));active.add(work);
    work.then(()=>active.delete(work),()=>active.delete(work));return work;
  });
}
module.exports={installWorkspaceGate};
