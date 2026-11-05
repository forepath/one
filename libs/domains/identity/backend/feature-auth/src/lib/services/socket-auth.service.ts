import { getAuthenticationMethod, patScopeSatisfied, UserRole, websocketScope } from '@forepath/identity/backend';
import type { SocketUserInfo } from '@forepath/identity/backend';
import { DEFAULT_TENANT, getTenantIdOrDefault } from '@forepath/shared/backend';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { KEYCLOAK_CONNECT_OPTIONS, KEYCLOAK_INSTANCE, TokenValidation } from 'nest-keycloak-connect';

import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';
import {
  isMachineJwtAmr,
  type MachineJwtVerifiers,
  normalizeMachineJwtAmr,
  resolveMachineJwtSession,
} from '../utils/machine-jwt-session.util';
import { assertUsersJwtSessionValid, UsersJwtSessionPayload } from '../utils/users-jwt-session.util';

import { IdentityAppAuthorizationService } from './identity-app-authorization.service';
import { PersonalAccessTokenService } from './personal-access-token.service';

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

export interface SocketAuthOptions {
  /**
   * Socket name (e.g. `clients`). Opens the socket to machine tokens (PAT / app access tokens) that hold
   * `websocket:<name>:read`. Without it machine tokens are rejected (fail-closed).
   */
  websocket?: string;
}

/** Optional injection token for explicit machine JWT verifiers (defaults to the app's PatAuthModule services). */
export const SOCKET_MACHINE_JWT_VERIFIERS = 'IDENTITY_SOCKET_MACHINE_JWT_VERIFIERS';

@Injectable()
export class SocketAuthService {
  private readonly logger = new Logger(SocketAuthService.name);

  constructor(
    @Optional() @Inject(KEYCLOAK_INSTANCE) private readonly keycloak: KeycloakInstance | null,
    @Optional() @Inject(KEYCLOAK_CONNECT_OPTIONS) private readonly keycloakOpts: KeycloakConnectConfig | null,
    @Optional() private readonly jwtService: JwtService | null,
    private readonly usersRepository: UsersRepository,
    @Optional() private readonly revokedUserTokensRepository: RevokedUserTokensRepository | null,
    @Optional() private readonly moduleRef?: ModuleRef | null,
    /** Explicit machine JWT verifiers (tests); otherwise resolved from the app's PatAuthModule. */
    @Optional() @Inject(SOCKET_MACHINE_JWT_VERIFIERS) private readonly machineVerifiers?: MachineJwtVerifiers | null,
  ) {}

  /**
   * Validate Authorization header and return user info for client access checks.
   * Uses same auth logic as HTTP: api-key, keycloak, or users (JWT).
   * Machine tokens (PAT / app access tokens) are only accepted with `options.websocket` and the matching
   * `websocket:<name>:read` scope; they carry live `scopes` that gateways enforce per event.
   */
  async validateAndGetUser(
    authHeader: string | undefined,
    tenantId?: string,
    options?: SocketAuthOptions,
  ): Promise<SocketUserInfo | null> {
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
      return this.validateKeycloakToken(token, tenantId, options);
    }

    if (authMethod === 'users' && this.jwtService) {
      return await this.validateUsersToken(token, tenantId, options);
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

  private async validateKeycloakToken(
    token: string,
    tenantId?: string,
    options?: SocketAuthOptions,
  ): Promise<SocketUserInfo | null> {
    // App-signed machine JWTs (PAT / app access tokens) never reach Keycloak OIDC validation (same as PatBearerAuthGuard).
    if (this.jwtService) {
      let appPayload: UsersJwtSessionPayload | undefined;

      try {
        appPayload = await this.jwtService.verifyAsync<UsersJwtSessionPayload>(token);
      } catch {
        // Not an app-signed JWT — continue with Keycloak OIDC validation.
      }

      if (appPayload && isMachineJwtAmr(appPayload.amr)) {
        return this.validateMachineToken(appPayload, tenantId, options);
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

  private async validateUsersToken(
    token: string,
    tenantId?: string,
    options?: SocketAuthOptions,
  ): Promise<SocketUserInfo | null> {
    try {
      const payload = await this.jwtService!.verifyAsync<UsersJwtSessionPayload>(token);

      // Machine sessions (PAT / app access tokens) take the scope-checked path.
      if (isMachineJwtAmr(payload.amr ?? ['pwd'])) {
        return await this.validateMachineToken(payload, tenantId, options);
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

  /**
   * Machine JWT (signature already verified): same checks as the HTTP guards (user, lock, tenant, token version,
   * revocation, live PAT / app session) plus the socket's `websocket:<name>:read` scope.
   */
  private async validateMachineToken(
    payload: UsersJwtSessionPayload,
    tenantId: string | undefined,
    options: SocketAuthOptions | undefined,
  ): Promise<SocketUserInfo | null> {
    const verifiers = this.resolveMachineVerifiers();

    if (!options?.websocket || !verifiers || !this.revokedUserTokensRepository) {
      return null;
    }

    try {
      const user = await this.usersRepository.findById(payload.sub);

      if (!user || user.lockedAt) {
        return null;
      }

      // Same tenant rule as UsersAuthGuard / PatBearerAuthGuard (no request tenant → default tenant).
      const expectedTenantId = tenantId ?? getTenantIdOrDefault();

      if ((user.tenantId?.trim() || DEFAULT_TENANT) !== expectedTenantId) {
        return null;
      }

      await assertUsersJwtSessionValid(payload, user, this.revokedUserTokensRepository);

      const session = await resolveMachineJwtSession(payload, verifiers);

      if (!patScopeSatisfied(session.scopes, websocketScope(options.websocket, 'read'))) {
        return null;
      }

      const amr = normalizeMachineJwtAmr(payload.amr);
      // Live DB role (as on HTTP); client access helpers never grant admin bypass to `amr: pat`.
      const roles = [user.role];

      return {
        userId: user.id,
        userRole: user.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.USER,
        isApiKeyAuth: false,
        amr,
        scopes: session.scopes,
        exp: typeof payload.exp === 'number' ? payload.exp : undefined,
        user: {
          id: user.id,
          email: user.email,
          roles,
          amr,
          scopes: session.scopes,
        },
      };
    } catch {
      return null;
    }
  }

  private resolveMachineVerifiers(): MachineJwtVerifiers | null {
    if (this.machineVerifiers) {
      return this.machineVerifiers;
    }

    if (!this.moduleRef) {
      return null;
    }

    try {
      // PatAuthModule is registered by the host app (users / keycloak mode); absent in api-key mode → fail-closed.
      const personalAccessTokenService = this.moduleRef.get(PersonalAccessTokenService, { strict: false });
      const appAuthorizationService = this.moduleRef.get(IdentityAppAuthorizationService, { strict: false });

      return personalAccessTokenService && appAuthorizationService
        ? { personalAccessTokenService, appAuthorizationService }
        : null;
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
