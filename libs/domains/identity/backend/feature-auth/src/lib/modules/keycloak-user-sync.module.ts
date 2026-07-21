import { UserEntity } from '@forepath/identity/backend';
import { Module } from '@nestjs/common';
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
 * Syncs Keycloak-authenticated users to the users table and provides UsersController.
 * Only load when AUTHENTICATION_METHOD=keycloak.
 *
 * Do NOT register KeycloakAuthGuard / KeycloakRolesGuard as APP_GUARD here —
 * host apps must use `getKeycloakPatAuthGuards()` so PatBearer runs first.
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
  providers: [UsersRepository, UsersService, UsersAuthGuard, KeycloakAuthGuard, KeycloakRolesGuard],
  exports: [UsersRepository, UsersService, KeycloakAuthGuard, KeycloakRolesGuard],
})
export class KeycloakUserSyncModule {}
