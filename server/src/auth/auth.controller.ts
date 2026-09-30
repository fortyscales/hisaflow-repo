import { Body, Controller, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  private meta(req:any){ return { userAgent:String(req.headers['user-agent']||'').slice(0,300), ip:req.ip }; }
  @Post('register') register(@Body() body:any,@Req() req:any){ return this.auth.register(body,this.meta(req)); }
  @Post('login') login(@Body() body:any,@Req() req:any){ return this.auth.login(body,this.meta(req)); }
  @Post('refresh') refresh(@Body() body:any,@Req() req:any){ return this.auth.refresh(body.refreshToken,this.meta(req)); }
  @Post('logout') logout(@Body() body:any){ return this.auth.logout(body.refreshToken); }
}
