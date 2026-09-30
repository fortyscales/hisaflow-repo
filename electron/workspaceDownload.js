// Return false whenever a restart was requested; never render a partial new shop.
async function completeWorkspaceDownload({state,cloud,registry,dialog,restart}) {
  if(!state.entry?.initializing) return true;
  try {
    let result;
    for(let page=0;page<50;page++) {
      result=await cloud.triggerSync();
      if(!result.success) throw new Error(result.error||result.reason);
      if(!result.hasMore) break;
    }
    if(result.hasMore) throw new Error('WORKSPACE_DOWNLOAD_INCOMPLETE');
    const r=registry.read();r.entries[r.active].initializing=false;registry.write(r);
    return true;
  } catch(error) {
    const choice=await dialog.showMessageBox({type:'error',title:'HisaFlow',message:'Duka halijapakuliwa / Shop download incomplete',detail:String(error.message),buttons:['Rudi / Return','Jaribu tena / Retry'],defaultId:0,cancelId:0});
    if(choice.response===0) {const r=registry.read();r.active=state.entry.returnTo;registry.write(r);}
    restart();return false;
  }
}
module.exports={completeWorkspaceDownload};
