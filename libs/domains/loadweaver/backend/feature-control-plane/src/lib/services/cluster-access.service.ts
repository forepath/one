import { getUserFromRequest, UserRole, type RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException, Injectable } from '@nestjs/common';

import type { ClusterRole } from '../entities/cluster-member.entity';
import { ClusterMembersRepository } from '../repositories/cluster-members.repository';

/** What a caller wants to do at cluster level (3.17). */
export type ClusterPermission = 'read' | 'infra' | 'admin' | 'audit';

const ROLE_PERMISSIONS: Record<ClusterRole, readonly ClusterPermission[]> = {
  'cluster-admin': ['read', 'infra', 'admin', 'audit'],
  'infra-operator': ['read', 'infra'],
  auditor: ['read', 'audit'],
};

export interface ClusterCaller {
  userId?: string;
  isApiKey: boolean;
  role?: ClusterRole;
}

/**
 * Cluster-level authorization: global admins (interactive sessions) and the static API key are cluster admins;
 * everyone else needs a cluster role. PAT sessions never inherit admin powers from the JWT role claim.
 */
@Injectable()
export class ClusterAccessService {
  constructor(private readonly members: ClusterMembersRepository) {}

  async resolve(req?: RequestWithUser): Promise<ClusterCaller> {
    const info = getUserFromRequest(req || ({} as RequestWithUser));

    if (info.isApiKeyAuth) return { isApiKey: true, role: 'cluster-admin' };

    const isPat = (info.amr ?? []).includes('pat');

    if (info.userRole === UserRole.ADMIN && !isPat)
      return { userId: info.userId, isApiKey: false, role: 'cluster-admin' };

    if (!info.userId) return { isApiKey: false };

    const membership = await this.members.findByUserId(info.userId);

    return { userId: info.userId, isApiKey: false, role: membership?.role };
  }

  async can(req: RequestWithUser | undefined, permission: ClusterPermission): Promise<boolean> {
    const caller = await this.resolve(req);

    return !!caller.role && ROLE_PERMISSIONS[caller.role].includes(permission);
  }

  async assert(req: RequestWithUser | undefined, permission: ClusterPermission): Promise<ClusterCaller> {
    const caller = await this.resolve(req);

    if (!caller.role || !ROLE_PERMISSIONS[caller.role].includes(permission)) {
      throw new ForbiddenException('Missing cluster permission');
    }

    return caller;
  }
}
