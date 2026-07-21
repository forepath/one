import { RevokedUserTokenEntity, UserEntity, UserPersonalAccessTokenEntity } from '@forepath/identity/backend';
import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthController } from '../controllers/auth.controller';
import { UsersController } from '../controllers/users.controller';
import { KeycloakRolesGuard } from '../guards/keycloak-roles.guard';
import { PatScopesGuard } from '../guards/pat-scopes.guard';
import { UsersAuthGuard } from '../guards/users-auth.guard';
import { UsersRolesGuard } from '../guards/users-roles.guard';
import { resolveJwtModuleSecret } from '../utils/resolve-jwt-module-secret';

import { PatAuthModule, type PatAuthModuleOptions } from './pat-auth.module';

export type UsersAuthModuleOptions = PatAuthModuleOptions;

/**
 * Module for "users" authentication method.
 * Provides JWT-based auth with user registration, email confirmation, password reset, and PATs.
 * Only load this module when AUTHENTICATION_METHOD=users.
 *
 * ```ts
 * UsersAuthModule.register({ patScopeCatalog: AGENSTRA_PAT_SCOPES })
 * ```
 */
@Module({})
export class UsersAuthModule {
  static register(options: UsersAuthModuleOptions): DynamicModule {
    const providers: Provider[] = [
      UsersAuthGuard,
      KeycloakRolesGuard,
      UsersRolesGuard,
      PatScopesGuard,
      { provide: APP_GUARD, useClass: UsersAuthGuard },
      { provide: APP_GUARD, useClass: UsersRolesGuard },
      { provide: APP_GUARD, useClass: PatScopesGuard },
    ];

    return {
      module: UsersAuthModule,
      imports: [
        PatAuthModule.register({ patScopeCatalog: options.patScopeCatalog }),
        TypeOrmModule.forFeature([UserEntity, RevokedUserTokenEntity, UserPersonalAccessTokenEntity]),
        JwtModule.register({
          global: true,
          secret: resolveJwtModuleSecret('users'),
          signOptions: { expiresIn: '7d' },
        }),
      ],
      controllers: [AuthController, UsersController],
      providers,
      exports: [PatAuthModule],
    };
  }
}
