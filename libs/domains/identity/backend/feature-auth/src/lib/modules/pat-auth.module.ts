import { RevokedUserTokenEntity, UserEntity, UserPersonalAccessTokenEntity } from '@forepath/identity/backend';
import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IDENTITY_PAT_SCOPE_CATALOG } from '../constants/pat.constants';
import { PatTokenExchangeController } from '../controllers/pat-token-exchange.controller';
import { PersonalAccessTokensController } from '../controllers/personal-access-tokens.controller';
import { PatBearerAuthGuard } from '../guards/pat-bearer-auth.guard';
import { PatScopesGuard } from '../guards/pat-scopes.guard';
import { UsersAuthGuard } from '../guards/users-auth.guard';
import { UsersRolesGuard } from '../guards/users-roles.guard';
import { PersonalAccessTokensRepository } from '../repositories/personal-access-tokens.repository';
import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';
import { AuthService } from '../services/auth.service';
import { PersonalAccessTokenService } from '../services/personal-access-token.service';
import { UsersService } from '../services/users.service';

export interface PatAuthModuleOptions {
  /** Product PAT scope allowlist (mirrors webhook eventCatalog). */
  patScopeCatalog: readonly string[];
}

/**
 * Shared PAT stack for users-mode and keycloak-mode.
 * Host must register JwtModule (UsersAuthModule or KeycloakUserSyncModule).
 * APP_GUARD registration for PatScopesGuard / UsersRolesGuard / PatBearerAuthGuard
 * is owned by the host module so guard order stays correct.
 */
@Module({})
export class PatAuthModule {
  static register(options: PatAuthModuleOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: IDENTITY_PAT_SCOPE_CATALOG, useValue: options.patScopeCatalog },
      UsersRepository,
      UsersService,
      RevokedUserTokensRepository,
      PersonalAccessTokensRepository,
      PersonalAccessTokenService,
      AuthService,
      UsersAuthGuard,
      PatBearerAuthGuard,
      UsersRolesGuard,
      PatScopesGuard,
    ];

    return {
      module: PatAuthModule,
      imports: [TypeOrmModule.forFeature([UserEntity, RevokedUserTokenEntity, UserPersonalAccessTokenEntity])],
      controllers: [PersonalAccessTokensController, PatTokenExchangeController],
      providers,
      exports: [
        UsersRepository,
        UsersService,
        RevokedUserTokensRepository,
        PersonalAccessTokensRepository,
        PersonalAccessTokenService,
        AuthService,
        UsersAuthGuard,
        PatBearerAuthGuard,
        UsersRolesGuard,
        PatScopesGuard,
        IDENTITY_PAT_SCOPE_CATALOG,
      ],
    };
  }
}
