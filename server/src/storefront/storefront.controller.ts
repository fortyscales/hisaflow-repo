import { BadRequestException, NotFoundException, Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { StorefrontService } from './storefront.service';
import { renderStorefront, renderStorefrontUnavailable } from './storefront.page';
@Controller('storefront/manage') @UseGuards(AuthGuard)
export class StorefrontAdminController {
 constructor(private readonly service:StorefrontService){}
 @Get(':shopId') get(@Req() req:any,@Param('shopId') id:string){return this.service.get(req.principal.userId,id);}
 @Get(':shopId/catalog') catalog(@Req() req:any,@Param('shopId') id:string){return this.service.catalog(req.principal.userId,id);}
 @Post(':shopId/draft') save(@Req() req:any,@Param('shopId') id:string,@Body() body:any){return this.service.save(req.principal.userId,id,body);}
 @Post(':shopId/preview') async preview(@Req() req:any,@Param('shopId') id:string,@Body() body:any){return {html:renderStorefront(await this.service.preview(req.principal.userId,id,body),true).html};}
 @Post(':shopId/publish') publish(@Req() req:any,@Param('shopId') id:string,@Body() body:any){return this.service.publish(req.principal.userId,id,body);}
 @Post(':shopId/unpublish') unpublish(@Req() req:any,@Param('shopId') id:string,@Body() body:any){return this.service.unpublish(req.principal.userId,id,body);}
}
@Controller('storefront/public')
export class StorefrontPublicController {
 constructor(private readonly service:StorefrontService){}
 @Get(':shopId') async page(@Param('shopId') id:string,@Res() res:Response){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');
  let page;
  try { page=renderStorefront(await this.service.publicShop(id)); }
  catch(error) {
   // Unknown, unpublished and malformed shop links expose the same public page.
   // Unexpected failures still reach the central logger/error handler.
   if (!(error instanceof NotFoundException) && !(error instanceof BadRequestException)) throw error;
   page=renderStorefrontUnavailable();res.status(404);
  }
  res.setHeader('Content-Security-Policy',page.csp+"; frame-ancestors 'none'");res.type('html').send(page.html);
 }
}
