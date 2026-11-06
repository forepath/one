import {
  getAuthenticationMethod,
  OidcTokenVerifier,
  patScopeSatisfied,
  secretsEqual,
  UserRole,
  websocketScope,
} from '@forepath/identity/backend';
import type { SocketUserInfo } from '@forepath/identity/backend';
import { DEFAULT_TENANT, getTenantIdOrDefault, runWithTenantId } from '@forepath/shared/backend';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';
import {
  isMachineJwtAmr,
  type MachineJwtVerifiers,
  normalizeMachineJwtAmr,
  resolveMachineJwtSession,
} from '../utils/machine-jwt-session.util';
import {
  assertUsersJwtSessionValid,
  isInteractiveAmrAllowedForMethod,
  UsersJwtSessionPayload,
} from '../utils/users-jwt-session.util';

import { ExternalIdentityService, parseEmailVerifiedClaim } from './external-identity.service';
import { IdentityAppAuthorizationService } from './identity-app-authorization.service';
import { PersonalAccessTokenService } from './personal-access-token.service';

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
  private readonly externalIdentityService: ExternalIdentityService;

  constructor(
    @Optional() private readonly oidcVerifier: OidcTokenVerifier | null,
    @Optional() private readonly jwtService: JwtService | null,
    private readonly usersRepository: UsersRepository,
    @Optional() private readonly revokedUserTokensRepository: RevokedUserTokensRepository | null,
    @Optional() private readonly moduleRef?: ModuleRef | null,
    /** Explicit machine JWT verifiers (tests); otherwise resolved from the app's PatAuthModule. */
    @Optional() @Inject(SOCKET_MACHINE_JWT_VERIFIERS) private readonly machineVerifiers?: MachineJwtVerifiers | null,
    @Optional() externalIdentityService?: ExternalIdentityService | null,
  ) {
    // Same OIDC identity → local user mapping as the HTTP ExternalIdentityAuthGuard.
    this.externalIdentityService = externalIdentityService ?? new ExternalIdentityService(usersRepository);
  }

  /**
   * Validate Authorization header and return user info for client access checks.
   * Uses same auth logic as HTTP: api-key, oidc (IdP access token), or users / saml (app session JWT).
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

    if (authMethod === 'oidc' && this.oidcVerifier) {
      return this.validateOidcToken(token, tenantId, options);
    }

    if ((authMethod === 'users' || authMethod === 'saml') && this.jwtService) {
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

    if ((scheme === 'Bearer' || scheme === 'ApiKey') && secretsEqual(providedKey, staticApiKey)) {
      return {
        isApiKeyAuth: true,
        user: { id: 'api-key-user', roles: ['admin', 'user'] },
      };
    }

    return null;
  }

  private async validateOidcToken(
    token: string,
    tenantId?: string,
    options?: SocketAuthOptions,
  ): Promise<SocketUserInfo | null> {
    // App-signed machine JWTs (PAT / app access tokens) never reach OIDC validation (same as PatBearerAuthGuard).
    if (this.jwtService) {
      let appPayload: UsersJwtSessionPayload | undefined;

      try {
        appPayload = await this.jwtService.verifyAsync<UsersJwtSessionPayload>(token);
      } catch {
        // Not an app-signed JWT — continue with OIDC validation.
      }

      if (appPayload && isMachineJwtAmr(appPayload.amr)) {
        return this.validateMachineToken(appPayload, tenantId, options);
      }
    }

    try {
      // Same verification as the HTTP OidcAuthGuard (signature, issuer, expiry, audience/azp, introspection).
      const claims = await this.oidcVerifier!.verifyAccessToken(token);
      // Socket.IO middleware runs before the tenant is bound to AsyncLocalStorage: resolve (and possibly create /
      // link) the user explicitly in the socket's tenant, never in an implicit default.
      const socketTenantId = tenantId ?? getTenantIdOrDefault();
      const user = await runWithTenantId(socketTenantId, () =>
        this.externalIdentityService.resolveUser({
          provider: 'oidc',
          subject: claims.sub,
          email: this.oidcVerifier!.getEmail(claims),
          emailVerified: parseEmailVerifiedClaim(claims.email_verified),
        }),
      );

      if (!this.userMatchesTenant(user, tenantId)) {
        return null;
      }

      const amr = ['oidc'];

      // Role from the local users table (as on HTTP), never from IdP role claims.
      return {
        userId: user.id,
        userRole: user.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.USER,
        isApiKeyAuth: false,
        amr,
        user: {
          id: user.id,
          email: user.email,
          roles: [user.role],
          amr,
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

      if (!isInteractiveAmrAllowedForMethod(payload.amr, getAuthenticationMethod())) {
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
      // PatAuthModule is registered by the host app (users / oidc / saml mode); absent in api-key mode → fail-closed.
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
}
