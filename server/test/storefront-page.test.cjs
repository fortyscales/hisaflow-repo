const assert=require('node:assert/strict'),vm=require('node:vm');
const {storefrontScript,renderStorefront}=require('../dist/storefront/storefront.page');
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.textContent='';this.value='';this.dataset={};this.disabled=false;this.attrs={};}
 append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}setAttribute(k,v){this.attrs[k]=v}
}
function fixture(preview=false){
 const shop={name:'Kariakoo & Sons',description:'Tea',whatsapp:'255712345678',language:'sw',location:'Dar',hours:'8–19',products:Array.from({length:14},(_,i)=>({id:'p'+i,name:'Tea '+i,category:i%2?'Food':'Drinks',price:1500,image:''}))};
 const ids={};for(const id of ['store-data','note','cart-items','total','checkout','basket-count','cart-status','search','category','products','toggle-language'])ids[id]=new Element();
 ids['store-data'].textContent=JSON.stringify(shop);
 let opened=null;
 const document={body:{dataset:{preview:String(preview)}},documentElement:{},getElementById:id=>ids[id],createElement:tag=>new Element(tag),querySelectorAll:()=>[]};
 vm.runInNewContext(storefrontScript,{document,window:{open:(...args)=>{opened=args}},location:{href:'https://shop.test/s/a'},console});
 const flat=n=>[n,...n.children.flatMap(flat)];
 return {shop,ids,document,opened:()=>opened,buttons:()=>flat(ids.products).filter(n=>n.tagName==='button'),cartButtons:()=>flat(ids['cart-items']).filter(n=>n.tagName==='button')};
}
const f=fixture();assert.equal(f.buttons().length,14);f.buttons()[0].onclick();f.buttons()[0].onclick();assert.equal(f.ids['total'].textContent,'TZS 3,000');assert.equal(f.ids['basket-count'].textContent,'2');
f.ids.note.value='Pickup & delivery?';f.ids.checkout.onclick();const args=f.opened(),u=new URL(args[0]);assert.equal(u.origin,'https://wa.me');assert.equal(u.pathname,'/255712345678');assert(u.searchParams.get('text').includes('2 × Tea 0'));assert(u.searchParams.get('text').includes('Pickup & delivery?'));assert.equal(args[2],'noopener,noreferrer');
f.ids.search.value='missing';f.ids.search.oninput();assert.equal(f.buttons().length,0);f.ids.search.value='';f.ids.search.oninput();assert.equal(f.buttons().length,14);
f.ids.category.value='Food';f.ids.category.onchange();assert.equal(f.buttons().length,7);f.ids.category.value='';f.ids.category.onchange();
f.ids['toggle-language'].onclick();assert.equal(f.document.documentElement.lang,'en');assert.equal(f.ids['basket-count'].textContent,'2');
for(let i=0;i<14;i++)f.buttons()[i].onclick();assert(f.ids['cart-status'].textContent.includes('12'));assert.equal(f.cartButtons().length,36);
const p=fixture(true);p.buttons()[0].onclick();assert.equal(p.ids.checkout.disabled,true);p.ids.checkout.onclick();assert.equal(p.opened(),null);
const rendered=renderStorefront(f.shop,true);assert(!rendered.html.includes(storefrontScript));assert(rendered.html.includes('Tea 0'));assert(rendered.html.includes('WhatsApp imezimwa'));
console.log('PASS: public runtime basket totals, encoded WhatsApp message, search/category recovery, language preservation, item limit, preview blocked; static preview contains products');
