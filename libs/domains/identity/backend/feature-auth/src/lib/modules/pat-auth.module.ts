import {
  IdentityAppAuthorizationCodeEntity,
  IdentityAppEntity,
  IdentityAppGrantEntity,
  IdentityAppSessionEntity,
  RevokedUserTokenEntity,
  UserEntity,
  UserPersonalAccessTokenEntity,
} from '@forepath/identity/backend';
import {
  DynamicModule,
  Inject,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  Optional,
  type Provider,
  RequestMethod,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IDENTITY_PAT_SCOPE_CATALOG, IDENTITY_RAW_PAT_BEARER_PATHS } from '../constants/pat.constants';
import { IdentityAppAuthorizationController } from '../controllers/identity-app-authorization.controller';
import { IdentityAppTokenController } from '../controllers/identity-app-token.controller';
import { IdentityAppsController } from '../controllers/identity-apps.controller';
import { PatTokenExchangeController } from '../controllers/pat-token-exchange.controller';
import { PersonalAccessTokensController } from '../controllers/personal-access-tokens.controller';
import { PatBearerAuthGuard } from '../guards/pat-bearer-auth.guard';
import { PatScopesGuard } from '../guards/pat-scopes.guard';
import { UsersAuthGuard } from '../guards/users-auth.guard';
import { UsersRolesGuard } from '../guards/users-roles.guard';
import { PatBearerExchangeMiddleware } from '../middleware/pat-bearer-exchange.middleware';
import { IdentityAppsRepository } from '../repositories/identity-apps.repository';
import { PersonalAccessTokensRepository } from '../repositories/personal-access-tokens.repository';
import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';
import { AuthService } from '../services/auth.service';
import { IdentityAppAuthorizationService } from '../services/identity-app-authorization.service';
import { IdentityAppsService } from '../services/identity-apps.service';
import { PersonalAccessTokenService } from '../services/personal-access-token.service';
import { UsersService } from '../services/users.service';

export interface PatAuthModuleOptions {
  /** Product PAT scope allowlist (mirrors webhook eventCatalog). */
  patScopeCatalog: readonly string[];
  /**
   * Request paths (with global prefix, without query) on which a raw `fp_pat_…` bearer is accepted and exchanged
   * in-process for the regular PAT JWT before the guards run (see {@link PatBearerExchangeMiddleware}).
   * Omit to keep raw PATs rejected everywhere (default). Use anchored patterns.
   */
  rawPatBearerPaths?: readonly RegExp[];
}

/**
 * Shared PAT stack for users-, oidc- and saml-mode.
 * Host must register JwtModule (UsersAuthModule, OidcAuthModule or SamlAuthModule).
 * APP_GUARD registration for PatScopesGuard / UsersRolesGuard / PatBearerAuthGuard
 * is owned by the host module so guard order stays correct.
 */
@Module({})
export class PatAuthModule implements NestModule {
  constructor(
    @Optional() @Inject(IDENTITY_RAW_PAT_BEARER_PATHS) private readonly rawPatBearerPaths: readonly RegExp[] = [],
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    if (this.rawPatBearerPaths.length === 0) {
      return;
    }

    // The middleware itself matches the configured paths; registering it for every route keeps that independent of
    // the router's path syntax and the global prefix.
    consumer.apply(PatBearerExchangeMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }

  static register(options: PatAuthModuleOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: IDENTITY_PAT_SCOPE_CATALOG, useValue: options.patScopeCatalog },
      { provide: IDENTITY_RAW_PAT_BEARER_PATHS, useValue: [...(options.rawPatBearerPaths ?? [])] },
      PatBearerExchangeMiddleware,
      UsersRepository,
      UsersService,
      RevokedUserTokensRepository,
      PersonalAccessTokensRepository,
      PersonalAccessTokenService,
      AuthService,
      IdentityAppsRepository,
      IdentityAppsService,
      IdentityAppAuthorizationService,
      UsersAuthGuard,
      PatBearerAuthGuard,
      UsersRolesGuard,
      PatScopesGuard,
    ];

    return {
      module: PatAuthModule,
      imports: [
        TypeOrmModule.forFeature([
          UserEntity,
          RevokedUserTokenEntity,
          UserPersonalAccessTokenEntity,
          IdentityAppEntity,
          IdentityAppGrantEntity,
          IdentityAppSessionEntity,
          IdentityAppAuthorizationCodeEntity,
        ]),
      ],
      controllers: [
        PersonalAccessTokensController,
        PatTokenExchangeController,
        IdentityAppsController,
        IdentityAppAuthorizationController,
        IdentityAppTokenController,
      ],
      providers,
      exports: [
        UsersRepository,
        UsersService,
        RevokedUserTokensRepository,
        PersonalAccessTokensRepository,
        PersonalAccessTokenService,
        AuthService,
        IdentityAppsRepository,
        IdentityAppsService,
        IdentityAppAuthorizationService,
        UsersAuthGuard,
        PatBearerAuthGuard,
        UsersRolesGuard,
        PatScopesGuard,
        IDENTITY_PAT_SCOPE_CATALOG,
      ],
    };
  }
}
