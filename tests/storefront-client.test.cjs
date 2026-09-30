const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
let pending=0;const calls=[];
const session={baseUrl:'http://127.0.0.1:4100',user:{id:'owner'},refreshToken:'refresh',accessToken:'access'};
const moduleObj={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/cloudSyncClient.js'),'utf8'),{module:moduleObj,process:{env:{}},AbortSignal,console,require:n=>n==='./syncService'?{identity:()=>({shopId:'active-shop'}),getSyncStatus:()=>({pending,deadLetter:0})}:{getSession:()=>session},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>JSON.stringify({revision:2})}}});
(async()=>{
 const api=moduleObj.exports;
 await api.storefront('save',{shopId:'other-shop',draft:{name:'Shop'},revision:1,pin:'SECRET'});assert(calls[0].url.includes('/active-shop/draft'));assert(!calls[0].options.body.includes('SECRET'));assert(!calls[0].options.body.includes('other-shop'));
 const get=await api.storefront('get');assert.equal(get.publicUrl,'http://127.0.0.1:4100/api/v1/storefront/public/active-shop');
 pending=1;const n=calls.length;await assert.rejects(api.storefront('publish',{revision:2}),/SYNC_FIRST/);assert.equal(calls.length,n);
 await assert.rejects(api.storefront('delete-everything'),/ACTION_INVALID/);
 console.log('PASS: active-workspace scoping, PIN excluded from network, publish blocked by pending events, unknown actions blocked');
})().catch(e=>{console.error(e);process.exitCode=1});
