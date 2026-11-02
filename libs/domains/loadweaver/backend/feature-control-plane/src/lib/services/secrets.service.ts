import { createHmac, hkdfSync, randomBytes } from 'node:crypto';

import { volumeKeyRef } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { RequestWithUser } from '@forepath/identity/backend';

import { envelopeDecrypt, envelopeEncrypt } from '@forepath/loadweaver/shared/util-secrets';
import {
  RESOURCE_KINDS,
  virtualMachineSpecSchema,
  VM_DEPLOYMENT_NAME,
  type ResourceKind,
} from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';

import { atLeast, projectRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { AuditEventEntity } from '../entities/audit-event.entity';
import { GitConnectionEntity } from '../entities/git.entity';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { SecretEntity } from '../entities/secret.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { capRolesToFleetIdentity, fleetIdentityOf } from '../fleet-identity/fleet-identity.utils';
import { AuditLogService, type AuditActor } from './audit-log.service';
import { MasterKeyService } from './master-key.service';
import { WorkloadPlannerService } from './workload-planner.service';
import { vmCloudInit, vmSecretVersionKey } from '../utils/vm-planning.utils';

export const MAX_SECRET_BYTES = 1024 * 1024;
const SECRET_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const REF = /^secret:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)\/([a-z0-9][a-z0-9._-]{0,127})(?:@(\d+))?$/;

export interface SecretUsage {
  kind: string;
  project: string;
  name: string;
  pinnedVersion: number | null;
}

export interface SecretSummary {
  project: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  reserved: boolean;
  usedBy: SecretUsage[];
}

export interface SecretNamesDto {
  items: { name: string }[];
}

export function parseSecretRef(ref: string): { project: string; name: string; version?: number } | null {
  const match = REF.exec(ref);

  return match ? { project: match[1], name: match[3], ...(match[4] ? { version: Number(match[4]) } : {}) } : null;
}

function aad(project: string, name: string, version: number): string {
  return `secret://${project}/${name}@${version}`;
}

/**
 * Project secrets (3.22): values are set through the API (never through YAML / Git, 3.29), envelope-encrypted,
 * delivered only to nodes running a workload that references them, and never returned to API callers.
 */
@Injectable()
export class SecretsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly masterKey: MasterKeyService,
    private readonly audit: AuditLogService,
    private readonly planner: WorkloadPlannerService,
    private readonly access: ProjectAccessService,
  ) {}

  private async assertReservedName(name: string, req?: RequestWithUser): Promise<void> {
    if (!name.startsWith('lw-')) return;
    const own = await this.access.caller(req);
    const identity = fleetIdentityOf(req);
    const caller = identity ? capRolesToFleetIdentity(own, identity) : own;
    if (caller.clusterRole !== 'cluster-admin')
      throw new ForbiddenException('platform-reserved secrets require a cluster admin');
  }

  private fingerprint(masterKey: Buffer, value: Buffer): string {
    const key = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'loadweaver secret fingerprint', 32));

    return createHmac('sha256', key).update(value).digest('hex').slice(0, 32);
  }

  async setValue(
    project: string,
    name: string,
    value: Buffer,
    actor: AuditActor,
    options: { internal?: boolean; req?: RequestWithUser } = {},
  ): Promise<SecretSummary> {
    if (!SECRET_NAME.test(name)) throw new BadRequestException('invalid secret name');

    // Only request-free system callers (volume-key creation) may use the internal platform path.
    if (!(options.internal && actor.type === 'system' && !options.req))
      await this.assertReservedName(name, options.req);

    if (value.length === 0 || value.length > MAX_SECRET_BYTES)
      throw new BadRequestException(`secret values must be 1 byte to ${MAX_SECRET_BYTES} bytes`);

    const key = await this.masterKey.current();

    return await this.dataSource.transaction(async (manager) => {
      if (
        !(await manager
          .getRepository(ResourceEntity)
          .exists({ where: { kind: 'Project', name: project, projectKey: '' } }))
      ) {
        throw new NotFoundException(`project ${project} does not exist`);
      }

      const repo = manager.getRepository(SecretEntity);
      // Serialise version numbers per secret.
      const latest = await repo
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.project = :project AND s.name = :name', { project, name })
        .orderBy('s.version', 'DESC')
        .getOne();
      const version = (latest?.version ?? 0) + 1;
      const envelope = envelopeEncrypt(key.value, value, aad(project, name, version));
      const saved = await repo.save(
        repo.create({
          project,
          name,
          version,
          keyId: key.id,
          wrappedKey: envelope.wrappedKey,
          ciphertext: envelope.ciphertext,
          fingerprint: this.fingerprint(key.value, value),
          createdBy: actor.id ?? actor.type,
        }),
      );

      await this.audit.record(manager, {
        actor,
        action: 'secret.set',
        target: `secret://${project}/${name}`,
        project,
        details: { version },
      });

      const first = latest
        ? await repo.findOne({
            select: { createdAt: true },
            where: { project, name },
            order: { version: 'ASC' },
          })
        : saved;
      const usages = options.internal ? new Map<string, SecretUsage[]>() : await this.usages(manager);
      const summary = this.summary(saved, first?.createdAt ?? saved.createdAt, usages);
      summary.updatedBy = actor.onBehalfOf ?? actor.id ?? actor.type;
      return summary;
    });
  }

  async list(project: string, includeReserved = false): Promise<SecretSummary[]> {
    return await this.summaries([project], '', undefined, includeReserved);
  }

  async listAll(
    caller: AccessCaller,
    query: { project?: string; q?: string; limit?: number } = {},
  ): Promise<SecretSummary[]> {
    const projects = (
      await this.dataSource.getRepository(ResourceEntity).find({
        select: { name: true },
        where: { kind: 'Project' },
      })
    )
      .map(({ name }) => name)
      .filter((name) => (!query.project || name === query.project) && atLeast(projectRole(caller, name), 'operator'));
    return await this.summaries(projects, query.q ?? '', query.limit ?? 200, caller.clusterRole === 'cluster-admin');
  }

  private summary(
    row: Pick<SecretEntity, 'project' | 'name' | 'version' | 'createdAt' | 'createdBy'>,
    createdAt: Date,
    usages: Map<string, SecretUsage[]>,
  ): SecretSummary {
    return {
      project: row.project,
      name: row.name,
      version: row.version,
      createdAt: createdAt.toISOString(),
      updatedAt: row.createdAt.toISOString(),
      updatedBy: row.createdBy,
      reserved: row.name.startsWith('lw-'),
      usedBy: usages.get(`secret://${row.project}/${row.name}`) ?? [],
    };
  }

  private async summaries(
    projects: string[],
    q: string,
    limit: number | undefined,
    includeReserved: boolean,
  ): Promise<SecretSummary[]> {
    if (!projects.length) return [];
    // Metadata allowlist: encrypted values, keys and fingerprints never leave the repository.
    const rows = await this.dataSource.getRepository(SecretEntity).find({
      select: { project: true, name: true, version: true, createdAt: true, createdBy: true },
      where: { project: In(projects) },
      order: { name: 'ASC', project: 'ASC', version: 'DESC' },
    });
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      if ((!includeReserved && row.name.startsWith('lw-')) || !row.name.toLowerCase().includes(q.toLowerCase()))
        continue;
      const key = `secret://${row.project}/${row.name}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const selected = [...groups.entries()].slice(0, limit);
    if (!selected.length) return [];
    const [usages, events] = await Promise.all([
      this.usages(this.dataSource.manager),
      this.dataSource.getRepository(AuditEventEntity).find({
        select: { target: true, actorId: true, actorType: true, details: true },
        where: { action: 'secret.set', target: In(selected.map(([key]) => key)) },
        order: { seq: 'DESC' },
      }),
    ]);
    return selected.map(([key, versions]) => {
      const result = this.summary(versions[0], versions[versions.length - 1].createdAt, usages);
      // Older fleet writes stored the credential as createdBy; the audit contains the person's actual label.
      const event = events.find((e) => e.target === key && e.details.version === result.version);
      if (event)
        result.updatedBy =
          typeof event.details.onBehalfOf === 'string' ? event.details.onBehalfOf : (event.actorId ?? event.actorType);
      return result;
    });
  }

  /** One bounded metadata-only query; never load encrypted values, wrapped keys or fingerprints. */
  async listNames(project: string, q = '', limit = 50, includeReserved = false): Promise<SecretNamesDto> {
    const query = this.dataSource
      .getRepository(SecretEntity)
      .createQueryBuilder('s')
      .select('s.name', 'name')
      .distinct(true)
      .where('s.project = :project', { project })
      // POSITION treats wildcard characters literally, unlike LIKE/ILIKE.
      .andWhere('POSITION(LOWER(:q) IN LOWER(s.name)) > 0', { q })
      .orderBy('s.name', 'ASC');
    if (!includeReserved) query.andWhere("LEFT(s.name, 3) <> 'lw-'");
    const rows = await query.limit(limit).getRawMany<{ name: string }>();

    // Explicit allowlist even if the repository returns additional columns. Deletion removes all stored versions.
    return { items: rows.map(({ name }) => ({ name })) };
  }

  async remove(
    project: string,
    name: string,
    actor: AuditActor,
    options: { req?: RequestWithUser } = {},
  ): Promise<void> {
    if (!SECRET_NAME.test(name)) throw new BadRequestException('invalid secret name');
    await this.assertReservedName(name, options.req);

    await this.dataSource.transaction(async (manager) => {
      const usedBy = (await this.usages(manager)).get(`secret://${project}/${name}`) ?? [];
      if (usedBy.length)
        throw new ConflictException({ message: 'secret is in use; remove the references first', usedBy });
      const result = await manager.getRepository(SecretEntity).delete({ project, name });

      if (!result.affected) throw new NotFoundException('secret not found');

      await this.audit.record(manager, {
        actor,
        action: 'secret.delete',
        target: `secret://${project}/${name}`,
        project,
        details: { versions: result.affected },
      });
    });
  }

  /** Live desired resources only, using the compose/model parsers and the plan's persisted pin keys. */
  private async usages(manager: EntityManager): Promise<Map<string, SecretUsage[]>> {
    const [resources, states, connections] = await Promise.all([
      manager.getRepository(ResourceEntity).find(),
      manager.getRepository(DeploymentStateEntity).find(),
      manager.getRepository(GitConnectionEntity).find({ select: { id: true, project: true, credentials: true } }),
    ]);
    const result = new Map<string, SecretUsage[]>();
    const pins = new Map(states.map((s) => [s.id, s.secretVersions]));
    const add = (ref: string, kind: string, project: string, name: string, pinnedVersion: number | null) => {
      const parsed = parseSecretRef(ref);
      if (!parsed) return;
      const key = `secret://${parsed.project}/${parsed.name}`;
      const existing = result.get(key) ?? [];
      if (
        !existing.some(
          (u) => u.kind === kind && u.project === project && u.name === name && u.pinnedVersion === pinnedVersion,
        )
      )
        result.set(key, [...existing, { kind, project, name, pinnedVersion }]);
    };
    for (const deployment of this.planner.parse(resources).parsed) {
      // VM synthetic deployments have their own per-VM pin keys and are handled below.
      if (
        deployment.name === VM_DEPLOYMENT_NAME &&
        !resources.some(
          (r) => r.kind === 'Deployment' && r.project === deployment.project && r.name === deployment.name,
        )
      )
        continue;
      const refs = [...deployment.compose.secrets, ...deployment.compose.configs].map((s) => s.ref);
      for (const service of deployment.compose.services) refs.push(...Object.values(service.environment));
      const applied = pins.get(`${deployment.project}/${deployment.name}`);
      for (const ref of refs)
        add(
          ref,
          'Deployment',
          deployment.project,
          deployment.name,
          applied ? (parseSecretRef(ref)?.version ?? applied[ref] ?? null) : null,
        );
    }
    const walk = (value: unknown, visit: (ref: string) => void): void => {
      if (typeof value === 'string') visit(value);
      else if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
      else if (value && typeof value === 'object') Object.values(value).forEach((v) => walk(v, visit));
    };
    for (const resource of resources) {
      if (resource.kind === 'Deployment') continue;
      if (resource.kind === 'VirtualMachine') {
        const spec = virtualMachineSpecSchema.parse(resource.spec);
        const refs = vmCloudInit(
          { name: resource.name, project: resource.project ?? '', uid: resource.id, labels: {}, running: false, spec },
          [],
          new Map(),
          [],
        ).secretRefs;
        const applied = pins.get(`${resource.project}/${VM_DEPLOYMENT_NAME}`);
        for (const ref of refs)
          add(
            ref,
            resource.kind,
            resource.project ?? '',
            resource.name,
            applied ? (parseSecretRef(ref)?.version ?? applied[vmSecretVersionKey(resource.name, ref)] ?? null) : null,
          );
      } else {
        const parsed = RESOURCE_KINDS[resource.kind as ResourceKind].spec.parse(resource.spec);
        walk(parsed, (ref) => add(ref, resource.kind, resource.project ?? '', resource.name, null));
      }
    }
    for (const connection of connections)
      if (connection.credentials)
        add(connection.credentials, 'GitConnection', connection.project ?? '', connection.id, null);
    for (const usages of result.values())
      usages.sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) ||
          a.project.localeCompare(b.project) ||
          a.name.localeCompare(b.name) ||
          (a.pinnedVersion ?? -1) - (b.pinnedVersion ?? -1),
      );
    return result;
  }

  /** Creates the LUKS key of a new volume (3.22: every volume is encrypted at rest). Idempotent. */
  async ensureVolumeKey(volumeId: string): Promise<void> {
    const ref = parseSecretRef(volumeKeyRef(volumeId));

    if (!ref) throw new Error('invalid volume id');

    if (await this.dataSource.getRepository(SecretEntity).exists({ where: { project: ref.project, name: ref.name } }))
      return;

    const key = randomBytes(64);

    try {
      await this.setValue(ref.project, ref.name, key, { type: 'system' }, { internal: true });
    } finally {
      key.fill(0);
    }
  }

  /** Latest versions for references, used to pin them at plan time. */
  async latestVersions(refs: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {};

    for (const ref of refs) {
      const parsed = parseSecretRef(ref);

      if (!parsed) continue;

      if (parsed.version) {
        result[ref] = parsed.version;
        continue;
      }

      const latest = await this.dataSource
        .getRepository(SecretEntity)
        .findOne({ where: { project: parsed.project, name: parsed.name }, order: { version: 'DESC' } });

      if (latest) result[ref] = latest.version;
    }

    return result;
  }

  /**
   * Returns a secret value to a node agent, only if a workload placed on that node references the secret (3.22).
   */
  async valueForNode(node: string, workloadId: string, ref: string): Promise<{ version: number; value: Buffer }> {
    if (workloadId.startsWith('volume:'))
      return await this.volumeKeyForNode(node, workloadId.slice('volume:'.length), ref);

    const parsed = parseSecretRef(ref);
    const placement = await this.dataSource
      .getRepository(WorkloadPlacementEntity)
      .findOne({ where: { id: workloadId } });

    if (!parsed || !placement || placement.node !== node)
      throw new ForbiddenException('workload is not placed on this node');

    if (parsed.project !== placement.project) throw new ForbiddenException('the secret belongs to another project');

    const desired = await this.dataSource.getRepository(NodeDesiredStateEntity).findOne({ where: { nodeName: node } });
    const workload = (desired?.state.workloads as WorkloadSpec[] | undefined)?.find(
      (spec) => spec.id === workloadId && spec.project === placement.project,
    );
    // Exact refs preserve plan-time pins; the node cannot substitute another version or a platform secret.
    const cloudInitReferenced = workload?.vm?.cloudInit?.secretRefs.includes(ref) ?? false;

    if (cloudInitReferenced && parsed.name.startsWith('lw-'))
      throw new ForbiddenException('VM cloud-init cannot reference platform-reserved secrets');

    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: [{ kind: 'Project' }, { kind: 'Deployment', project: placement.project }] });
    const deployment = this.planner
      .parse(resources)
      .parsed.find((d) => d.project === placement.project && d.name === placement.deployment);
    const service = deployment?.compose.services.find((s) => s.name === placement.service);
    const base = `secret://${parsed.project}/${parsed.name}`;
    const definitions = [...(deployment?.compose.secrets ?? []), ...(deployment?.compose.configs ?? [])];
    const referenced =
      !!service &&
      [...service.secrets, ...service.configs].some((mount) =>
        definitions.some((d) => d.name === mount.source && d.ref.split('@')[0] === base),
      );

    if (!referenced && !cloudInitReferenced)
      throw new ForbiddenException('the workload does not reference this secret');

    const state = await this.dataSource
      .getRepository(DeploymentStateEntity)
      .findOne({ where: { id: `${placement.project}/${placement.deployment}` } });
    const version = parsed.version ?? state?.secretVersions[base];
    const row = await this.dataSource.getRepository(SecretEntity).findOne({
      where: { project: parsed.project, name: parsed.name, ...(version !== undefined ? { version } : {}) },
      order: { version: 'DESC' },
    });

    if (!row) throw new NotFoundException('secret not found');

    const key = await this.masterKey.current();

    if (row.keyId !== key.id) throw new ForbiddenException('secret is wrapped with a retired master key');

    return {
      version: row.version,
      value: envelopeDecrypt(
        key.value,
        { wrappedKey: row.wrappedKey, ciphertext: row.ciphertext },
        aad(row.project, row.name, row.version),
      ),
    };
  }

  /** Volume keys go only to nodes holding a replica of that volume. */
  private async volumeKeyForNode(
    node: string,
    volumeId: string,
    ref: string,
  ): Promise<{ version: number; value: Buffer }> {
    const placement = await this.dataSource.getRepository(VolumePlacementEntity).findOne({ where: { id: volumeId } });

    if (
      !placement ||
      ![placement.primaryNode, ...placement.syncReplicas, ...placement.remoteReplicas].includes(node) ||
      ref !== volumeKeyRef(volumeId)
    ) {
      throw new ForbiddenException('node holds no replica of this volume');
    }

    const parsed = parseSecretRef(ref);
    const row = parsed
      ? await this.dataSource
          .getRepository(SecretEntity)
          .findOne({ where: { project: parsed.project, name: parsed.name }, order: { version: 'ASC' } })
      : null;

    if (!row) throw new NotFoundException('volume key not found');

    const key = await this.masterKey.current();

    // The first version is the LUKS key the volume was formatted with; it never rotates in place.
    return {
      version: row.version,
      value: envelopeDecrypt(
        key.value,
        { wrappedKey: row.wrappedKey, ciphertext: row.ciphertext },
        aad(row.project, row.name, row.version),
      ),
    };
  }
}
