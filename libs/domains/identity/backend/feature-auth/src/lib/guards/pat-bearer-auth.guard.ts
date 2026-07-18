import {
  getAuthenticationMethod,
  getHttpRequestPath,
  isBullBoardRequestPath,
  IS_PUBLIC_KEY,
} from '@forepath/identity/backend';
import { DEFAULT_TENANT, getTenantId, getTenantIdOrDefault } from '@forepath/shared/backend';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { RevokedUserTokensRepository } from '../repositories/revoked-user-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';
import { PersonalAccessTokenService } from '../services/personal-access-token.service';
import { assertUsersJwtSessionValid, type UsersJwtSessionPayload } from '../utils/users-jwt-session.util';

import type { AuthenticatedUsersRequestUser } from './users-auth.guard';

/**
 * Keycloak-mode hybrid: accept app-signed PAT JWTs (`amr: pat`) before nest-keycloak AuthGuard.
 * Non-PAT bearers pass through so Keycloak OIDC validation can run.
 */
@Injectable()
export class PatBearerAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly usersRepository: UsersRepository,
    private readonly revokedUserTokensRepository: RevokedUserTokensRepository,
    private readonly personalAccessTokenService: PersonalAccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (getAuthenticationMethod() !== 'keycloak') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (isBullBoardRequestPath(getHttpRequestPath(context))) {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      Request & {
        tenantId?: string;
        patAuthenticated?: boolean;
        apiKeyAuthenticated?: boolean;
        user?: AuthenticatedUsersRequestUser;
      }
    >();

    if (request.patAuthenticated || request.apiKeyAuthenticated) {
      return true;
    }

    const token = this.extractTokenFromHeader(request);

    if (!token) {
      return true;
    }

    let payload: UsersJwtSessionPayload;

    try {
      payload = await this.jwtService.verifyAsync<UsersJwtSessionPayload>(token);
    } catch {
      // Not an app-signed JWT (likely Keycloak access token) — let Keycloak guards handle it.
      return true;
    }

    const amr = payload.amr ?? [];

    if (!amr.includes('pat')) {
      return true;
    }

    try {
      const user = await this.usersRepository.findById(payload.sub);

      if (!user) {
        throw new UnauthorizedException('Session is no longer valid.');
      }

      if (user.lockedAt) {
        throw new UnauthorizedException('This account is locked. Please contact an administrator.');
      }

      const requestTenantId = request.tenantId ?? getTenantId() ?? getTenantIdOrDefault();
      const userTenantId = user.tenantId?.trim() || DEFAULT_TENANT;

      if (userTenantId !== requestTenantId) {
        throw new UnauthorizedException('Session is no longer valid.');
      }

      await assertUsersJwtSessionValid(payload, user, this.revokedUserTokensRepository);

      if (!payload.patId) {
        throw new UnauthorizedException('Session is no longer valid.');
      }

      const active = await this.personalAccessTokenService.assertPatJwtActive(
        payload.patId,
        payload.sub,
        payload.scopes,
      );

      request.patAuthenticated = true;
      request.user = {
        id: payload.sub,
        email: user.email,
        roles: [user.role],
        amr,
        scopes: active.scopes,
        patId: payload.patId,
        jti: payload.jti,
        exp: typeof payload.exp === 'number' ? payload.exp : undefined,
      } satisfies AuthenticatedUsersRequestUser;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];

    return type === 'Bearer' ? token : undefined;
  }
}
