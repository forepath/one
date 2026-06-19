import { IS_PUBLIC_KEY, UsersRepository } from '@forepath/identity/backend';
import { DEFAULT_TENANT, getTenantIdOrDefault } from '@forepath/shared/backend';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { RequestWithUser } from '../utils/billing-access.utils';

@Injectable()
export class TenantUserGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersRepository: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser & Request>();
    const requestTenantId = request.tenantId ?? getTenantIdOrDefault();

    if (request.apiKeyAuthenticated) {
      // AR-007: without STATIC_API_KEY_TENANT_ID, a valid STATIC_API_KEY may access any
      // configured tenant via X-Tenant (accepted — single shared automation key).
      const apiKeyTenantId = process.env['STATIC_API_KEY_TENANT_ID']?.trim();

      if (apiKeyTenantId && apiKeyTenantId !== requestTenantId) {
        throw new ForbiddenException('Access denied');
      }

      return true;
    }

    const userId = request.user?.id;

    if (!userId) {
      // Auth guards run later in the global guard chain; they return 401 when unauthenticated.
      return true;
    }

    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    const userTenantId = user.tenantId?.trim() || DEFAULT_TENANT;

    if (userTenantId !== requestTenantId) {
      throw new ForbiddenException('Access denied');
    }

    return true;
  }
}
