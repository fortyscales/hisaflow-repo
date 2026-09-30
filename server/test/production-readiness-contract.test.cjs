const fs=require('fs'),path=require('path'),assert=require('assert'); const root=path.join(__dirname,'..'); const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const main=read('src/main.ts'), env=read('src/config/env.ts'), health=read('src/health/health.controller.ts'), db=read('src/db/db.module.ts'), app=read('src/app.module.ts');
assert(main.includes('enableCors')); assert(main.includes('HttpExceptionFilter')); assert(main.includes('HttpLoggingInterceptor')); assert(main.includes('enableShutdownHooks'));
assert(env.includes('CORS_ORIGINS_REQUIRED')); assert(env.includes('JWT_SECRET_WEAK')); assert(env.includes('DATABASE_URL_UNSAFE'));
assert(health.includes("@Get('live')")); assert(health.includes("@Get('ready')")); assert(health.includes('DATABASE_NOT_READY'));
assert(db.includes('OnApplicationShutdown')); assert(db.includes('this.db.end()')); assert(app.includes('AuthRateLimitMiddleware')); assert(app.includes('RequestContextMiddleware'));
console.log('PASS production readiness contract');
