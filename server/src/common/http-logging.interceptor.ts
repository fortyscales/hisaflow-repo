import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  intercept(ctx:ExecutionContext,next:CallHandler):Observable<any>{ const req:any=ctx.switchToHttp().getRequest(); const res:any=ctx.switchToHttp().getResponse(); const started=Date.now();
    return next.handle().pipe(tap({next:()=>this.log(req,res,started),error:(e)=>this.log(req,res,started,e)})); }
  private log(req:any,res:any,started:number,error?:any){ console.log(JSON.stringify({level:error?'error':'info',event:'http_request',requestId:req.requestId,method:req.method,path:String(req.originalUrl||req.url||'').split('?')[0],status:error?.status||res.statusCode,durationMs:Date.now()-started,userId:req.principal?.userId||null,errorCode:error?.message||null})); }
}
