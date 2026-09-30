import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception:any,host:ArgumentsHost){ const ctx=host.switchToHttp(); const res:any=ctx.getResponse(); const req:any=ctx.getRequest(); const status=exception instanceof HttpException?exception.getStatus():HttpStatus.INTERNAL_SERVER_ERROR; const raw=exception instanceof HttpException?exception.getResponse():null; const message=typeof raw==='string'?raw:(raw as any)?.message; const code=Array.isArray(message)?'VALIDATION_ERROR':String(message||exception?.message||'INTERNAL_ERROR');
    if(status>=500) console.error(JSON.stringify({level:'error',event:'unhandled_error',requestId:req.requestId,status,code,stack:process.env.NODE_ENV==='production'?undefined:exception?.stack}));
    res.status(status).json({ok:false,error:{code:status>=500?'INTERNAL_ERROR':code,retryable:status===429||status>=500},requestId:req.requestId}); }
}
