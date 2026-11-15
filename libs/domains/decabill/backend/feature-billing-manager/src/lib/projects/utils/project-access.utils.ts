import { assertPatScopes, UserRole } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { UserInfoFromRequest } from '../../utils/billing-access.utils';
import { ensureAdmin } from '../../utils/billing-access.utils';
import type { ProjectMilestoneEntity } from '../entities/project-milestone.entity';
import type { ProjectTicketEntity } from '../entities/project-ticket.entity';
import type { ProjectEntity } from '../entities/project.entity';

export type ProjectAdminScope =
  | 'projects:admin'
  | 'tickets:admin'
  | 'milestones:admin'
  | 'time_entries:admin'
  | 'attachments:admin';

/**
 * Owners always pass. Admins pass for other users' projects: interactive sessions unconditionally,
 * personal access tokens only with `adminScope` (the route resource's `:admin` scope). Without
 * `adminScope`, PAT admins never get cross-owner access (fail-closed).
 */
export function ensureProjectReadable(
  userInfo: UserInfoFromRequest,
  project: ProjectEntity,
  adminScope?: ProjectAdminScope,
): void {
  if (userInfo.isApiKeyAuth) {
    throw new ForbiddenException('User not authenticated');
  }

  if (userInfo.userId && project.userId === userInfo.userId) {
    return;
  }

  if (userInfo.userRole === UserRole.ADMIN) {
    if (!(userInfo.amr ?? []).includes('pat')) {
      return;
    }

    if (adminScope) {
      assertPatScopes(userInfo, adminScope);

      return;
    }
  }

  throw new ForbiddenException('Access denied');
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

export function ensureTicketUnlocked(ticket: ProjectTicketEntity): void {
  if (ticket.locked) {
    throw new BadRequestException('Ticket is locked');
  }
}

export function ensureProjectComment(userInfo: UserInfoFromRequest, project: ProjectEntity): void {
  ensureProjectReadable(userInfo, project, 'tickets:admin');

  if (userInfo.isApiKeyAuth || !userInfo.userId) {
    throw new ForbiddenException('User not authenticated');
  }
}
