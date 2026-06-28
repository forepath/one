import { UserRole } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import type { UserInfoFromRequest } from '../../utils/billing-access.utils';
import { ensureAdmin } from '../../utils/billing-access.utils';
import type { ProjectEntity } from '../entities/project.entity';
import type { ProjectMilestoneEntity } from '../entities/project-milestone.entity';
import type { ProjectTicketEntity } from '../entities/project-ticket.entity';

export function ensureProjectReadable(userInfo: UserInfoFromRequest, project: ProjectEntity): void {
  if (userInfo.isApiKeyAuth) {
    throw new ForbiddenException('User not authenticated');
  }

  if (userInfo.userRole === UserRole.ADMIN) {
    return;
  }

  if (!userInfo.userId || project.userId !== userInfo.userId) {
    throw new ForbiddenException('Access denied');
  }
}

export function ensureProjectAdmin(userInfo: UserInfoFromRequest): void {
  ensureAdmin(userInfo);
}

export function isMilestoneLocked(milestone: ProjectMilestoneEntity | null | undefined): boolean {
  return milestone?.lockedAt != null;
}

export function isTicketLockedForNonAdmin(
  ticket: ProjectTicketEntity,
  milestone: ProjectMilestoneEntity | null | undefined,
): boolean {
  return ticket.locked || isMilestoneLocked(milestone);
}

export function ensureProjectBoardWrite(
  userInfo: UserInfoFromRequest,
  project: ProjectEntity,
  ticket?: ProjectTicketEntity,
  milestone?: ProjectMilestoneEntity | null,
): void {
  ensureProjectAdmin(userInfo);
  ensureProjectReadable(userInfo, project);

  if (ticket && isTicketLockedForNonAdmin(ticket, milestone ?? null)) {
    return;
  }
}

export function ensureProjectComment(userInfo: UserInfoFromRequest, project: ProjectEntity): void {
  ensureProjectReadable(userInfo, project);

  if (userInfo.isApiKeyAuth || !userInfo.userId) {
    throw new ForbiddenException('User not authenticated');
  }
}

export function ensureCustomerTicketReadOnlyWriteBlocked(userInfo: UserInfoFromRequest): void {
  if (userInfo.userRole !== UserRole.ADMIN) {
    throw new ForbiddenException('Admin access required');
  }
}
