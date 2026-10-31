import type { Readable } from 'node:stream';

import { getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import { projectBackupScope } from '@forepath/loadweaver/shared/util-agent-protocol';
import { backupPolicySpecSchema } from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThan, type FindOptionsWhere } from 'typeorm';

import {
  atLeast,
  canReadProject,
  canReadProjectSensitive,
  projectRole,
  type AccessCaller,
} from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import type { AlertFinding } from '../alerts/alert-rules.utils';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { samePerson } from '../fleet-identity/approval-persons';
import { emailOf, userEmails } from '../fleet-identity/user-emails';
import {
  assertFleetApprovalIdentity,
  assertFleetKitIdentity,
  assertNotLegacyFleetItem,
  fleetIdentityOf,
} from '../fleet-identity/fleet-identity.utils';
import { actorFromRequest, AuditLogService, ON_BEHALF_OF_SCOPE } from '../services/audit-log.service';
import {
  BackupDeletionEntity,
  BackupEntity,
  BackupRepositoryEntity,
  RestoreEntity,
  RestoreTestEntity,
} from './backup.entities';
import { BackupKeyService, type BackupKeyGenerationView } from './backup-keys.service';
import { BackupRepositoriesService } from './backup-repositories.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { approvalRefusal, backupPins, deletionDelayMs } from './backup.utils';
import type { KopiaDiff, KopiaListEntry } from './kopia-cli';
import { backupReportSection, type BackupReportSection } from './backup-usage';
import {
  declaredBackupTargets,
  platformCopyTargets,
  platformPins,
  platformSettings,
} from './platform/platform-dr.utils';

export interface BackupDto {
  id: string;
  scope: string;
  project: string | null;
  resource: string;
  policy: string | null;
  node: string | null;
  status: string;
  snapshotId: string | null;
  keyGeneration: number;
  bytes: number;
  uploadedBytes: number;
  files: number;
  targets: BackupEntity['targets'];
  keep: string[];
  hooks: boolean;
  encrypted: true;
  /** Immutable on an external target until (object lock), or null. */
  lockedUntil: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  deletedAt: string | null;
  /** Latest restore test of this backup. */
  restoreTest: { id: string; status: string; finishedAt: string | null } | null;
}

export interface RestoreTestDto {
  id: string;
  backupId: string;
  project: string | null;
  resource: string;
  node: string | null;
  status: string;
  keyGeneration: number;
  check: RestoreTestEntity['check'];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DeletionDto {
  id: string;
  kind: 'backups' | 'retention';
  scope: string;
  backupIds: string[];
  retention: BackupDeletionEntity['retention'];
  reason: string;
  state: string;
  requestedBy: string;
  /** Requester / approver emails (`null`: deleted user / not a user), like Agenstra's `createdByEmail`. */
  requestedByEmail: string | null;
  approvedBy: string | null;
  approvedByEmail: string | null;
  approvedAt: string | null;
  notBefore: string;
  executedAt: string | null;
  createdAt: string;
}

export interface RestoreDto {
  id: string;
  project: string;
  name: string;
  generation: number;
  backupId: string;
  volume: string;
  kind: string;
  status: string;
  node: string | null;
  progress: RestoreEntity['progress'];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface BackupsStatusDto {
  keys: { generation: number | null; kitConfirmed: boolean; escrowed: boolean };
  pins: string[];
  repositories: Array<{ scope: string; port: number; fingerprint: string; keyGeneration: number }>;
  targets: Array<{ target: string; scope: string; at: string; ok: boolean; error?: string }>;
  usage: Array<{ project: string; bytes: number; uploadedBytes: number; backups: number }>;
  deletionDelayHours: number;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function callerId(caller: AccessCaller): string {
  return caller.userId ?? (caller.isApiKey ? 'api-key' : 'anonymous');
}

/**
 * Who handled the recovery kit (share hand-out / confirmation): the verified fleet person when the request came
 * through a fleet (also via the API key's delegation, 2026-10-30), else the caller — never the fleet's service user.
 */
function kitHandler(req: RequestWithUser | undefined, caller: AccessCaller): string {
  return fleetIdentityOf(req)?.person ?? callerId(caller);
}

/**
 * Backups API (3.20): catalog / timeline per cluster and project, diff and file browsing via Kopia, restore tests,
 * deletion requests (second admin + delay), the backup key and recovery kit (cluster admins), "back up now", and the
 * data the overview, alerts, reports and quotas use.
 */
@Injectable()
export class BackupsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly keys: BackupKeyService,
    private readonly repositories: BackupRepositoriesService,
    private readonly scheduler: BackupSchedulerService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------------------------- catalog

  private async readable(req: RequestWithUser | undefined, project?: string): Promise<AccessCaller> {
    const caller = await this.access.caller(req);

    if (project && !canReadProject(caller, project)) throw new NotFoundException('project not found');

    if (!project && !caller.clusterRole && caller.projects.size === 0) throw new ForbiddenException('no access');

    return caller;
  }

  private visible(caller: AccessCaller, project: string | null): boolean {
    return project === null ? !!caller.clusterRole : canReadProject(caller, project);
  }

  async catalog(
    req: RequestWithUser | undefined,
    filter: { project?: string; resource?: string; includeDeleted?: boolean; limit?: number },
  ): Promise<BackupDto[]> {
    const caller = await this.readable(req, filter.project);
    const where: FindOptionsWhere<BackupEntity> = {
      ...(filter.project ? { project: filter.project } : {}),
      ...(filter.resource ? { resource: filter.resource } : {}),
      ...(filter.includeDeleted ? {} : { deletedAt: IsNull() }),
    };
    const rows = (
      await this.dataSource
        .getRepository(BackupEntity)
        .find({ where, order: { startedAt: 'DESC' }, take: Math.min(filter.limit ?? 500, 2000) })
    ).filter((r) => this.visible(caller, r.project));
    const tests = rows.length
      ? await this.dataSource
          .getRepository(RestoreTestEntity)
          .find({ where: { backupId: In(rows.map((r) => r.id)) }, order: { startedAt: 'DESC' } })
      : [];

    return rows.map((r) => this.toDto(r, tests.find((t) => t.backupId === r.id) ?? null));
  }

  private toDto(row: BackupEntity, test: RestoreTestEntity | null): BackupDto {
    const locks = row.targets.map((t) => t.lockedUntil).filter((l): l is string => !!l);

    return {
      id: row.id,
      scope: row.scope,
      project: row.project,
      resource: row.resource,
      policy: row.policy,
      node: row.node,
      status: row.status,
      snapshotId: row.snapshotId,
      keyGeneration: row.keyGeneration,
      bytes: row.bytes,
      uploadedBytes: row.uploadedBytes,
      files: row.files,
      targets: row.targets,
      keep: row.keep,
      hooks: row.hooks,
      encrypted: true,
      lockedUntil: locks.sort().at(-1) ?? null,
      error: row.error,
      startedAt: row.startedAt.toISOString(),
      finishedAt: iso(row.finishedAt),
      deletedAt: iso(row.deletedAt),
      restoreTest: test ? { id: test.id, status: test.status, finishedAt: iso(test.finishedAt) } : null,
    };
  }

  private async backup(req: RequestWithUser | undefined, id: string, sensitive: boolean): Promise<BackupEntity> {
    const row = await this.dataSource.getRepository(BackupEntity).findOne({ where: { id } });
    const caller = await this.access.caller(req);

    if (
      !row ||
      !(row.project
        ? sensitive
          ? canReadProjectSensitive(caller, row.project)
          : canReadProject(caller, row.project)
        : !!caller.clusterRole)
    )
      throw new NotFoundException('backup not found');

    return row;
  }

  async get(req: RequestWithUser | undefined, id: string): Promise<BackupDto> {
    const row = await this.backup(req, id, false);
    const test = await this.dataSource
      .getRepository(RestoreTestEntity)
      .findOne({ where: { backupId: id }, order: { startedAt: 'DESC' } });

    return this.toDto(row, test);
  }

  /** Changed files between two backups of the same volume (Kopia diff). */
  async diff(req: RequestWithUser | undefined, from: string, to: string): Promise<KopiaDiff> {
    const a = await this.backup(req, from, true);
    const b = await this.backup(req, to, true);

    if (a.scope !== b.scope || a.resource !== b.resource)
      throw new BadRequestException('only backups of the same volume can be compared');

    if (!a.rootObject || !b.rootObject || a.deletedAt || b.deletedAt)
      throw new BadRequestException('both backups must be available');

    return await this.repositories.cli.diff(
      await this.repositories.controlConnection(a.scope),
      a.rootObject,
      b.rootObject,
    );
  }

  private objectPath(row: BackupEntity, path: string | undefined): string {
    if (!row.rootObject || row.deletedAt) throw new BadRequestException('the backup is not available');

    const clean = (path ?? '').replace(/^\/+|\/+$/g, '');

    if (clean.split('/').some((s) => s === '..' || s === '.') || /[\0\n]/.test(clean))
      throw new BadRequestException('invalid path');

    return clean ? `${row.rootObject}/${clean}` : row.rootObject;
  }

  /** Browses a backup (file browser over the catalog, read-only). */
  async files(req: RequestWithUser | undefined, id: string, path?: string): Promise<KopiaListEntry[]> {
    const row = await this.backup(req, id, true);

    return await this.repositories.cli.list(
      await this.repositories.controlConnection(row.scope),
      this.objectPath(row, path),
    );
  }

  /** One file of a backup as a stream (audited: it is data). */
  async download(req: RequestWithUser | undefined, id: string, path: string): Promise<Readable> {
    const row = await this.backup(req, id, true);
    const object = this.objectPath(row, path);

    if (!path) throw new BadRequestException('path is required');

    await this.dataSource.transaction(async (manager) => {
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'backup.file-downloaded',
        target: `backup/${row.id}`,
        project: row.project,
        details: { path },
      });
    });

    return await this.repositories.cli.show(await this.repositories.controlConnection(row.scope), object);
  }

  /** "Back up now" for one volume (operators of its project). */
  async backupNow(req: RequestWithUser | undefined, volumeId: string): Promise<BackupDto> {
    const [project, deployment, volume] = volumeId.split('/');
    const caller = await this.access.caller(req);

    if (!project || !deployment || !volume) throw new BadRequestException('volume is <project>/<deployment>/<volume>');

    if (!atLeast(projectRole(caller, project), 'operator')) throw new ForbiddenException('operators back up volumes');

    const placement = await this.dataSource.getRepository(VolumePlacementEntity).findOne({ where: { id: volumeId } });

    if (!placement) throw new NotFoundException('volume not found');

    const running = await this.dataSource
      .getRepository(BackupEntity)
      .exists({ where: { resource: volumeId, status: 'running' } });

    if (running) throw new ConflictException('a backup of this volume is running');

    const deploymentRow = await this.dataSource
      .getRepository(ResourceEntity)
      .findOne({ where: { kind: 'Deployment', project, name: deployment } });
    const row = await this.scheduler.startBackup(
      { id: volumeId, project, deployment, volume, deploymentLabels: deploymentRow?.labels ?? {} },
      { key: null, hooks: true },
    );

    await this.dataSource.transaction(async (manager) => {
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'backup.started',
        target: `volume/${volumeId}`,
        project,
        details: { backup: row.id },
      });
    });

    return this.toDto(row, null);
  }

  /** Restore test of one backup now (operators). */
  async testNow(req: RequestWithUser | undefined, id: string): Promise<RestoreTestDto> {
    const row = await this.backup(req, id, true);
    const caller = await this.access.caller(req);

    if (!row.project || !atLeast(projectRole(caller, row.project), 'operator'))
      throw new ForbiddenException('operators start restore tests');

    if (row.status !== 'succeeded' || row.deletedAt) throw new BadRequestException('the backup is not available');

    return this.testDto(await this.scheduler.startRestoreTest(row));
  }

  async restoreTests(req: RequestWithUser | undefined, filter: { project?: string; resource?: string }) {
    const caller = await this.readable(req, filter.project);
    const rows = await this.dataSource.getRepository(RestoreTestEntity).find({
      where: {
        ...(filter.project ? { project: filter.project } : {}),
        ...(filter.resource ? { resource: filter.resource } : {}),
      },
      order: { startedAt: 'DESC' },
      take: 500,
    });

    return rows.filter((r) => this.visible(caller, r.project)).map((r) => this.testDto(r));
  }

  private testDto(r: RestoreTestEntity): RestoreTestDto {
    return {
      id: r.id,
      backupId: r.backupId,
      project: r.project,
      resource: r.resource,
      node: r.node,
      status: r.status,
      keyGeneration: r.keyGeneration,
      check: r.check,
      error: r.error,
      startedAt: r.startedAt.toISOString(),
      finishedAt: iso(r.finishedAt),
    };
  }

  async restores(req: RequestWithUser | undefined, project?: string): Promise<RestoreDto[]> {
    const caller = await this.readable(req, project);
    const rows = await this.dataSource
      .getRepository(RestoreEntity)
      .find({ where: project ? { project } : {}, order: { createdAt: 'DESC' }, take: 500 });

    return rows
      .filter((r) => canReadProject(caller, r.project))
      .map((r) => ({
        id: r.id,
        project: r.project,
        name: r.name,
        generation: r.generation,
        backupId: r.backupId,
        volume: r.volume,
        kind: r.kind,
        status: r.status,
        node: r.node,
        progress: r.progress,
        error: r.error,
        startedAt: iso(r.startedAt),
        finishedAt: iso(r.finishedAt),
      }));
  }

  async status(req: RequestWithUser | undefined): Promise<BackupsStatusDto> {
    const caller = await this.readable(req);
    const keys = await this.keys.recoverable();
    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: In(['BackupPolicy', 'BackupTarget']) } });

    return {
      keys,
      pins: [
        ...backupPins(
          keys,
          resources.filter((r) => r.kind === 'BackupTarget').length,
          resources.filter((r) => r.kind === 'BackupPolicy').length,
        ),
        ...(caller.clusterRole ? await this.platformPins() : []),
      ],
      repositories: caller.clusterRole
        ? (await this.repositories.list()).map((r) => ({
            scope: r.scope,
            port: r.port,
            fingerprint: r.fingerprint,
            keyGeneration: r.keyGeneration,
          }))
        : [],
      targets: [...this.scheduler.targetStatus.values()].filter((t) =>
        t.scope === 'cluster' ? !!caller.clusterRole : canReadProject(caller, t.scope.replace(/^project-/, '')),
      ),
      usage: (await this.usage()).filter((u) => canReadProject(caller, u.project)),
      deletionDelayHours: deletionDelayMs() / 3_600_000,
    };
  }

  /** Backup bytes per project (live backups): what counts against storage quotas (3.17). */
  async usage(): Promise<Array<{ project: string; bytes: number; uploadedBytes: number; backups: number }>> {
    const rows: Array<{ project: string; bytes: string; uploaded: string; backups: string }> =
      await this.dataSource.query(
        `SELECT project, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(uploaded_bytes), 0) AS uploaded,
              COUNT(*) AS backups
       FROM lw_backups WHERE project IS NOT NULL AND deleted_at IS NULL AND status = 'succeeded' GROUP BY project`,
      );

    return rows.map((r) => ({
      project: r.project,
      bytes: Number(r.bytes),
      uploadedBytes: Number(r.uploaded),
      backups: Number(r.backups),
    }));
  }

  // -------------------------------------------------------------------------------------------- deletions

  private isAdmin(caller: AccessCaller, scope: string): boolean {
    return scope === 'cluster'
      ? caller.clusterRole === 'cluster-admin'
      : projectRole(caller, scope.replace(/^project-/, '')) === 'admin';
  }

  async deletions(req: RequestWithUser | undefined): Promise<DeletionDto[]> {
    const caller = await this.access.caller(req);
    const rows = await this.dataSource
      .getRepository(BackupDeletionEntity)
      .find({ order: { createdAt: 'DESC' }, take: 500 });

    const visible = rows.filter((r) =>
      r.scope === 'cluster' ? !!caller.clusterRole : canReadProject(caller, r.scope.replace(/^project-/, '')),
    );
    const emails = await userEmails(
      this.dataSource,
      visible.flatMap((r) => [r.requestedBy, r.approvedBy]),
    );

    return visible.map((r) => deletionDto(r, emails));
  }

  /** Deleting backups needs a second admin and only takes effect after the delay (3.20). */
  async requestDeletion(
    req: RequestWithUser | undefined,
    input: { backupIds: string[]; reason: string },
  ): Promise<DeletionDto> {
    const caller = await this.access.caller(req);

    if (!input.backupIds.length || input.backupIds.length > 1000) throw new BadRequestException('1–1000 backups');

    const rows = await this.dataSource
      .getRepository(BackupEntity)
      .find({ where: { id: In(input.backupIds), deletedAt: IsNull() } });
    const scopes = new Set(rows.map((r) => r.scope));

    if (rows.length !== new Set(input.backupIds).size) throw new NotFoundException('backup not found');

    if (scopes.size !== 1) throw new BadRequestException('one request per repository (project)');

    const [scope] = scopes;

    if (!this.isAdmin(caller, scope)) throw new ForbiddenException('only admins request backup deletions');

    return await this.dataSource.transaction(async (manager) => {
      const row = await manager.getRepository(BackupDeletionEntity).save(
        manager.getRepository(BackupDeletionEntity).create({
          kind: 'backups',
          scope,
          backupIds: rows.map((r) => r.id),
          retention: null,
          reason: input.reason,
          state: 'pending',
          requestedBy: callerId(caller),
          approvedBy: null,
          approvedAt: null,
          notBefore: new Date(Date.now() + deletionDelayMs()),
          executedAt: null,
        }),
      );

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'backup.deletion-requested',
        target: `backup-deletion/${row.id}`,
        project: rows[0].project,
        details: { backups: row.backupIds, reason: input.reason, notBefore: row.notBefore.toISOString() },
      });

      return deletionDto(row, await userEmails(manager, [row.requestedBy, row.approvedBy]));
    });
  }

  async approveDeletion(req: RequestWithUser | undefined, id: string): Promise<DeletionDto> {
    // Through a fleet only with a verified person (3.24).
    assertFleetApprovalIdentity(req, ON_BEHALF_OF_SCOPE);

    const caller = await this.access.caller(req);

    return await this.dataSource.transaction(async (manager) => {
      const row = await manager
        .getRepository(BackupDeletionEntity)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      if (!row) throw new NotFoundException('deletion request not found');

      const refusal = approvalRefusal(row, { id: callerId(caller), admin: this.isAdmin(caller, row.scope) });

      if (refusal) throw new ForbiddenException(refusal);

      assertNotLegacyFleetItem(req, row.requestedBy, getUserFromRequest(req ?? ({} as RequestWithUser)).userId);

      // A fleet person with the requester's verified email is the requester (3.24).
      if (await samePerson(manager, callerId(caller), row.requestedBy))
        throw new ForbiddenException('a second admin has to approve (not the requester)');

      row.state = 'approved';
      row.approvedBy = callerId(caller);
      row.approvedAt = new Date();
      await manager.getRepository(BackupDeletionEntity).save(row);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'backup.deletion-approved',
        target: `backup-deletion/${row.id}`,
        details: { kind: row.kind, scope: row.scope, notBefore: row.notBefore.toISOString() },
      });

      return deletionDto(row, await userEmails(manager, [row.requestedBy, row.approvedBy]));
    });
  }

  /** Cancels a pending or approved request before it took effect (any admin of the scope). */
  async cancelDeletion(req: RequestWithUser | undefined, id: string): Promise<DeletionDto> {
    const caller = await this.access.caller(req);

    return await this.dataSource.transaction(async (manager) => {
      const row = await manager
        .getRepository(BackupDeletionEntity)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      if (!row) throw new NotFoundException('deletion request not found');

      if (!this.isAdmin(caller, row.scope)) throw new ForbiddenException('only admins cancel backup deletions');

      if (row.state !== 'pending' && row.state !== 'approved')
        throw new ConflictException(`the request is ${row.state}`);

      row.state = 'cancelled';
      await manager.getRepository(BackupDeletionEntity).save(row);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'backup.deletion-cancelled',
        target: `backup-deletion/${row.id}`,
        details: { kind: row.kind, scope: row.scope },
      });

      return deletionDto(row, await userEmails(manager, [row.requestedBy, row.approvedBy]));
    });
  }

  // ------------------------------------------------------------------------------------- keys & recovery kit

  private async assertClusterAdmin(req: RequestWithUser | undefined): Promise<AccessCaller> {
    const caller = await this.access.caller(req);

    if (caller.clusterRole !== 'cluster-admin') throw new ForbiddenException('cluster admins manage backup keys');

    return caller;
  }

  async keyGenerations(req: RequestWithUser | undefined): Promise<BackupKeyGenerationView[]> {
    await this.assertClusterAdmin(req);
    // The first generation is created on first use.
    await this.keys.current();

    return await this.keys.list();
  }

  async rotateKey(req: RequestWithUser | undefined, kit?: { shares: number; threshold: number }) {
    await this.assertClusterAdmin(req);

    return await this.keys.rotate(actorFromRequest(req), kit);
  }

  async reissueKit(req: RequestWithUser | undefined, generation: number, kit: { shares: number; threshold: number }) {
    assertFleetKitIdentity(req, ON_BEHALF_OF_SCOPE);
    await this.assertClusterAdmin(req);

    return await this.keys.reissueKit(generation, actorFromRequest(req), kit);
  }

  async downloadShare(req: RequestWithUser | undefined, generation: number, index: number) {
    assertFleetKitIdentity(req, ON_BEHALF_OF_SCOPE);
    const caller = await this.assertClusterAdmin(req);

    return await this.keys.downloadShare(generation, index, {
      ...actorFromRequest(req),
      label: kitHandler(req, caller),
    });
  }

  async confirmKit(req: RequestWithUser | undefined, generation: number, shares: string[]) {
    assertFleetKitIdentity(req, ON_BEHALF_OF_SCOPE);
    const caller = await this.assertClusterAdmin(req);

    await this.keys.confirmKit(generation, shares, { ...actorFromRequest(req), label: kitHandler(req, caller) });
  }

  async escrowKey(req: RequestWithUser | undefined, generation: number) {
    await this.assertClusterAdmin(req);

    return await this.keys.escrow(generation, actorFromRequest(req));
  }

  // ------------------------------------------------------------------------- overview / alerts / reports hooks

  /** Inbox items (3.25): unconfirmed kit, pending deletion requests the caller may approve. */
  async inboxItems(
    caller: AccessCaller,
  ): Promise<
    Array<{ severity: 'critical' | 'warning' | 'info'; title: string; link: string; project?: string; since?: string }>
  > {
    const items: Array<{
      severity: 'critical' | 'warning' | 'info';
      title: string;
      link: string;
      project?: string;
      since?: string;
    }> = [];

    if (caller.clusterRole) {
      const policies = await this.dataSource.getRepository(ResourceEntity).count({ where: { kind: 'BackupPolicy' } });
      const keys = await this.keys.recoverable();

      for (const pin of await this.platformPins())
        items.push({ severity: 'warning', title: `Control-plane backups: ${pin}`, link: '/operate/backups/platform' });

      if (policies > 0 && !keys.kitConfirmed && !keys.escrowed)
        items.push({
          severity: 'critical',
          title: 'Backups not recoverable: download and confirm the recovery kit of the backup key',
          link: '/operate/backups/keys',
        });
    }

    const pending = await this.dataSource.getRepository(BackupDeletionEntity).find({ where: { state: 'pending' } });

    for (const d of pending)
      if (this.isAdmin(caller, d.scope) && d.requestedBy !== callerId(caller))
        items.push({
          severity: 'warning',
          title:
            d.kind === 'retention'
              ? `Shortened backup retention of ${d.retention?.policy} waits for a second admin`
              : `Deletion of ${d.backupIds.length} backup(s) waits for a second admin`,
          link: '/operate/backups/deletions',
          ...(d.scope.startsWith('project-') ? { project: d.scope.slice('project-'.length) } : {}),
          since: d.createdAt.toISOString(),
        });

    return items;
  }

  /** Built-in alerts (3.18): failed backups / restore tests, an unconfirmed kit, pending deletions. */
  async alertFindings(
    rule:
      | 'builtin:backup-failed'
      | 'builtin:restore-test-failed'
      | 'builtin:backup-kit-unconfirmed'
      | 'builtin:backup-deletion-requested',
    now: Date,
  ): Promise<AlertFinding[]> {
    const base = { forMs: 0, repeatMs: 0, notify: { emails: [], webhooks: true } };

    switch (rule) {
      case 'builtin:backup-failed': {
        // The newest backup per volume failed.
        const rows: Array<{ resource: string; project: string | null; status: string; error: string | null }> =
          await this.dataSource.query(
            `SELECT DISTINCT ON (resource) resource, project, status, error FROM lw_backups
             WHERE status <> 'running' ORDER BY resource, started_at DESC`,
          );

        return rows
          .filter((r) => r.status === 'failed')
          .map((r) => ({
            ...base,
            rule,
            key: r.resource,
            ...(r.project ? { project: r.project } : {}),
            severity: 'critical' as const,
            title: `Backup of ${r.resource} failed`,
            message: `The latest backup of volume ${r.resource} failed${r.error ? `: ${r.error}` : ''}.`,
          }));
      }
      case 'builtin:restore-test-failed': {
        const rows: Array<{ resource: string; project: string | null; status: string; error: string | null }> =
          await this.dataSource.query(
            `SELECT DISTINCT ON (resource) resource, project, status, error FROM lw_restore_tests
             WHERE status <> 'running' ORDER BY resource, started_at DESC`,
          );

        return rows
          .filter((r) => r.status === 'failed')
          .map((r) => ({
            ...base,
            rule,
            key: r.resource,
            ...(r.project ? { project: r.project } : {}),
            severity: 'critical' as const,
            title: `Restore test of ${r.resource} failed`,
            message: `The latest restore test of volume ${r.resource} failed${r.error ? `: ${r.error}` : ''}.`,
          }));
      }
      case 'builtin:backup-kit-unconfirmed': {
        const policies = await this.dataSource.getRepository(ResourceEntity).count({ where: { kind: 'BackupPolicy' } });
        const keys = await this.keys.recoverable();

        return policies > 0 && keys.generation !== null && !keys.kitConfirmed && !keys.escrowed
          ? [
              {
                ...base,
                rule,
                key: `generation-${keys.generation}`,
                severity: 'warning' as const,
                // Don't page right after setup: the admins get a day to download and confirm the kit.
                forMs: 24 * 3_600_000,
                title: 'Backups not recoverable: recovery kit not confirmed',
                message: `The recovery kit of backup key generation ${keys.generation} is not confirmed and the key isn't escrowed in a KMS; losing the cluster would lose the ability to decrypt the backups.`,
              },
            ]
          : [];
      }
      case 'builtin:backup-deletion-requested': {
        const rows = await this.dataSource
          .getRepository(BackupDeletionEntity)
          .find({ where: { state: In(['pending', 'approved']), notBefore: MoreThan(now) } });

        return rows.map((d) => ({
          ...base,
          rule,
          key: d.id,
          ...(d.scope.startsWith('project-') ? { project: d.scope.slice('project-'.length) } : {}),
          severity: 'warning' as const,
          title:
            d.kind === 'retention'
              ? `Backup retention of ${d.retention?.policy} is being shortened`
              : `${d.backupIds.length} backup(s) are scheduled for deletion`,
          // Action and object only: no user id or email (alerts also go to notification channels, D11).
          message: `${d.reason} — ${d.state === 'approved' ? 'approved, takes effect' : 'needs a second admin, earliest'} ${d.notBefore.toISOString()}.`,
        }));
      }
    }
  }

  /** Report section (3.25): backups and restore tests of a project (or the cluster) in a period. */
  async reportSection(project: string | null, from: Date, to: Date): Promise<BackupReportSection> {
    return await backupReportSection(this.dataSource, project, from, to);
  }

  /** Pins of the control-plane data backups (3.20): no external target receives their copy. */
  async platformPins(): Promise<string[]> {
    const settings = await platformSettings(this.dataSource);

    return platformPins(
      settings,
      platformCopyTargets(settings, await declaredBackupTargets(this.dataSource)).targets.length,
    );
  }

  /** Pins for plans touching backup policies (3.12): unrecoverable kit, no external target. */
  async planPins(): Promise<string[]> {
    const keys = await this.keys.recoverable();
    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: In(['BackupPolicy', 'BackupTarget']) } });

    return backupPins(
      keys,
      resources.filter((r) => r.kind === 'BackupTarget').length,
      resources.filter((r) => r.kind === 'BackupPolicy').length,
    );
  }

  /** Scopes of the projects that have backup policies (for the repositories view). */
  async policyScopes(): Promise<string[]> {
    const policies = await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'BackupPolicy' } });

    return [
      ...new Set(
        policies.flatMap((p) => {
          const spec = backupPolicySpecSchema.parse(p.spec);

          return p.project ? [projectBackupScope(p.project)] : (spec.selector.projects ?? []).map(projectBackupScope);
        }),
      ),
    ];
  }

  async repositoryRows(): Promise<BackupRepositoryEntity[]> {
    return await this.repositories.list();
  }
}

function deletionDto(r: BackupDeletionEntity, emails: ReadonlyMap<string, string | null> = new Map()): DeletionDto {
  return {
    id: r.id,
    kind: r.kind,
    scope: r.scope,
    backupIds: r.backupIds,
    retention: r.retention,
    reason: r.reason,
    state: r.state,
    requestedBy: r.requestedBy,
    requestedByEmail: emailOf(emails, r.requestedBy),
    approvedBy: r.approvedBy,
    approvedByEmail: emailOf(emails, r.approvedBy),
    approvedAt: iso(r.approvedAt),
    notBefore: r.notBefore.toISOString(),
    executedAt: iso(r.executedAt),
    createdAt: r.createdAt.toISOString(),
  };
}
