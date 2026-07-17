import { UserEntity } from '@forepath/identity/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersController } from '../controllers/users.controller';
import { KeycloakAuthGuard } from '../guards/keycloak-auth.guard';
import { KeycloakRolesGuard } from '../guards/keycloak-roles.guard';
import { UsersAuthGuard } from '../guards/users-auth.guard';
import { UsersRepository } from '../repositories/users.repository';
import { UsersService } from '../services/users.service';
import { resolveJwtModuleSecret } from '../utils/resolve-jwt-module-secret';

/**
 * Module that syncs Keycloak-authenticated users to the users table.
 * Provides UsersController for user management when Keycloak is active.
 * Only load when AUTHENTICATION_METHOD=keycloak.
 *
 * Transactional email (if any) is enqueued via IDENTITY_EMAIL_DISPATCHER from the host app.
 *
 * To enable statistics tracking, the consuming module should provide:
 * ```ts
 * { provide: IDENTITY_STATISTICS_SERVICE, useExisting: YourStatisticsService }
 * ```
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    JwtModule.register({
      global: true,
      secret: resolveJwtModuleSecret('keycloak'),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [UsersController],
  providers: [
    UsersRepository,
    UsersService,
    UsersAuthGuard,
    KeycloakRolesGuard,
    { provide: APP_GUARD, useClass: KeycloakAuthGuard },
    { provide: APP_GUARD, useClass: KeycloakRolesGuard },
  ],
  exports: [UsersRepository],
})
export class KeycloakUserSyncModule {}
