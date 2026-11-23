import {
  assertPatScopes,
  getUserFromRequest,
  isAdministrativeRole,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

export function assertNotificationAdmin(req: Request): void {
  const u = getUserFromRequest(req as RequestWithUser);

  if (!u.isApiKeyAuth && !isAdministrativeRole(u.userRole)) {
    throw new ForbiddenException('Admin only');
  }

  assertPatScopes(u, 'webhooks:admin');
}
