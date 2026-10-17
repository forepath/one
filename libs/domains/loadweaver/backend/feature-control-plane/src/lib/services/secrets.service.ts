import { createHmac, hkdfSync, randomBytes } from 'node:crypto';

import { volumeKeyRef } from '@forepath/loadweaver/shared/util-agent-protocol';

import { envelopeDecrypt, envelopeEncrypt } from '@forepath/loadweaver/shared/util-secrets';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { SecretEntity } from '../entities/secret.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { AuditLogService, type AuditActor } from './audit-log.service';
import { MasterKeyService } from './master-key.service';
import { WorkloadPlannerService } from './workload-planner.service';

export const MAX_SECRET_BYTES = 1024 * 1024;
const SECRET_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const REF = /^secret:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)\/([a-z0-9][a-z0-9._-]{0,127})(?:@(\d+))?$/;

export interface SecretVersionDto {
  version: number;
  fingerprint: string;
  createdBy: string | null;
  createdAt: string;
}

export interface SecretDto {
  project: string;
  name: string;
  versions: SecretVersionDto[];
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
  ) {}

  private fingerprint(masterKey: Buffer, value: Buffer): string {
    const key = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'loadweaver secret fingerprint', 32));

    return createHmac('sha256', key).update(value).digest('hex').slice(0, 32);
  }

  async setValue(
    project: string,
    name: string,
    value: Buffer,
    actor: AuditActor,
    options: { internal?: boolean } = {},
  ): Promise<SecretVersionDto> {
    if (!SECRET_NAME.test(name)) throw new BadRequestException('invalid secret name');

    if (name.startsWith('lw-') && !options.internal)
      throw new BadRequestException('secret names starting with lw- are reserved for the platform');

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
        details: { version, fingerprint: saved.fingerprint },
      });

      return {
        version,
        fingerprint: saved.fingerprint,
        createdBy: saved.createdBy,
        createdAt: saved.createdAt.toISOString(),
      };
    });
  }

  async list(project: string): Promise<SecretDto[]> {
    const rows = await this.dataSource
      .getRepository(SecretEntity)
      .find({ where: { project }, order: { name: 'ASC', version: 'DESC' } });
    const byName = new Map<string, SecretVersionDto[]>();

    for (const row of rows) {
      byName.set(row.name, [
        ...(byName.get(row.name) ?? []),
        {
          version: row.version,
          fingerprint: row.fingerprint,
          createdBy: row.createdBy,
          createdAt: row.createdAt.toISOString(),
        },
      ]);
    }

    return [...byName.entries()].map(([name, versions]) => ({ project, name, versions }));
  }

  async remove(project: string, name: string, actor: AuditActor): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
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

    if (!referenced) throw new ForbiddenException('the workload does not reference this secret');

    const state = await this.dataSource
      .getRepository(DeploymentStateEntity)
      .findOne({ where: { id: `${placement.project}/${placement.deployment}` } });
    const version = parsed.version ?? state?.secretVersions[base];
    const row = await this.dataSource.getRepository(SecretEntity).findOne({
      where: { project: parsed.project, name: parsed.name, ...(version ? { version } : {}) },
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
