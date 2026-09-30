import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg'; import { PG } from '../db/db.module';
@Controller('health')
export class HealthController { constructor(@Inject(PG) private readonly db:Pool){}
 @Get('live') live(){return {ok:true,service:'hisaflow-cloud'};}
 @Get() async health(){return this.ready();}
 @Get('ready') async ready(){try{const r=await this.db.query('SELECT now() AS database_time');return {ok:true,service:'hisaflow-cloud',database: 'ok',databaseTime:r.rows[0].database_time};}catch{throw new ServiceUnavailableException('DATABASE_NOT_READY');}}
}
