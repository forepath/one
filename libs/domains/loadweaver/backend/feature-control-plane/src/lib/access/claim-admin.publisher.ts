import {
  IDENTITY_NOTIFICATION_PUBLISHER,
  UserRole,
  type IIdentityNotificationPublisher,
} from '@forepath/identity/backend';
import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ClusterMemberEntity } from '../entities/cluster-member.entity';
import { AuditLogService } from '../services/audit-log.service';

/** `created_by` of the membership the claim grants. */
export const CLAIM_ADMIN_CREATED_BY = 'admin-claim';

/**
 * Claiming a cluster makes the claimer a cluster admin (user decision 2026-10-27): the first account of a cluster
 * (Loadweaver Cloud claim with `ADMIN_CLAIM_TOKEN_SHA256`, or the first registration on a bootstrapped cluster) gets
 * the `cluster-admin` cluster membership, not only the global admin role. Global admins are cluster admins only in
 * interactive sessions; with the membership their personal access tokens act as cluster admins too (registry pull /
 * push in every project under "registry by project roles", API automation).
 *
 * Only the very first account qualifies: the user must be an admin and the only account. An existing membership is
 * kept as it is. Recorded in the audit log (`cluster.member.set`, `details.via = 'admin-claim'`).
 */
@Injectable()
export class ClaimAdminMembershipService {
  private readonly logger = new Logger(ClaimAdminMembershipService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
  ) {}

  /** Grants `cluster-admin` to the claimer; true when the membership was created. */
  async grantClaimer(userId: string): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      const users: { id: string; role: string }[] = await manager.query('SELECT "id", "role" FROM "users" LIMIT 2');

      if (users.length !== 1 || users[0].id !== userId || users[0].role !== UserRole.ADMIN) return false;

      const repo = manager.getRepository(ClusterMemberEntity);

      if (await repo.findOne({ where: { userId } })) return false;

      await repo.save(repo.create({ userId, role: 'cluster-admin', createdBy: CLAIM_ADMIN_CREATED_BY }));
      await this.audit.record(manager, {
        actor: { type: 'user', id: userId },
        action: 'cluster.member.set',
        target: `cluster/member/${userId}`,
        details: { role: 'cluster-admin', previous: null, via: CLAIM_ADMIN_CREATED_BY },
      });
      this.logger.log(`The claiming account ${userId} is now a cluster admin`);

      return true;
    });
  }
}

/** Identity lifecycle events → the claim grant above. Fire and forget, as the identity publisher contract requires. */
@Injectable()
export class LoadweaverIdentityLifecyclePublisher implements IIdentityNotificationPublisher {
  private readonly logger = new Logger(LoadweaverIdentityLifecyclePublisher.name);

  constructor(private readonly claim: ClaimAdminMembershipService) {}

  publishUserCreated(data: Record<string, unknown>): void {
    if (data['role'] !== UserRole.ADMIN || typeof data['id'] !== 'string') return;

    void this.claim
      .grantClaimer(data['id'])
      .catch((error: unknown) =>
        this.logger.warn(
          `Could not make the claiming account a cluster admin: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }

  publishUserUpdated(): void {
    /* not used */
  }

  publishUserDeleted(): void {
    /* not used */
  }

  publishClientUserCreated(): void {
    /* not used */
  }

  publishClientUserDeleted(): void {
    /* not used */
  }
}

/**
 * Global bridge for the identity library's optional `IDENTITY_NOTIFICATION_PUBLISHER` (import once in `AppModule`).
 * Depends on the data source only (its own `AuditLogService` instance, stateless), so it can't close an injection
 * cycle with `UsersAuthModule`.
 */
@Global()
@Module({
  providers: [
    AuditLogService,
    ClaimAdminMembershipService,
    LoadweaverIdentityLifecyclePublisher,
    { provide: IDENTITY_NOTIFICATION_PUBLISHER, useExisting: LoadweaverIdentityLifecyclePublisher },
  ],
  exports: [IDENTITY_NOTIFICATION_PUBLISHER],
})
export class LoadweaverIdentityLifecycleBridgeModule {}
