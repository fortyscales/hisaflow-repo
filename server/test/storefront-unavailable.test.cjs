require('reflect-metadata');
const assert=require('assert/strict');const {NotFoundException,BadRequestException}=require('@nestjs/common');
const {StorefrontPublicController}=require('../dist/storefront/storefront.controller');
const {renderStorefrontUnavailable}=require('../dist/storefront/storefront.page');
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;return this},status(v){this.statusCode=v;return this},type(v){this.contentType=v;return this},send(v){this.body=v;return this}}}
(async()=>{
for(const error of [new NotFoundException('STOREFRONT_NOT_AVAILABLE'),new BadRequestException('INVALID_SHOP_ID')]){const res=response();await new StorefrontPublicController({publicShop:async()=>{throw error}}).page('<script>bad</script>',res);assert.equal(res.statusCode,404);assert.equal(res.contentType,'html');assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['X-Robots-Tag'],'noindex');assert(res.headers['Content-Security-Policy'].includes("frame-ancestors 'none'"));assert(res.body.includes('This storefront is currently unavailable'));assert(res.body.includes('Duka hili halipatikani'));assert(!res.body.includes('<script>'));assert(!res.body.includes('INVALID_SHOP_ID'));assert(!res.body.includes('STOREFRONT_NOT_AVAILABLE'));}
const failure=new Error('database unavailable');await assert.rejects(()=>new StorefrontPublicController({publicShop:async()=>{throw failure}}).page('id',response()),e=>e===failure);
const res=response();await new StorefrontPublicController({publicShop:async()=>({name:'Public Shop',description:'',location:'',hours:'',language:'en',whatsapp:'255712345678',products:[]})}).page('id',res);assert.equal(res.statusCode,200);assert(res.body.includes('Public Shop'));assert(!res.body.includes('This storefront is currently unavailable'));
assert.notEqual(renderStorefrontUnavailable().csp,renderStorefrontUnavailable().csp);
console.log('PASS: unavailable/malformed public links return bilingual HTML 404, no private/error details, no-store/CSP; published page works; unexpected errors propagate');
})().catch(e=>{console.error(e);process.exitCode=1});
