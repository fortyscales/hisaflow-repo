import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req:any,res:any,next:()=>void){
    const incoming=String(req.headers['x-request-id']||'').trim();
    req.requestId=(incoming && incoming.length<=100 ? incoming : randomUUID());
    res.setHeader('X-Request-Id',req.requestId);
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    next();
  }
}
