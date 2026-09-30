import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
const secret = process.env.JWT_SECRET;
if (!secret && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET_REQUIRED');
@Global()
@Module({ imports: [JwtModule.register({ secret: secret || 'DEV_ONLY_CHANGE_ME' })], providers: [AuthGuard,AuthService], controllers:[AuthController], exports: [AuthGuard, AuthService, JwtModule] })
export class AuthModule {}
