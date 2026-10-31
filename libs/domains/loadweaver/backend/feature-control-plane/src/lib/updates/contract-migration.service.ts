import { imageComponents, type ReleaseManifest } from '@forepath/loadweaver/shared/util-release';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not, type MigrationInterface } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';
import { ReleaseEntity } from './release.entity';
import { runsDigest } from './rollout-gates.utils';
import { RolloutEntity } from './rollout.entity';

/**
 * Where contract migrations live (3.26 expand / contract): next to the expand migrations, in `contract/`, which the
 * startup glob (`src/migrations/*`) doesn't include. Development: the TypeScript sources; containers: the compiled
 * files (`compile-migrations` keeps the subdirectory).
 */
export const CONTRACT_MIGRATIONS_GLOB = [
  'src/migrations/contract/*.js',
  'apps/loadweaver/backend-control-plane/src/migrations/contract/*.ts',
];
/** Contract migrations have their own history table, so the startup run never sees them as pending. */
export const CONTRACT_MIGRATIONS_TABLE = 'lw_contract_migrations';

export interface ContractReadiness {
  ready: boolean;
  version: string | null;
  /** Why not (components still on an older version). */
  blockers: string[];
}

/**
 * Whether every component runs `version`: every node reports the release and the release's agent version, every
 * control-plane member runs the release's control-plane image. Only then may contract migrations drop what N-1 used.
 */
export function contractReadiness(
  version: string | null,
  manifest: ReleaseManifest | null,
  nodes: readonly Pick<NodeEntity, 'name' | 'controlPlane' | 'agentVersion' | 'componentVersions'>[],
): ContractReadiness {
  if (!version || !manifest) return { ready: false, version, blockers: ['no completed release update'] };

  const blockers: string[] = [];
  const agent = (manifest.components['node-agent'] as { version?: string } | undefined)?.version;
  const controlPlane = imageComponents(manifest)['control-plane'];

  for (const node of nodes) {
    if (node.componentVersions?.release !== version)
      blockers.push(`${node.name} runs ${node.componentVersions?.release ?? 'an older release'}`);
    else if (agent && node.agentVersion !== agent)
      blockers.push(`${node.name} runs agent ${node.agentVersion ?? 'unknown'}`);

    const image = node.componentVersions?.images?.['control-plane'];

    if (node.controlPlane && controlPlane && !runsDigest(image, controlPlane.digest))
      blockers.push(`${node.name} runs control plane ${image ?? 'unknown'}`);
  }

  return { ready: blockers.length === 0, version, blockers };
}

/**
 * Runs contract migrations (`src/migrations/contract/`) only once every component reports the new version; startup
 * runs expand migrations only. Contract migrations are the place for dropping columns / tables N-1 still used.
 */
@Injectable()
export class ContractMigrationService {
  private readonly logger = new Logger(ContractMigrationService.name);
  /** Overridable for tests: the migrations to run (otherwise the glob). */
  migrations: (string | (new () => MigrationInterface))[] = CONTRACT_MIGRATIONS_GLOB;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async readiness(): Promise<ContractReadiness> {
    const done = await this.dataSource
      .getRepository(RolloutEntity)
      .findOne({ where: { status: 'completed' }, order: { finishedAt: 'DESC' } });
    const release = done
      ? await this.dataSource.getRepository(ReleaseEntity).findOne({ where: { version: done.toVersion } })
      : null;
    const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });

    return contractReadiness(done?.toVersion ?? null, (release?.manifest as unknown as ReleaseManifest) ?? null, nodes);
  }

  /** Runs pending contract migrations if every component is on the new version; returns their names. */
  async runIfReady(): Promise<string[]> {
    const readiness = await this.readiness();

    if (!readiness.ready) {
      this.logger.log(`Contract migrations wait: ${readiness.blockers.slice(0, 5).join('; ')}`);

      return [];
    }

    const contract = new DataSource({
      ...(this.dataSource.options as object),
      migrations: this.migrations,
      migrationsTableName: CONTRACT_MIGRATIONS_TABLE,
      entities: [],
      synchronize: false,
      migrationsRun: false,
    } as never);

    await contract.initialize();

    try {
      const ran = await contract.runMigrations({ transaction: 'each' });

      if (ran.length)
        this.logger.log(`Contract migrations for ${readiness.version}: ${ran.map((m) => m.name).join(', ')}`);

      return ran.map((m) => m.name);
    } finally {
      await contract.destroy();
    }
  }
}
