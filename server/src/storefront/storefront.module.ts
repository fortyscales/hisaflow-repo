import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorefrontService } from './storefront.service';
import { StorefrontAdminController,StorefrontPublicController } from './storefront.controller';
@Module({imports:[AuthModule],controllers:[StorefrontAdminController,StorefrontPublicController],providers:[StorefrontService]})
export class StorefrontModule {}
