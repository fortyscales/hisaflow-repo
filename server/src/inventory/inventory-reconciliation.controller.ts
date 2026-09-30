import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { assertShopAccess } from '../common/tenant';
import { InventoryReconciliationService } from './inventory-reconciliation.service';

@Controller('inventory/reconciliation') @UseGuards(AuthGuard)
export class InventoryReconciliationController {
  constructor(private readonly inventory:InventoryReconciliationService) {}
  @Get('issues') async list(@Req() req:any,@Query('shopId') shopId:string,@Query('includeResolved') includeResolved='false') {
    assertShopAccess(req.principal,shopId); return this.inventory.list(shopId,includeResolved==='true');
  }
  @Get('details') async details(@Req() req:any,@Query('shopId') shopId:string,@Query('issueId') issueId:string) {
    assertShopAccess(req.principal,shopId); return this.inventory.details(shopId,issueId);
  }

  @Post('resolve') async resolve(@Req() req:any,@Body() body:{shopId:string,issueId:string,deviceId:string,physicalQuantity:number,note?:string}) {
    assertShopAccess(req.principal,body.shopId); return this.inventory.resolveByPhysicalCount(body.shopId,body.issueId,body.deviceId,body.physicalQuantity,body.note);
  }
  @Post('acknowledge') async acknowledge(@Req() req:any,@Body() body:{shopId:string,issueId:string,note?:string}) {
    assertShopAccess(req.principal,body.shopId); return this.inventory.acknowledge(body.shopId,body.issueId,body.note);
  }
}
