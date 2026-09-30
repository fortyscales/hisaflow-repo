import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard'; import { assertShopAccess } from '../common/tenant'; import { SyncService } from './sync.service'; import { PushBody } from './sync.dto';
@Controller('sync') @UseGuards(AuthGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}
  @Post('push') async push(@Req() req:any,@Body() body:PushBody) { assertShopAccess(req.principal,body.shopId); return this.sync.push(body.shopId,body.deviceId,body.events); }
  @Get('history') async history(@Req() req:any,@Query('shopId') shopId:string,@Query('limit') limit='100') { assertShopAccess(req.principal,shopId); return this.sync.history(shopId,Number(limit)); }
  @Get('pull') async pull(@Req() req:any,@Query('shopId') shopId:string,@Query('deviceId') deviceId:string,@Query('after') after='0',@Query('limit') limit='200') { assertShopAccess(req.principal,shopId); return this.sync.pull(shopId,deviceId,Number(after),Number(limit)); }
}
