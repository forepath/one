import { getAuthenticationMethod, IS_PUBLIC_KEY, UserEntity, UserRole } from '@forepath/identity/backend';
import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UsersRepository } from '../repositories/users.repository';

/**
 * Keycloak token payload attached to request by nest-keycloak-connect.
 */
interface KeycloakTokenPayload {
  sub?: string;
  email?: string;
  preferred_username?: string;
  [key: string]: unknown;
}

/**
 * Guard that syncs Keycloak-authenticated users to the users table.
 * First user gets admin role, subsequent users get user role.
 * Runs after Keycloak AuthGuard; ensures request.user has our format { id, email, roles }.
 * Rejects with 401 if the resolved local user row has `locked_at` set (same message as users JWT guard).
 */
@Injectable()
export class KeycloakAuthGuard implements CanActivate {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (getAuthenticationMethod() !== 'keycloak') {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      patAuthenticated?: boolean;
      user?: KeycloakTokenPayload | { id: string; username: string; roles: UserRole[] };
    }>();

    if (request.patAuthenticated) {
      return true;
    }

    const tokenPayload = request.user as KeycloakTokenPayload | undefined;

    if (!tokenPayload?.sub) {
      return true;
    }

    const email = tokenPayload.email || tokenPayload.preferred_username || `${tokenPayload.sub}@keycloak`;
    const user = await this.syncUser(tokenPayload.sub, email);

    if (user.tenantId !== getTenantIdOrDefault()) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    request.user = {
      id: user.id,
      username: user.email,
      roles: [user.role],
    };

    return true;
  }

  private assertUserNotLocked(user: UserEntity): void {
    if (user.lockedAt) {
      throw new UnauthorizedException('This account is locked. Please contact an administrator.');
    }
  }

  private async syncUser(
    keycloakSub: string,
    email: string,
  ): Promise<{ id: string; email: string; role: UserRole; tenantId: string }> {
    let user = await this.usersRepository.findByKeycloakSub(keycloakSub);

    if (user) {
      this.assertUserNotLocked(user);

      return { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId };
    }

    const count = await this.usersRepository.countByTenant();
    const role = count === 0 ? UserRole.ADMIN : UserRole.USER;

    user = await this.usersRepository.findByEmail(email.toLowerCase());

    if (user) {
      this.assertUserNotLocked(user);
      await this.usersRepository.update(user.id, { keycloakSub });

      return { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId };
    }

    user = await this.usersRepository.create({
      email: email.toLowerCase(),
      keycloakSub,
      role,
      emailConfirmedAt: new Date(),
    });

    return { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId };
  }
}
