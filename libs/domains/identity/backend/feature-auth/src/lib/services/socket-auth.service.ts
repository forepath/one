import { getAuthenticationMethod, UserRole } from '@forepath/identity/backend';
import type { SocketUserInfo } from '@forepath/identity/backend';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { KEYCLOAK_CONNECT_OPTIONS, KEYCLOAK_INSTANCE, TokenValidation } from 'nest-keycloak-connect';

import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';
import { assertUsersJwtSessionValid, UsersJwtSessionPayload } from '../utils/users-jwt-session.util';

/** Minimal Keycloak interface for token validation */
interface KeycloakInstance {
  grantManager: {
    createGrant: (p: { access_token: string }) => Promise<{ access_token: unknown }>;
    validateAccessToken: (t: unknown) => Promise<unknown>;
    validateToken: (t: unknown, type: string) => Promise<unknown>;
  };
}

interface KeycloakConnectConfig {
  tokenValidation?: TokenValidation;
}

@Injectable()
export class SocketAuthService {
  private readonly logger = new Logger(SocketAuthService.name);

  constructor(
    @Optional() @Inject(KEYCLOAK_INSTANCE) private readonly keycloak: KeycloakInstance | null,
    @Optional() @Inject(KEYCLOAK_CONNECT_OPTIONS) private readonly keycloakOpts: KeycloakConnectConfig | null,
    @Optional() private readonly jwtService: JwtService | null,
    private readonly usersRepository: UsersRepository,
    @Optional() private readonly revokedUserTokensRepository: RevokedUserTokensRepository | null,
  ) {}

  /**
   * Validate Authorization header and return user info for client access checks.
   * Uses same auth logic as HTTP: api-key, keycloak, or users (JWT).
   */
  async validateAndGetUser(authHeader: string | undefined, tenantId?: string): Promise<SocketUserInfo | null> {
    if (!authHeader) {
      return null;
    }

    const authMethod = getAuthenticationMethod();

    if (authMethod === 'api-key') {
      return this.validateApiKey(authHeader);
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return null;
    }

    if (authMethod === 'keycloak' && this.keycloak) {
      return this.validateKeycloakToken(token, tenantId);
    }

    if (authMethod === 'users' && this.jwtService) {
      return await this.validateUsersToken(token, tenantId);
    }

    return null;
  }

  private validateApiKey(authHeader: string): SocketUserInfo | null {
    const staticApiKey = process.env.STATIC_API_KEY;

    if (!staticApiKey) {
      return null;
    }

    const parts = authHeader.split(' ');

    if (parts.length !== 2) {
      return null;
    }

    const [scheme, providedKey] = parts;

    if ((scheme === 'Bearer' || scheme === 'ApiKey') && providedKey === staticApiKey) {
      return {
        isApiKeyAuth: true,
        user: { id: 'api-key-user', roles: ['admin', 'user'] },
      };
    }

    return null;
  }

  private async validateKeycloakToken(token: string, tenantId?: string): Promise<SocketUserInfo | null> {
    // Reject app-signed PAT JWTs explicitly (same policy as users-mode sockets).
    if (this.jwtService) {
      try {
        const appPayload = await this.jwtService.verifyAsync<UsersJwtSessionPayload>(token);

        if ((appPayload.amr ?? []).includes('pat')) {
          return null;
        }
      } catch {
        // Not an app-signed JWT — continue with Keycloak OIDC validation.
      }
    }

    // Use exact same validation logic as HTTP AuthGuard from nest-keycloak-connect
    const tokenValidation = this.keycloakOpts?.tokenValidation || TokenValidation.ONLINE;
    const gm = this.keycloak!.grantManager;
    let grant: { access_token: unknown };

    try {
      // Step 1: Create grant (validates token structure)
      grant = await gm.createGrant({ access_token: token });
    } catch (ex) {
      // It will fail to create grants on invalid access token (i.e expired or wrong domain)
      return null;
    }

    const accessToken = grant.access_token;

    this.logger.debug(`Using token validation method: ${tokenValidation.toUpperCase()}`);

    try {
      // Step 2: Validate token based on tokenValidation setting (same as HTTP AuthGuard)
      let result: boolean | unknown;

      switch (tokenValidation) {
        case TokenValidation.ONLINE:
          result = await gm.validateAccessToken(accessToken);

          // validateAccessToken returns the token if valid, or false if invalid
          if (result !== accessToken) {
            return null;
          }

          break;
        case TokenValidation.OFFLINE:
          result = await gm.validateToken(accessToken, 'Bearer');

          // validateToken returns the token if valid
          if (result !== accessToken) {
            return null;
          }

          break;
        case TokenValidation.NONE:
          // No validation, just trust the token
          break;
        default:
          return null;
      }

      // Token is valid, parse payload
      const payload = this.parseJwtPayload(token);

      if (!payload.sub) {
        return null;
      }

      const roles = payload.realm_access?.roles ?? [];
      const isAdmin = roles.includes('admin') || roles.includes('realm-admin');
      // Resolve Keycloak sub to our users table id for client_users lookups
      let userId = payload.sub;
      const syncedUser = await this.usersRepository.findByKeycloakSub(payload.sub);

      if (syncedUser) {
        if (syncedUser.lockedAt) {
          return null;
        }

        if (!this.userMatchesTenant(syncedUser, tenantId)) {
          return null;
        }

        userId = syncedUser.id;
      }

      return {
        userId,
        userRole: isAdmin ? UserRole.ADMIN : UserRole.USER,
        isApiKeyAuth: false,
        user: {
          id: userId,
          roles: roles,
        },
      };
    } catch {
      return null;
    }
  }

  private async validateUsersToken(token: string, tenantId?: string): Promise<SocketUserInfo | null> {
    try {
      const payload = await this.jwtService!.verifyAsync<UsersJwtSessionPayload>(token);

      // Interactive console sockets reject machine (PAT) sessions.
      if ((payload.amr ?? ['pwd']).includes('pat')) {
        return null;
      }

      const entity = await this.usersRepository.findById(payload.sub);

      if (!entity || entity.lockedAt || !this.userMatchesTenant(entity, tenantId)) {
        return null;
      }

      if (this.revokedUserTokensRepository) {
        try {
          await assertUsersJwtSessionValid(payload, entity, this.revokedUserTokensRepository);
        } catch {
          return null;
        }
      } else if ((payload.tv ?? 0) !== (entity.tokenVersion ?? 0)) {
        return null;
      }

      const roles = payload.roles ?? ['user'];
      const isAdmin = roles.includes('admin');
      const amr = payload.amr ?? ['pwd'];

      return {
        userId: payload.sub,
        userRole: isAdmin ? UserRole.ADMIN : UserRole.USER,
        isApiKeyAuth: false,
        amr,
        user: {
          id: payload.sub,
          email: payload.email,
          roles,
          amr,
        },
      };
    } catch {
      return null;
    }
  }

  private userMatchesTenant(user: { tenantId: string }, tenantId?: string): boolean {
    if (!tenantId) {
      return true;
    }

    return user.tenantId === tenantId;
  }

  private parseJwtPayload(token: string): { sub: string; realm_access?: { roles?: string[] } } {
    const parts = token.split('.');

    if (parts.length < 2) {
      return { sub: '' };
    }

    return JSON.parse(Buffer.from(parts[1], 'base64').toString());
  }
}
