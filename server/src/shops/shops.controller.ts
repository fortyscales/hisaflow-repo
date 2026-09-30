import { Body, Controller, Get, Inject, Post, Req, UseGuards, BadRequestException, Patch, Param, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PG } from '../db/db.module';
import { AuthGuard } from '../auth/auth.guard';
@Controller('shops') @UseGuards(AuthGuard)
export class ShopsController {
 constructor(@Inject(PG) private readonly db:Pool){}
 @Get('mine') async mine(@Req() req:any){ const r=await this.db.query(`SELECT s.id,s.name,m.role,s.created_at FROM shop_memberships m JOIN shops s ON s.id=m.shop_id WHERE m.user_id=$1 ORDER BY s.created_at`,[req.principal.userId]); return {shops:r.rows}; }

 @Get('overview') async overview(@Req() req:any){
  const r=await this.db.query(`
    SELECT s.id,s.name,m.role,s.created_at,s.updated_at,
      COALESCE((SELECT COUNT(*) FROM entity_snapshots e WHERE e.shop_id=s.id AND e.entity_type='product' AND e.deleted_at IS NULL),0)::int AS product_count,
      COALESCE((SELECT SUM(CASE WHEN (e.payload->>'stock') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (e.payload->>'stock')::numeric ELSE 0 END) FROM entity_snapshots e WHERE e.shop_id=s.id AND e.entity_type='product' AND e.deleted_at IS NULL),0)::float8 AS stock_units,
      COALESCE((SELECT COUNT(*) FROM entity_snapshots e WHERE e.shop_id=s.id AND e.entity_type='sale' AND e.deleted_at IS NULL),0)::int AS sale_count,
      COALESCE((SELECT SUM(CASE WHEN (e.payload->>'total_revenue') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (e.payload->>'total_revenue')::numeric ELSE 0 END) FROM entity_snapshots e WHERE e.shop_id=s.id AND e.entity_type='sale' AND e.deleted_at IS NULL),0)::float8 AS lifetime_revenue,
      COALESCE((SELECT SUM(CASE WHEN (e.payload->>'profit') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (e.payload->>'profit')::numeric ELSE 0 END) FROM entity_snapshots e WHERE e.shop_id=s.id AND e.entity_type='sale' AND e.deleted_at IS NULL),0)::float8 AS lifetime_profit,
      COALESCE((SELECT COUNT(*) FROM inventory_reconciliation_issues i WHERE i.shop_id=s.id AND i.status IN ('OPEN','ACKNOWLEDGED')),0)::int AS reconciliation_count,
      COALESCE((SELECT COUNT(*) FROM devices d WHERE d.shop_id=s.id AND d.revoked_at IS NULL),0)::int AS active_devices,
      (SELECT MAX(d.last_seen_at) FROM devices d WHERE d.shop_id=s.id) AS last_seen_at
    FROM shop_memberships m JOIN shops s ON s.id=m.shop_id
    WHERE m.user_id=$1 ORDER BY s.created_at`,[req.principal.userId]);
  return {shops:r.rows};
 }
 @Patch(':shopId') async rename(@Req() req:any,@Param('shopId') shopId:string,@Body() body:any){
  const name=String(body.name||'').trim(); if(!name) throw new BadRequestException('SHOP_NAME_REQUIRED');
  const access=await this.db.query('SELECT role FROM shop_memberships WHERE shop_id=$1 AND user_id=$2',[shopId,req.principal.userId]);
  if(!access.rowCount || !['owner','admin'].includes(access.rows[0].role)) throw new ForbiddenException('SHOP_ADMIN_REQUIRED');
  const r=await this.db.query('UPDATE shops SET name=$1,updated_at=now(),version=version+1 WHERE id=$2 RETURNING id,name,updated_at,version',[name,shopId]);
  return {shop:r.rows[0]};
 }
 @Post() async create(@Req() req:any,@Body() body:any){ const name=String(body.name||'').trim(); if(!name) throw new BadRequestException('SHOP_NAME_REQUIRED'); const c=await this.db.connect(); try{ await c.query('BEGIN'); const id=randomUUID(); await c.query('INSERT INTO shops(id,name) VALUES($1,$2)',[id,name]); await c.query("INSERT INTO shop_memberships(shop_id,user_id,role) VALUES($1,$2,'owner')",[id,req.principal.userId]); await c.query('COMMIT'); return {shop:{id,name,role:'owner'}}; }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();} }
}
