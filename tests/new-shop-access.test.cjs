const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
function fixture(o={}){
 let session={baseUrl:'http://test',user:{id:'owner'},accessToken:'old',refreshToken:'r0',memberships:[{shopId:'A',role:'owner'}]};
 let created=false,posts=0,refreshes=0,registers=0,shopId='A';
 const calls=[];
 const store={getSession:()=>structuredClone(session),saveSession:s=>session={...session,...s},publicSession:()=>({configured:!!session.refreshToken}),clearSession:()=>{session={}}};
 const response=(status,body)=>({ok:status<400,status,text:async()=>JSON.stringify(body)});
 const fetch=async(url,args)=>{
  const p=new URL(url).pathname;calls.push(p);
  if(p.endsWith('/auth/refresh')){
   refreshes++;
   if(o.logout)store.clearSession();
   if(o.changeAccount)session={...session,user:{id:'different'},refreshToken:'new-login'};
   if(o.failRefresh)throw new Error('fetch failed');
   const memberships=created&&!o.noMembership&&!(o.staleFirst&&refreshes===1)?[{shopId:'A'},{shopId:'B'}]:[{shopId:'A'}];
   return response(200,{accessToken:memberships.length===2?'new':'old',refreshToken:'r'+refreshes,memberships});
  }
  if(p.endsWith('/shops')&&args.method==='POST'){posts++;created=true;return response(200,{shop:{id:'B',name:'Same name'}})}
  if(p.endsWith('/shops/mine'))return response(200,{shops:o.revoked?[]:[{id:'A'},{id:'B'}]});
  if(p.endsWith('/devices/register')){
   registers++;
   if(o.deviceRevoked)return response(403,{message:'DEVICE_REVOKED'});
   if(shopId==='B'&&(args.headers.authorization!=='Bearer new'||o.stillDenied))return response(403,{message:'SHOP_ACCESS_DENIED'});
   return response(200,{success:true});
  }
  throw new Error('Unexpected '+p);
 };
 const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/cloudSyncClient.js'),'utf8'),{module:mod,require:n=>n==='./syncService'?{identity:()=>({shopId,deviceId:'device'})}:store,process:{env:{}},fetch,AbortSignal,console});
 return {api:mod.exports,o,store,select:()=>{shopId='B'},created:()=>{created=true},state:()=>({session,posts,refreshes,registers,calls})};
}
(async()=>{
 const f=fixture();const result=await f.api.createShop('Same name');assert.equal(result.accessReady,true);f.select();await f.api.registerDevice();assert.equal(f.state().posts,1);assert.equal(f.state().refreshes,1);assert.equal(f.state().registers,1);
 console.log('PASS: create refreshes access before opening the new shop, without another sign-in');
 const late=fixture({staleFirst:true});assert.equal((await late.api.createShop('B')).accessReady,true);assert.equal(late.state().refreshes,2);
 const fail=fixture({failRefresh:true});const r=await fail.api.createShop('B');assert.equal(r.shop.id,'B');assert.equal(r.accessReady,false);fail.o.failRefresh=false;fail.select();await fail.api.registerDevice();assert.equal(fail.state().posts,1);assert.equal(fail.state().registers,2);
 console.log('PASS: stale refresh bounded recovery; committed creation survives refresh failure, opening retries access without another POST');
 for(const opts of [{revoked:true},{deviceRevoked:true}]){const g=fixture(opts);g.created();g.select();await assert.rejects(g.api.registerDevice());assert.equal(g.state().refreshes,0);}
 const denied=fixture({stillDenied:true});denied.created();denied.select();await assert.rejects(denied.api.registerDevice());assert.equal(denied.state().registers,2);
 const absent=fixture({noMembership:true});assert.equal((await absent.api.createShop('B')).accessReady,false);assert.equal(absent.state().refreshes,2);
 console.log('PASS: revoked membership/device remains denied; retries bounded; missing claims never report ready');
 for(const opts of [{logout:true},{changeAccount:true}]){const g=fixture(opts);assert.equal((await g.api.createShop('B')).accessReady,false);assert.notEqual(g.state().session.accessToken,'new');}
 console.log('PASS: logout or account change during refresh cannot restore the previous account');
})().catch(e=>{console.error(e);process.exitCode=1});
