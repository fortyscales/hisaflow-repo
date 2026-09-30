import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { loadConfig } from '../config/env';
export const PG = Symbol('PG');
@Injectable() class DbShutdown implements OnApplicationShutdown { constructor(@Inject(PG) private readonly db:Pool){} async onApplicationShutdown(){ await this.db.end(); } }
@Global()
@Module({providers:[{provide:PG,useFactory:()=>{const c=loadConfig(); return new Pool({connectionString:c.databaseUrl,max:Number(process.env.PG_POOL_MAX||20),idleTimeoutMillis:30000,connectionTimeoutMillis:5000,statement_timeout:Number(process.env.PG_STATEMENT_TIMEOUT_MS||15000)});}},DbShutdown],exports:[PG]})
export class DbModule {}
