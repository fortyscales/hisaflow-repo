import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG } from '../db/db.module';
export interface StoreDraft { name:string; description:string; location:string; hours:string; whatsapp:string; language:'sw'|'en'; products:{id:string; image:string}[]; }
function text(v:unknown, max:number, required=false):string {
 if(typeof v!=='string' || v.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new BadRequestException('STOREFRONT_INVALID_TEXT');
 const s=v.trim();if(required&&!s)throw new BadRequestException('STOREFRONT_NAME_REQUIRED');return s;
}
export function validateDraft(raw:any):StoreDraft {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new BadRequestException('STOREFRONT_INVALID_DRAFT');
 const phone=text(raw.whatsapp,40).replace(/[\s()+-]/g,'');
 if(phone&&!/^[1-9]\d{7,14}$/.test(phone))throw new BadRequestException('STOREFRONT_INTERNATIONAL_PHONE_REQUIRED');
 if(!['sw','en'].includes(raw.language))throw new BadRequestException('STOREFRONT_INVALID_LANGUAGE');
 if(!Array.isArray(raw.products)||raw.products.length>50)throw new BadRequestException('STOREFRONT_MAX_50_PRODUCTS');
 const ids=new Set<string>();let imageTotal=0;
 const products=raw.products.map((p:any)=>{
  const id=text(p?.id,160,true);if(ids.has(id))throw new BadRequestException('STOREFRONT_DUPLICATE_PRODUCT');ids.add(id);
  const image=p.image||'';
  if(typeof image!=='string'||image.length>85000)throw new BadRequestException('STOREFRONT_PHOTO_TOO_LARGE');
  if(image){
   if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))throw new BadRequestException('STOREFRONT_JPEG_REQUIRED');
   const bytes=Buffer.from(image.slice(23),'base64');if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new BadRequestException('STOREFRONT_JPEG_REQUIRED');
  }
  imageTotal+=image.length;return {id,image};
 });
 if(imageTotal>700000)throw new BadRequestException('STOREFRONT_PHOTOS_TOO_LARGE');
 return {name:text(raw.name,100,true),description:text(raw.description,600),location:text(raw.location,160),hours:text(raw.hours,160),whatsapp:phone,language:raw.language,products};
}
@Injectable()
export class StorefrontService {
 constructor(@Inject(PG) private readonly db:Pool){}
 private id(id:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new BadRequestException('INVALID_SHOP_ID');}
 private async access(c:Pool|PoolClient,user:string,shop:string){
  this.id(shop);const r=await c.query(`SELECT s.name FROM shop_memberships m JOIN shops s ON s.id=m.shop_id WHERE m.shop_id=$1 AND m.user_id=$2 AND m.role='owner'`,[shop,user]);
  if(!r.rowCount)throw new ForbiddenException('STOREFRONT_OWNER_REQUIRED');return r.rows[0].name;
 }
 async catalog(user:string,shop:string){await this.access(this.db,user,shop);return {products:await this.products(this.db,shop)};}
 private async products(c:Pool|PoolClient,shop:string,ids?:string[]){
  const r=await c.query(`SELECT entity_id,payload FROM entity_snapshots WHERE shop_id=$1 AND entity_type='product' AND deleted_at IS NULL ${ids?'AND entity_id=ANY($2::text[])':''} ORDER BY entity_id ${ids?'':'LIMIT 501'}`,ids?[shop,ids]:[shop]);
  if(!ids&&r.rows.length>500)throw new BadRequestException('STOREFRONT_CATALOG_LIMIT_500');
  return r.rows.map(row=>{
   const p=row.payload||{},price=Number(p.selling_price);
   return {id:row.entity_id,name:String(p.name||'').slice(0,160),category:String(p.category||'').slice(0,80),price:Number.isFinite(price)&&price>=0&&price<=1e12?price:null};
  });
 }
 async get(user:string,shop:string){
  const name=await this.access(this.db,user,shop);const r=await this.db.query('SELECT draft,revision,published_at,published IS NOT NULL AS live FROM storefronts WHERE shop_id=$1',[shop]);
  return r.rows[0]||{draft:{name,description:'',location:'',hours:'',whatsapp:'',language:'sw',products:[]},revision:0,published_at:null,live:false};
 }
 private revision(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<0)throw new BadRequestException('STOREFRONT_REVISION_REQUIRED');return Number(v);}
 private async transaction<T>(user:string,shop:string,fn:(c:PoolClient)=>Promise<T>):Promise<T>{
  const c=await this.db.connect();try{await c.query('BEGIN');await this.access(c,user,shop);
   // Lock the membership until the publication transaction finishes.
   const owner=await c.query("SELECT role FROM shop_memberships WHERE shop_id=$1 AND user_id=$2 FOR SHARE",[shop,user]);
   if(owner.rows[0]?.role!=='owner')throw new ForbiddenException('STOREFRONT_OWNER_REQUIRED');
   const result=await fn(c);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async save(user:string,shop:string,body:any){
  const draft=validateDraft(body?.draft),revision=this.revision(body?.revision);
  await this.transaction(user,shop,async c=>{
   await c.query('INSERT INTO storefronts(shop_id) VALUES($1) ON CONFLICT DO NOTHING',[shop]);
   const r=await c.query('UPDATE storefronts SET draft=$2,revision=revision+1,updated_at=now() WHERE shop_id=$1 AND revision=$3 RETURNING revision',[shop,JSON.stringify(draft),revision]);
   if(!r.rowCount)throw new ConflictException('STOREFRONT_CHANGED_RELOAD');
  });return this.get(user,shop);
 }
 private async snapshot(c:Pool|PoolClient,shop:string,draft:StoreDraft){
  if(!draft.whatsapp)throw new BadRequestException('STOREFRONT_WHATSAPP_REQUIRED');
  if(!draft.products.length)throw new BadRequestException('STOREFRONT_SELECT_PRODUCTS');
  const products=await this.products(c,shop,draft.products.map(p=>p.id));
  const map=new Map(products.map(p=>[p.id,p]));
  return {name:draft.name,description:draft.description,location:draft.location,hours:draft.hours,whatsapp:draft.whatsapp,language:draft.language,currency:'TZS',
   products:draft.products.map(selection=>{const p=map.get(selection.id);if(!p||!p.name||p.price===null)throw new BadRequestException('STOREFRONT_PRODUCT_UNAVAILABLE_SYNC_FIRST');return {...p,image:selection.image};})};
 }
 async preview(user:string,shop:string,body:any){await this.access(this.db,user,shop);return this.snapshot(this.db,shop,validateDraft(body?.draft));}
 async publish(user:string,shop:string,body:any){
  const revision=this.revision(body?.revision);
  await this.transaction(user,shop,async c=>{
   const r=await c.query('SELECT draft,revision FROM storefronts WHERE shop_id=$1 FOR UPDATE',[shop]);
   if(!r.rowCount||r.rows[0].revision!==revision)throw new ConflictException('STOREFRONT_CHANGED_RELOAD');
   const snapshot=await this.snapshot(c,shop,validateDraft(r.rows[0].draft));
   await c.query('UPDATE storefronts SET published=$2,published_at=now(),updated_at=now(),revision=revision+1 WHERE shop_id=$1',[shop,JSON.stringify(snapshot)]);
  });return this.get(user,shop);
 }
 async unpublish(user:string,shop:string,body:any){
  const revision=this.revision(body?.revision);
  await this.transaction(user,shop,async c=>{
   const r=await c.query('UPDATE storefronts SET published=NULL,published_at=NULL,updated_at=now(),revision=revision+1 WHERE shop_id=$1 AND revision=$2 RETURNING revision',[shop,revision]);
   if(!r.rowCount)throw new ConflictException('STOREFRONT_CHANGED_RELOAD');
  });return this.get(user,shop);
 }
 async publicShop(shop:string){this.id(shop);const r=await this.db.query('SELECT published FROM storefronts WHERE shop_id=$1 AND published IS NOT NULL',[shop]);if(!r.rowCount)throw new NotFoundException('STOREFRONT_NOT_AVAILABLE');return r.rows[0].published;}
}
