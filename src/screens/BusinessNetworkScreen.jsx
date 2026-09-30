import React, { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Plus, RefreshCw, AlertTriangle, Wifi, Package, Banknote } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";

const money = n => `TZS ${Math.round(Number(n)||0).toLocaleString("sw-TZ")}`;
export default function BusinessNetworkScreen(){
  const { language }=useLanguage(); const sw=language!=="en";
  const [data,setData]=useState([]),[identity,setIdentity]=useState(null),[session,setSession]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [email,setEmail]=useState(""),[password,setPassword]=useState("");
  const [connectingShopId,setConnectingShopId]=useState(null);
  const [workspaces,setWorkspaces]=useState([]),[switchShop,setSwitchShop]=useState(null),[ownerPin,setOwnerPin]=useState('');
  const [switchMode,setSwitchMode]=useState('existing');
  const [createOpen,setCreateOpen]=useState(false),[shopName,setShopName]=useState(''),[createError,setCreateError]=useState('');
  const [notice,setNotice]=useState('');
  const creatingRef=useRef(false),newShopButton=useRef(null);
  const closeCreate=()=>{if(creatingRef.current)return;setCreateOpen(false);setShopName('');setCreateError('');newShopButton.current?.focus();};
  const bound=data.some(s=>s.id===identity?.shopId);
  const switchError=e=>{
    const msg=e?.message||String(e);
    const messages={
      OWNER_PIN_REQUIRED:sw?'Weka PIN sahihi ya mmiliki wa duka hili.':'Enter this shop owner’s correct PIN.',
      WORKSPACE_SYNC_REQUIRED:sw?'Sawazisha mabadiliko yanayosubiri na kagua makosa kabla ya kubadilisha duka.':'Sync pending changes and resolve failed events before switching.',
      WORKSPACE_ALREADY_OPEN:sw?'Funga dirisha jingine la duka hili kwanza.':'Close the other window using this workspace first.',
      WORKSPACE_WRONG_SHOP:sw?'Folda hiyo si ya duka ulilochagua.':'That folder belongs to a different shop.',
      WORKSPACE_ACCOUNT_CHANGED:sw?'Workspace hii imeunganishwa na akaunti au seva nyingine.':'This workspace is linked to a different account or server.',
      WORKSPACE_OWNER_ACCESS_REQUIRED:sw?'Unahitaji ruhusa ya mmiliki katika maduka yote mawili.':'You need owner access to both shops.',
      WORKSPACE_DUPLICATE_DEVICE:sw?'Workspace hii ina kitambulisho cha kifaa kinachotumika tayari.':'This workspace duplicates an existing device identity.'
    };
    return Object.entries(messages).find(([key])=>msg.includes(key))?.[1]||msg;
  };
  const requestSwitch=shop=>{setError('');setOwnerPin('');setSwitchMode(workspaces.some(w=>w.shopId===shop.id)?'saved':'new');setSwitchShop(shop);};
  const performSwitch=async()=>{
    setBusy(true);setError('');
    try{
      const result=await window.hisaflow.openShopWorkspace({shopId:switchShop.id,pin:ownerPin,mode:switchMode});
      if(result?.canceled||result?.unchanged){setBusy(false);return;}
    }catch(e){setError(switchError(e));setBusy(false);}
  };
  const load=async()=>{ setBusy(true); setError(""); try{
    const [i,s]=await Promise.all([window.hisaflow.getSyncIdentity(),window.hisaflow.getCloudSession()]);
    setIdentity(i); setSession(s);
    setWorkspaces((await window.hisaflow.listShopWorkspaces())?.workspaces||[]);
    if(s?.configured){ const o=await window.hisaflow.getOwnerOverview(); setData(o?.shops||[]); } else setData([]);
  }catch(e){setError(e?.message||String(e));}finally{setBusy(false);} };
  const signIn=async()=>{
    setError("");
    if(!email.trim()||!password){setError(sw?"Weka barua pepe na nenosiri.":"Enter your email and password.");return;}
    setBusy(true);
    try{
      const result=await window.hisaflow.cloudLogin({email:email.trim(),password});
      setSession(await window.hisaflow.getCloudSession());
      const o=await window.hisaflow.getOwnerOverview(); setData(o?.shops||[]);
      setIdentity(await window.hisaflow.getSyncIdentity());
      if(result?.needsShopSelection){ setError(sw?"Chagua duka la kuunganisha hapa chini.":"Choose the shop to connect below."); }
    }catch(e){setError(e?.message||String(e));}finally{setBusy(false);}
  };
  useEffect(()=>{load();},[]);
  const totals=useMemo(()=>data.reduce((a,x)=>({revenue:a.revenue+Number(x.lifetime_revenue||0),profit:a.profit+Number(x.lifetime_profit||0),stock:a.stock+Number(x.stock_units||0),issues:a.issues+Number(x.reconciliation_count||0)}),{revenue:0,profit:0,stock:0,issues:0}),[data]);
  const create=async(event)=>{
    event.preventDefault();
    if(creatingRef.current)return;
    const name=shopName.trim();
    if(!name){setCreateError(sw?'Weka jina la duka.':'Enter a shop name.');return;}
    creatingRef.current=true;setBusy(true);setCreateError('');
    try{
      const result=await window.hisaflow.createCloudShop(name);
      setCreateOpen(false);setShopName('');newShopButton.current?.focus();
      await load();
      setNotice(result?.accessReady===false
        ? (sw?'Duka limetengenezwa. Uthibitisho wa ruhusa haujakamilika. Fungua duka kujaribu tena; usilitengeneze tena.':'Shop created. Access refresh could not finish. Open the shop to retry; do not create it again.')
        : (sw?'Duka limetengenezwa. Chagua Fungua duka kuendelea.':'Shop created. Choose Open shop to continue.'));
    }catch(e){setCreateError(e?.message||String(e));}
    finally{creatingRef.current=false;setBusy(false);}
  };
  const connectShop=async(shop)=>{
    setError(""); setConnectingShopId(shop.id);
    try{
      const result=await window.hisaflow.joinCloudShop(shop.id);
      const nextIdentity=result?.identity || await window.hisaflow.getSyncIdentity();
      setIdentity(nextIdentity);
      await load();
    }catch(e){
      const msg=e?.message||String(e);
      if(/ADOPTION|existing local|fresh|pending/i.test(msg)) setError(sw?"Duka hili la ndani tayari lina data. HisaFlow imezuia kuunganisha ili data za maduka zisichanganywe.":"This local shop already contains data. HisaFlow blocked the connection so shop data cannot be mixed.");
      else setError(msg);
    }finally{setConnectingShopId(null);}
  };
  if(!session?.configured) return <div style={st.page}><div style={{maxWidth:520,margin:"40px auto",background:"var(--surface)",borderWidth:1,borderStyle:"solid",borderColor:"var(--border-muted)",borderRadius:16,padding:24}}><h1 style={st.h1}>{sw?"Maduka Yangu":"My Shops"}</h1><p style={st.sub}>{sw?"Ingia kwenye akaunti yako ya HisaFlow kuona maduka yote unayomiliki. Huhitaji kuweka anwani ya seva.":"Sign in to your HisaFlow account to see all shops you own. No server address is required."}</p>{error&&<div style={st.err}>{error}</div>}<input style={st.input} value={email} onChange={e=>setEmail(e.target.value)} placeholder={sw?"Barua pepe":"Email"} autoFocus/><input style={st.input} type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyUp={e=>e.key==="Enter"&&signIn()} placeholder={sw?"Nenosiri":"Password"}/><button style={{...st.primary,width:"100%",justifyContent:"center"}} disabled={busy} onClick={signIn}>{busy?(sw?"Inaingia...":"Signing in..."):(sw?"Ingia kwenye akaunti":"Sign in to account")}</button><div style={st.safe}>{sw?"Data ya duka hili haitabadilishwa au kuchanganywa kwa kuingia tu. Kubadilisha duka kutatumia workspace salama iliyotengwa.":"Signing in alone never relabels or mixes this shop's local data. Shop switching will use isolated workspaces."}</div></div></div>;
  return <div style={st.page}><div style={st.head}><div><h1 style={st.h1}>{sw?"Mtandao wa Biashara":"Business Network"}</h1><p style={st.sub}>{sw?"Muonekano wa mmiliki wa maduka yote kwenye akaunti moja.":"Owner view of every shop under one account."}</p></div><div style={{display:"flex",gap:8}}><button style={st.btn} disabled={busy} onClick={load}><RefreshCw size={16}/>{sw?"Onyesha upya":"Refresh"}</button><button ref={newShopButton} style={st.primary} disabled={busy} onClick={()=>{setShopName('');setCreateError('');setCreateOpen(true);}}><Plus size={16}/>{sw?"Duka jipya":"New shop"}</button></div></div>
  {error&&<div style={st.err}>{error}</div>}
  {notice&&<div role="status" style={st.safe}>{notice}</div>}
  <div style={st.metrics}><Metric label={sw?"Maduka":"Shops"} value={data.length}/><Metric label={sw?"Mauzo yote":"Lifetime revenue"} value={money(totals.revenue)}/><Metric label={sw?"Faida yote":"Lifetime profit"} value={money(totals.profit)}/><Metric label={sw?"Vipande stokini":"Stock units"} value={totals.stock.toLocaleString("sw-TZ")}/></div>
  <div style={st.grid}>{data.map(x=>{const active=x.id===identity?.shopId;return <div key={x.id} style={{...st.card,...(active?st.active:{})}}><div style={st.cardTop}><div style={st.icon}><Building2 size={20}/></div><div style={{flex:1}}><div style={st.name}>{x.name}</div><div style={{...st.safe,marginTop:4,overflowWrap:"anywhere"}}>{sw?"Kitambulisho cha duka":"Shop ID"}: {x.id}</div><div style={st.role}>{x.role}{active?(sw?" · Duka hili":" · This device"):""}</div></div>{Number(x.reconciliation_count)>0&&<AlertTriangle size={18}/>}</div><div style={st.row}><span><Package size={14}/> {sw?"Bidhaa":"Products"}</span><b>{x.product_count||0}</b></div><div style={st.row}><span><Banknote size={14}/> {sw?"Mauzo":"Revenue"}</span><b>{money(x.lifetime_revenue)}</b></div><div style={st.row}><span><Wifi size={14}/> {sw?"Vifaa":"Devices"}</span><b>{x.active_devices||0}</b></div><div style={st.row}><span>{sw?"Masuala ya stock":"Stock issues"}</span><b>{x.reconciliation_count||0}</b></div>{!active&&<button style={{...st.primary,width:"100%",justifyContent:"center",marginTop:12}} disabled={busy||Boolean(connectingShopId)} onClick={()=>bound?requestSwitch(x):connectShop(x)}>{connectingShopId===x.id?(sw?"Inaunganisha...":"Connecting..."):(bound?(sw?"Fungua duka":"Open shop"):(sw?"Unganisha duka hili kwenye kifaa":"Connect this shop to this device"))}</button>}{active&&<div style={st.connected}>{sw?"Duka linalotumika kwenye kifaa hiki":"Active shop on this device"}</div>}</div>})}</div>
  {!busy&&!data.length&&<div style={st.empty}>{sw?"Hakuna duka la cloud bado.":"No cloud shops yet."}</div>}
  <div style={st.note}>{sw?"Kila duka lina workspace yake. Unapobadilisha duka, HisaFlow itafunguka upya na kuomba PIN ya duka hilo. Intaneti inahitajika kuthibitisha ruhusa wakati wa kubadilisha.":"Each shop has its own workspace. Switching reopens HisaFlow and asks for that shop’s PIN. An internet connection is required to verify access when switching."}</div>
  {createOpen&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'grid',placeItems:'center',zIndex:10000}}>
    <form role="dialog" aria-modal="true" aria-labelledby="create-shop-title" aria-busy={busy} onSubmit={create}
      onKeyDown={e=>{
        if(e.key==='Escape'){e.preventDefault();closeCreate();}
        if(e.key==='Tab'){
          const fields=Array.from(e.currentTarget.querySelectorAll('input:not(:disabled),button:not(:disabled)'));
          const first=fields[0],last=fields[fields.length-1];
          if(!first){e.preventDefault();return;}
          if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
          else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
        }
      }}
      style={{background:'var(--surface)',color:'var(--text)',borderRadius:16,padding:24,width:460,maxWidth:'90vw',boxSizing:'border-box'}}>
      <h2 id="create-shop-title" style={{marginTop:0}}>{sw?'Duka jipya':'New shop'}</h2>
      <label htmlFor="new-shop-name">{sw?'Jina la duka':'Shop name'}</label>
      <input id="new-shop-name" style={st.input} autoFocus value={shopName} disabled={busy} onChange={e=>{setShopName(e.target.value);setCreateError('');}} placeholder={sw?'Mfano: Duka la Kariakoo':'Example: Kariakoo Shop'}/>
      {createError&&<p role="alert" style={st.err}>{createError}</p>}
      <div style={{display:'flex',gap:10,marginTop:18,justifyContent:'flex-end'}}>
        <button type="button" style={st.btn} disabled={busy} onClick={closeCreate}>{sw?'Ghairi':'Cancel'}</button>
        <button type="submit" style={st.primary} disabled={busy||!shopName.trim()}>{busy?(sw?'Inatengeneza...':'Creating...'):(sw?'Tengeneza duka':'Create shop')}</button>
      </div>
    </form>
  </div>}
  {switchShop&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'grid',placeItems:'center',zIndex:10000}} role="dialog" aria-modal="true" aria-labelledby="switch-title">
    <div style={{background:'var(--surface)',color:'var(--text)',borderRadius:16,padding:24,width:460,maxWidth:'90vw'}}>
      <h2 id="switch-title" style={{marginTop:0}}>{sw?'Fungua':'Open'} {switchShop.name}</h2><p style={{...st.safe,overflowWrap:'anywhere'}}>{sw?'Kitambulisho cha duka':'Shop ID'}: {switchShop.id}</p>
      {switchMode!=='saved'&&<>
        <p>{sw?'Je, duka hili tayari lina workspace kwenye kompyuta hii?':'Does this shop already have a workspace on this computer?'}</p>
        <label style={{display:'block',marginBottom:12}}><input type="radio" checked={switchMode==='existing'} disabled={busy} onChange={()=>setSwitchMode('existing')}/> {sw?'Chagua workspace iliyopo':'Choose existing workspace'}</label>
        <label style={{display:'block'}}><input type="radio" checked={switchMode==='new'} disabled={busy} onChange={()=>setSwitchMode('new')}/> {sw?'Tengeneza workspace mpya':'Create a new workspace'}</label>
        <p style={st.safe}>{switchMode==='existing'?(sw?'Chagua folda yenye hisaflow.db ya duka hili. Data na kitambulisho cha kifaa vitahifadhiwa.':'Select the folder containing this shop’s hisaflow.db. Its data and device identity will be preserved.'):(sw?'Workspace mpya itapakua data ya cloud na kutumia PIN yako ya sasa. Akaunti za malipo na nyaraka zilizohifadhiwa ndani ya workspace nyingine hazitahamishwa.':'The new workspace will download cloud data and use your current owner PIN. Payment account settings and documents stored only in another workspace will not transfer.')}</p>
      </>}
      <p style={st.safe}>{sw?'Hifadhi kazi yako kwanza. HisaFlow itafunguka upya baada ya kubadilisha.':'Save your work first. HisaFlow will reopen after switching.'}</p>
      <input aria-label={sw?'PIN ya mmiliki':'Owner PIN'} autoFocus style={st.input} type="password" inputMode="numeric" value={ownerPin} disabled={busy} onChange={e=>setOwnerPin(e.target.value)} placeholder={sw?'PIN ya mmiliki wa duka la sasa':'Current shop owner PIN'}/>
      {error&&<p role="alert" style={st.err}>{error}</p>}
      <div style={{display:'flex',gap:10,marginTop:18,justifyContent:'flex-end'}}>
        <button style={st.btn} disabled={busy} onClick={()=>{setSwitchShop(null);setOwnerPin('');setError('');}}>{sw?'Ghairi':'Cancel'}</button>
        <button style={st.primary} disabled={busy||!ownerPin} onClick={performSwitch}>{busy?(sw?'Inafungua...':'Opening...'):(sw?'Endelea':'Continue')}</button>
      </div>
    </div>
  </div>}
  </div>;
}
function Metric({label,value}){return <div style={st.metric}><div style={st.metricLabel}>{label}</div><div style={st.metricValue}>{value}</div></div>}
const st={input:{width:"100%",boxSizing:"border-box",padding:"11px 12px",marginTop:12,borderWidth:1,borderStyle:"solid",borderColor:"var(--border-muted)",borderRadius:9,background:"var(--bg)",color:"var(--text)"},safe:{fontSize:12,color:"var(--text-muted)",marginTop:14,lineHeight:1.5},page:{padding:28,overflow:"auto",width:"100%"},head:{display:"flex",justifyContent:"space-between",gap:20,alignItems:"flex-start",marginBottom:20},h1:{margin:0,fontSize:26},sub:{margin:"6px 0 0",color:"var(--text-muted)"},btn:{display:"flex",alignItems:"center",gap:7,padding:"9px 12px",borderWidth:1,borderStyle:"solid",borderColor:"var(--border-muted)",borderRadius:9,background:"var(--surface)",cursor:"pointer"},primary:{display:"flex",alignItems:"center",gap:7,padding:"9px 12px",border:0,borderRadius:9,background:"var(--primary)",color:"white",cursor:"pointer"},metrics:{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:12,marginBottom:18},metric:{background:"var(--surface)",borderWidth:1,borderStyle:"solid",borderColor:"var(--border-muted)",borderRadius:12,padding:16},metricLabel:{fontSize:12,color:"var(--text-muted)"},metricValue:{fontSize:20,fontWeight:700,marginTop:5},grid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14},card:{background:"var(--surface)",borderWidth:1,borderStyle:"solid",borderColor:"var(--border-muted)",borderRadius:14,padding:16},active:{borderColor:"var(--primary)"},cardTop:{display:"flex",alignItems:"center",gap:10,marginBottom:14},icon:{width:38,height:38,borderRadius:10,display:"grid",placeItems:"center",background:"var(--bg)"},name:{fontWeight:700,fontSize:16},role:{fontSize:12,color:"var(--text-muted)",textTransform:"capitalize"},row:{display:"flex",justifyContent:"space-between",padding:"8px 0",borderTopWidth:1,borderTopStyle:"solid",borderTopColor:"var(--border-muted)",fontSize:13},err:{padding:12,borderRadius:9,marginBottom:14,background:"var(--surface)",color:"var(--danger)"},empty:{padding:30,textAlign:"center",color:"var(--text-muted)"},connected:{marginTop:12,padding:"9px 10px",borderRadius:9,textAlign:"center",fontSize:12,fontWeight:700,background:"var(--bg)",color:"var(--primary)"},note:{marginTop:18,fontSize:12,color:"var(--text-muted)",maxWidth:900}};
