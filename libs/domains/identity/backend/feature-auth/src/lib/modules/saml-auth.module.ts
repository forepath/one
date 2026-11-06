import {
  ExternalAuthStateEntity,
  RevokedUserTokenEntity,
  UserEntity,
  UserPersonalAccessTokenEntity,
} from '@forepath/identity/backend';
import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SamlAuthController } from '../controllers/saml-auth.controller';
import { UsersController } from '../controllers/users.controller';
import { PatScopesGuard } from '../guards/pat-scopes.guard';
import { UsersAuthGuard } from '../guards/users-auth.guard';
import { UsersRolesGuard } from '../guards/users-roles.guard';
import { ExternalAuthStatesRepository } from '../repositories/external-auth-states.repository';
import { SamlAuthService } from '../saml/saml-auth.service';
import { readSamlServiceProviderConfig } from '../saml/saml.config';
import { ExternalIdentityService } from '../services/external-identity.service';
import { resolveJwtModuleSecret } from '../utils/resolve-jwt-module-secret';

import { PatAuthModule, type PatAuthModuleOptions } from './pat-auth.module';

export type SamlAuthModuleOptions = PatAuthModuleOptions;

/**
 * Module for the "saml" authentication method: the API acts as SAML 2.0 service provider and issues
 * app session JWTs (same validation chain as users mode: UsersAuthGuard → UsersRolesGuard → PatScopesGuard).
 * PATs and app access tokens work exactly like in users mode. Only load when AUTHENTICATION_METHOD=saml.
 *
 * ```ts
 * SamlAuthModule.register({ patScopeCatalog: AGENSTRA_PAT_SCOPES })
 * ```
 */
@Module({})
export class SamlAuthModule {
  static register(options: SamlAuthModuleOptions): DynamicModule {
    // Fail at boot on incomplete / unsafe SAML configuration instead of on the first sign-in.
    readSamlServiceProviderConfig();

    const providers: Provider[] = [
      ExternalIdentityService,
      ExternalAuthStatesRepository,
      SamlAuthService,
      UsersAuthGuard,
      UsersRolesGuard,
      PatScopesGuard,
      { provide: APP_GUARD, useClass: UsersAuthGuard },
      { provide: APP_GUARD, useClass: UsersRolesGuard },
      { provide: APP_GUARD, useClass: PatScopesGuard },
    ];

    return {
      module: SamlAuthModule,
      imports: [
        PatAuthModule.register({ patScopeCatalog: options.patScopeCatalog }),
        TypeOrmModule.forFeature([
          UserEntity,
          RevokedUserTokenEntity,
          UserPersonalAccessTokenEntity,
          ExternalAuthStateEntity,
        ]),
        JwtModule.register({
          global: true,
          secret: resolveJwtModuleSecret('saml'),
          signOptions: { expiresIn: '7d' },
        }),
      ],
      controllers: [SamlAuthController, UsersController],
      providers,
      exports: [PatAuthModule, ExternalIdentityService],
    };
  }
}
