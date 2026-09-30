import { StorefrontModule } from './storefront/storefront.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DbModule } from './db/db.module'; import { AuthModule } from './auth/auth.module'; import { ShopsModule } from './shops/shops.module'; import { DevicesModule } from './devices/devices.module'; import { SyncModule } from './sync/sync.module'; import { HealthModule } from './health/health.module'; import { InventoryModule } from './inventory/inventory.module'; import { RequestContextMiddleware } from './common/request-context.middleware'; import { AuthRateLimitMiddleware } from './common/auth-rate-limit.middleware';
@Module({imports:[DbModule,AuthModule,StorefrontModule,ShopsModule,DevicesModule,SyncModule,HealthModule,InventoryModule]})
export class AppModule implements NestModule { configure(c:MiddlewareConsumer){c.apply(RequestContextMiddleware,AuthRateLimitMiddleware).forRoutes('*');} }
