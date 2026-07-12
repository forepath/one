import { RevokedUserTokenEntity, UserEntity } from '@forepath/identity/backend';
import { EmailService } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthController } from '../controllers/auth.controller';
import { UsersController } from '../controllers/users.controller';
import { KeycloakRolesGuard } from '../guards/keycloak-roles.guard';
import { UsersAuthGuard } from '../guards/users-auth.guard';
import { UsersRolesGuard } from '../guards/users-roles.guard';
import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';
import { AuthService } from '../services/auth.service';
import { UsersService } from '../services/users.service';
import { resolveJwtModuleSecret } from '../utils/resolve-jwt-module-secret';

/**
 * Module for "users" authentication method.
 * Provides JWT-based auth with user registration, email confirmation, password reset.
 * Only load this module when AUTHENTICATION_METHOD=users.
 *
 * To enable statistics tracking, the consuming module should provide:
 * ```ts
 * { provide: IDENTITY_STATISTICS_SERVICE, useExisting: YourStatisticsService }
 * ```
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, RevokedUserTokenEntity]),
    JwtModule.register({
      global: true,
      secret: resolveJwtModuleSecret('users'),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    UsersRepository,
    RevokedUserTokensRepository,
    UsersService,
    EmailService,
    AuthService,
    UsersAuthGuard,
    KeycloakRolesGuard,
    UsersRolesGuard,
    { provide: APP_GUARD, useClass: UsersAuthGuard },
    { provide: APP_GUARD, useClass: UsersRolesGuard },
  ],
  exports: [UsersService, UsersRepository, RevokedUserTokensRepository, AuthService],
})
export class UsersAuthModule {}
