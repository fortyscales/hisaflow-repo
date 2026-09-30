const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const base=require('path').resolve(__dirname,'..');
const esbuild=require(base+'/node_modules/esbuild');
let source=fs.readFileSync(base+'/src/screens/BusinessNetworkScreen.jsx','utf8');
source=source.replace(/^import .*;\n/gm,'');
source='const {useState,useEffect,useMemo,useRef}=React;\n'+source;
const code=esbuild.transformSync(source,{loader:'jsx',format:'cjs'}).code;
const hooks=[],effects=[];let index=0,initial=true,language='en';
const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),useState:value=>{const i=index++;if(!(i in hooks))hooks[i]=value;return [hooks[i],v=>hooks[i]=typeof v==='function'?v(hooks[i]):v]},useRef:value=>{const i=index++;if(!(i in hooks))hooks[i]={current:value};return hooks[i]},useMemo:fn=>fn(),useEffect:fn=>{if(initial)effects.push(fn)}};
let created=[],resolveCreate,rejectCreate;
const api={getSyncIdentity:async()=>({shopId:'A'}),getCloudSession:async()=>({configured:true}),listShopWorkspaces:async()=>({workspaces:[]}),getOwnerOverview:async()=>({shops:[{id:'A',name:'Source'},{id:'B',name:'Same name'},{id:'C',name:'Same name'}]}),createCloudShop:name=>{created.push(name);return new Promise((resolve,reject)=>{resolveCreate=resolve;rejectCreate=reject})}};
const moduleObj={exports:{}};vm.runInNewContext(code,{module:moduleObj,exports:moduleObj.exports,React,useLanguage:()=>({language}),window:{hisaflow:api},Building2:'icon',Plus:'icon',RefreshCw:'icon',AlertTriangle:'icon',Wifi:'icon',Package:'icon',Banknote:'icon'});
const render=()=>{index=0;const tree=moduleObj.exports.default();initial=false;return tree};
function nodes(tree){return [tree,...(tree?.children||[]).filter(c=>c&&typeof c==='object').flatMap(nodes)]}
const find=(tree,p)=>nodes(tree).find(p);
const text=node=>(node.children||[]).filter(c=>typeof c==='string').join('');
(async()=>{
 render();effects[0]();await new Promise(resolve=>setImmediate(resolve));let tree=render();
 find(tree,n=>n.type==='button'&&text(n)==='New shop').props.onClick();tree=render();assert(find(tree,n=>n.type==='form'));
 await find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(created.length,0);
 find(tree,n=>n.props.id==='new-shop-name').props.onChange({target:{value:'  HisaFlow Workspace Test 3  '}});tree=render();
 const form=find(tree,n=>n.type==='form');const pending=form.props.onSubmit({preventDefault(){}});await form.props.onSubmit({preventDefault(){}});assert.equal(created.length,1);assert.equal(created[0],'HisaFlow Workspace Test 3');
 resolveCreate();await pending;tree=render();assert(!find(tree,n=>n.type==='form'));
 find(tree,n=>n.type==='button'&&text(n)==='New shop').props.onClick();tree=render();find(tree,n=>n.props.id==='new-shop-name').props.onChange({target:{value:'Retry Shop'}});tree=render();const fail=find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});rejectCreate(new Error('Network unavailable'));await fail;tree=render();assert(find(tree,n=>n.props.role==='alert'&&text(n)==='Network unavailable'));assert.equal(find(tree,n=>n.props.id==='new-shop-name').props.value,'Retry Shop');find(tree,n=>n.type==='button'&&text(n)==='Cancel').props.onClick();assert(!find(render(),n=>n.type==='form'));
 // A committed creation with a failed refresh closes the form and warns outside it.
 find(tree,n=>n.type==='button'&&text(n)==='New shop').props.onClick();tree=render();
 find(tree,n=>n.props.id==='new-shop-name').props.onChange({target:{value:'Created shop'}});tree=render();
 const partial=find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});
 resolveCreate({shop:{id:'D'},accessReady:false});await partial;tree=render();
 assert(!find(tree,n=>n.type==='form'));assert(find(tree,n=>n.props.role==='status'&&text(n).includes('Shop created. Access refresh')));
 assert(find(tree,n=>text(n)==='Shop ID: B'));assert(find(tree,n=>text(n)==='Shop ID: C'));
 find(tree,n=>n.type==='button'&&text(n)==='Open shop').props.onClick();tree=render();
 assert(find(tree,n=>n.type==='input'&&n.props.type==='radio'&&n.props.checked===true));
 const labels=nodes(tree).filter(n=>n.type==='label');
 assert(labels.some(n=>text(n).includes('Create a new workspace')&&n.children.some(c=>c?.props?.checked===true)));
 console.log('PASS: duplicate-name cards expose distinct IDs; new workspace is default; committed creation with refresh failure closes form and explains recovery');
 language='sw';tree=render();assert(find(tree,n=>n.type==='button'&&text(n)==='Duka jipya'));
 console.log('PASS: actual component opens form, validates blank input, trims name, blocks duplicate submissions, closes on success, retains error/input on failure, cancels and localizes.');
})().catch(e=>{console.error(e);process.exitCode=1});
