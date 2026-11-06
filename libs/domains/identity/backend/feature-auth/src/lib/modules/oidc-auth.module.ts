import { OidcModule, UserEntity } from '@forepath/identity/backend';
import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersController } from '../controllers/users.controller';
import { ExternalIdentityAuthGuard } from '../guards/external-identity-auth.guard';
import { ExternalIdentityService } from '../services/external-identity.service';
import { resolveJwtModuleSecret } from '../utils/resolve-jwt-module-secret';

import { PatAuthModule, type PatAuthModuleOptions } from './pat-auth.module';

export type OidcAuthModuleOptions = PatAuthModuleOptions;

/**
 * Module for the "oidc" authentication method on apps with a local users table (controller, billing):
 * OIDC access token verification (global {@link OidcModule}), mapping of OIDC identities to local users,
 * the users admin API and the PAT / app access token stack. Use `getIdentityAuthGuards()` for the APP_GUARD
 * chain (guards are not registered as APP_GUARD here — order matters). Only load when AUTHENTICATION_METHOD=oidc.
 *
 * The JwtModule signs/verifies app-issued PAT and app access JWTs (`JWT_SECRET`); OIDC tokens never use it.
 *
 * ```ts
 * OidcAuthModule.register({ patScopeCatalog: AGENSTRA_PAT_SCOPES })
 * ```
 */
@Module({})
export class OidcAuthModule {
  static register(options: OidcAuthModuleOptions): DynamicModule {
    return {
      module: OidcAuthModule,
      imports: [
        OidcModule,
        PatAuthModule.register({ patScopeCatalog: options.patScopeCatalog }),
        TypeOrmModule.forFeature([UserEntity]),
        JwtModule.register({
          global: true,
          secret: resolveJwtModuleSecret('oidc'),
          signOptions: { expiresIn: '7d' },
        }),
      ],
      controllers: [UsersController],
      providers: [ExternalIdentityService, ExternalIdentityAuthGuard],
      exports: [PatAuthModule, ExternalIdentityService, ExternalIdentityAuthGuard],
    };
  }
}
