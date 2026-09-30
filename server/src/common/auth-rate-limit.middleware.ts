import { HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
const buckets=new Map<string,{window:number,count:number}>();
@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  use(req:any,_res:any,next:()=>void){
    if(!String(req.originalUrl||req.url||'').includes('/auth/')) return next();
    const limit=Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE||30); const now=Date.now(); const window=Math.floor(now/60000);
    const key=`${req.ip||req.socket?.remoteAddress||'unknown'}:${window}`; const cur=buckets.get(key)||{window,count:0}; cur.count++; buckets.set(key,cur);
    if(cur.count>limit) throw new HttpException('AUTH_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
    if(buckets.size>5000) for(const [k,v] of buckets) if(v.window<window-1) buckets.delete(k);
    next();
  }
}
