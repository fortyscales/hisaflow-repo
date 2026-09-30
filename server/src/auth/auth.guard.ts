import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const raw = String(req.headers.authorization || '');
    if (!raw.startsWith('Bearer ')) throw new UnauthorizedException('AUTH_REQUIRED');
    try {
      const payload = await this.jwt.verifyAsync(raw.slice(7));
      if (payload.type !== 'access' || !payload.sub) throw new Error('NOT_ACCESS_TOKEN');
      req.principal = { userId: payload.sub, shopIds: Array.isArray(payload.shopIds) ? payload.shopIds : [] };
      return true;
    } catch { throw new UnauthorizedException('INVALID_TOKEN'); }
  }
}
