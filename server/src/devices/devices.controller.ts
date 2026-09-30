import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../db/db.module';
import { AuthGuard } from '../auth/auth.guard';
import { assertShopAccess } from '../common/tenant';
@Controller('devices') @UseGuards(AuthGuard)
export class DevicesController {
  constructor(@Inject(PG) private readonly db: Pool) {}
  private async assertAdmin(userId:string, shopId:string) {
    const q=await this.db.query(`SELECT role FROM shop_memberships WHERE user_id=$1 AND shop_id=$2`,[userId,shopId]);
    if (!q.rows[0] || !['owner','admin'].includes(q.rows[0].role)) throw new ForbiddenException('DEVICE_ADMIN_REQUIRED');
  }
  @Post('register') async register(@Req() req:any,@Body() body:any) {
    assertShopAccess(req.principal,body.shopId); if(!body.deviceId) throw new BadRequestException('DEVICE_ID_REQUIRED');
    const existing=await this.db.query(`SELECT shop_id,revoked_at FROM devices WHERE id=$1`,[body.deviceId]);
    if(existing.rows[0] && existing.rows[0].shop_id!==body.shopId) throw new ForbiddenException('DEVICE_BELONGS_TO_ANOTHER_SHOP');
    if(existing.rows[0]?.revoked_at) throw new ForbiddenException('DEVICE_REVOKED');
    await this.db.query(`INSERT INTO devices(id,shop_id,name,last_seen_at) VALUES($1,$2,$3,now())
      ON CONFLICT(id) DO UPDATE SET name=COALESCE(excluded.name,devices.name),last_seen_at=now(),updated_at=now()`,[body.deviceId,body.shopId,body.name||null]);
    return {ok:true,deviceId:body.deviceId};
  }
  @Get() async list(@Req() req:any,@Query('shopId') shopId:string) {
    assertShopAccess(req.principal,shopId);
    const q=await this.db.query(`SELECT id,name,last_seen_at,created_at,updated_at,revoked_at FROM devices WHERE shop_id=$1 ORDER BY revoked_at NULLS FIRST,last_seen_at DESC NULLS LAST,created_at DESC`,[shopId]);
    return {ok:true,devices:q.rows};
  }
  @Post('rename') async rename(@Req() req:any,@Body() body:any) {
    assertShopAccess(req.principal,body.shopId); await this.assertAdmin(req.principal.userId,body.shopId);
    const q=await this.db.query(`UPDATE devices SET name=$1,updated_at=now() WHERE id=$2 AND shop_id=$3 RETURNING id,name`,[String(body.name||'').trim()||null,body.deviceId,body.shopId]);
    if(!q.rows[0]) throw new NotFoundException('DEVICE_NOT_FOUND'); return {ok:true,device:q.rows[0]};
  }
  @Post('revoke') async revoke(@Req() req:any,@Body() body:any) {
    assertShopAccess(req.principal,body.shopId); await this.assertAdmin(req.principal.userId,body.shopId);
    const q=await this.db.query(`UPDATE devices SET revoked_at=COALESCE(revoked_at,now()),revoked_by=$1,updated_at=now() WHERE id=$2 AND shop_id=$3 RETURNING id,revoked_at`,[req.principal.userId,body.deviceId,body.shopId]);
    if(!q.rows[0]) throw new NotFoundException('DEVICE_NOT_FOUND'); return {ok:true,device:q.rows[0]};
  }
}
