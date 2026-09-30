let listeners = [];
let state = { status:'offline', lastSyncedAt:null, pending:0, conflicts:0, reconciliationIssues:0 };
function notify(){ for(const fn of listeners) fn({...state}); }
async function refreshStatus(){
  try {
    const [s, conflicts, cached] = await Promise.all([
      window.hisaflow.getSyncStatus(),
      window.hisaflow.getSyncConflicts(100),
      window.hisaflow.getCachedReconciliationIssues(),
    ]);
    state={...state,...s,status:s?.lastSuccessfulSyncAt?'synced':'offline',lastSyncedAt:s?.lastSuccessfulSyncAt||null,conflicts:(conflicts||[]).filter(x=>!x.resolved_at).length,reconciliationIssues:(cached||[]).filter(x=>x.status!=='RESOLVED').length};
  } catch { state={...state,status:'offline'}; }
  notify(); return {...state};
}
export const syncService={
  getStatus:()=>({...state}),
  onStatusChange(callback){ listeners.push(callback); refreshStatus(); return()=>{listeners=listeners.filter(fn=>fn!==callback)}; },
  async triggerSync(){
    state={...state,status:'syncing'}; notify();
    try { const r=await window.hisaflow.triggerCloudSync(); state={...state,...(r?.status||{}),status:r?.success?'synced':'error',lastSyncedAt:r?.status?.lastSuccessfulSyncAt||state.lastSyncedAt}; await refreshStatus(); return r; }
    catch(e){ state={...state,status:'error'}; notify(); return {success:false,reason:'sync_failed',error:String(e?.message||e)}; }
  },
  refreshStatus,
};
