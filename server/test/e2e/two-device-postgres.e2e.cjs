const assert = require('assert');
const { randomUUID } = require('crypto');

const base = process.env.HISAFLOW_E2E_URL || 'http://127.0.0.1:4100/api/v1';
async function req(path, options={}) {
  const r=await fetch(base+path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const text=await r.text(); let body; try{body=text?JSON.parse(text):null}catch{body=text}
  if(!r.ok) throw new Error(`${r.status} ${path}: ${typeof body==='string'?body:JSON.stringify(body)}`);
  return body;
}
const auth=(token)=>({authorization:`Bearer ${token}`});
async function main(){
  const stamp=Date.now(); const email=`sync-e2e-${stamp}@hisaflow.test`; const password='IntegrationPass123!';
  const reg=await req('/auth/register',{method:'POST',body:JSON.stringify({email,password,displayName:'Sync Test',businessName:'Two Device Test'})});
  assert(reg.accessToken && reg.shop?.id); const shopId=reg.shop.id;
  const loginB=await req('/auth/login',{method:'POST',body:JSON.stringify({email,password})});
  const deviceA=randomUUID(), deviceB=randomUUID();
  await req('/devices/register',{method:'POST',headers:auth(reg.accessToken),body:JSON.stringify({shopId,deviceId:deviceA,name:'Device A'})});
  await req('/devices/register',{method:'POST',headers:auth(loginB.accessToken),body:JSON.stringify({shopId,deviceId:deviceB,name:'Device B'})});
  const productId=`product_${randomUUID()}`; const eventA=`evt_${randomUUID()}`;
  const envelope=(over={})=>({protocolVersion:1,eventId:eventA,entityType:'product',entityId:productId,operation:'UPSERT',shopId,deviceId:deviceA,occurredAt:new Date().toISOString(),entityVersion:1,payload:{id:productId,name:'E2E Sugar',version:1},...over});
  let push=await req('/sync/push',{method:'POST',headers:auth(reg.accessToken),body:JSON.stringify({shopId,deviceId:deviceA,events:[envelope()]})});
  assert.equal(push.results[0].status,'ACK');
  // Duplicate delivery must ACK without a second change.
  push=await req('/sync/push',{method:'POST',headers:auth(reg.accessToken),body:JSON.stringify({shopId,deviceId:deviceA,events:[envelope()]})});
  assert.equal(push.results[0].status,'ACK'); assert.equal(push.results[0].duplicate,true);
  const pulled=await req(`/sync/pull?shopId=${shopId}&deviceId=${deviceB}&after=0&limit=50`,{headers:auth(loginB.accessToken)});
  assert(pulled.changes.some(x=>x.event_id===eventA && x.source_device_id===deviceA));
  // Same entity/version from B is a deliberate concurrent conflict, never silent LWW.
  const eventB=`evt_${randomUUID()}`;
  const conflict=await req('/sync/push',{method:'POST',headers:auth(loginB.accessToken),body:JSON.stringify({shopId,deviceId:deviceB,events:[envelope({eventId:eventB,deviceId:deviceB,payload:{id:productId,name:'Conflicting name',version:1}})]})});
  assert.equal(conflict.results[0].status,'CONFLICT'); assert.equal(conflict.results[0].code,'CONCURRENT_VERSION');
  // A device ID that was never registered cannot impersonate a shop device.
  let rejected=false; try { await req('/sync/push',{method:'POST',headers:auth(reg.accessToken),body:JSON.stringify({shopId,deviceId:randomUUID(),events:[]})}); } catch(e){ rejected=/DEVICE_NOT_REGISTERED_FOR_SHOP/.test(e.message); }
  assert(rejected);
  // Revocation is enforced on BOTH directions: a revoked device can neither push nor pull.
  await req('/devices/revoke',{method:'POST',headers:auth(reg.accessToken),body:JSON.stringify({shopId,deviceId:deviceB})});
  let revokedPull=false; try { await req(`/sync/pull?shopId=${shopId}&deviceId=${deviceB}&after=0&limit=50`,{headers:auth(loginB.accessToken)}); } catch(e){ revokedPull=/DEVICE_NOT_REGISTERED_FOR_SHOP/.test(e.message); }
  assert(revokedPull);
  let revokedPush=false; try { await req('/sync/push',{method:'POST',headers:auth(loginB.accessToken),body:JSON.stringify({shopId,deviceId:deviceB,events:[]})}); } catch(e){ revokedPush=/DEVICE_NOT_REGISTERED_FOR_SHOP/.test(e.message); }
  assert(revokedPush);
  console.log('two-device PostgreSQL/HTTP integration: PASS');
}
main().catch(e=>{console.error(e);process.exit(1)});
