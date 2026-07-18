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
import { assertUsersJwtSessionValid, UsersJwtSessionPayload } from '../utils/users-jwt-session.util';

export type UsersJwtPayload = UsersJwtSessionPayload;

export interface AuthenticatedUsersRequestUser {
  id: string;
  email: string;
  roles: string[];
  amr?: string[];
  scopes?: string[];
  patId?: string;
  jti?: string;
  exp?: number;
}

@Injectable()
export class UsersAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly usersRepository: UsersRepository,
    private readonly revokedUserTokensRepository: RevokedUserTokensRepository,
    private readonly personalAccessTokenService: PersonalAccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Bull Board uses HTTP Basic auth (QUEUE_BULL_BOARD_*), not JWT
    if (isBullBoardRequestPath(getHttpRequestPath(context))) {
      return true;
    }

    const authMethod = getAuthenticationMethod();
    const request = context.switchToHttp().getRequest<
      Request & {
        tenantId?: string;
        patAuthenticated?: boolean;
        apiKeyAuthenticated?: boolean;
        user?: AuthenticatedUsersRequestUser | { id?: string };
      }
    >();

    // Keycloak / api-key: global guards authenticate. When this guard is used at controller
    // level (e.g. PAT CRUD), require a resolved local user id (synced OIDC or PAT).
    if (authMethod === 'keycloak') {
      if (request.patAuthenticated || request.user?.id) {
        return true;
      }

      throw new UnauthorizedException('Missing or invalid authorization token');
    }

    if (authMethod !== 'users') {
      return true;
    }

    // Pass through when user is already set (e.g. by API key or other auth)
    if (request.user) {
      return true;
    }

    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Missing or invalid authorization token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<UsersJwtSessionPayload>(token);
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

      const amr = payload.amr ?? ['pwd'];
      let scopes = payload.scopes;

      if (amr.includes('pat')) {
        if (!payload.patId) {
          throw new UnauthorizedException('Session is no longer valid.');
        }

        const active = await this.personalAccessTokenService.assertPatJwtActive(
          payload.patId,
          payload.sub,
          payload.scopes,
        );

        scopes = active.scopes;
      }

      request.user = {
        id: payload.sub,
        // Always use live DB role so demotion takes effect without waiting for JWT expiry.
        email: user.email,
        roles: [user.role],
        amr,
        scopes,
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
