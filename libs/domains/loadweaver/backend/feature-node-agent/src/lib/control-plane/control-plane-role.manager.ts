import { chown, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';
import { ManagedContainers } from '../host/managed-containers';
import { LOG_STORE_CONTAINER, logStoreSpec, MIN_MAX_MAP_COUNT, openSearchImage, OPENSEARCH_UID } from './log-store';
import { AgentStateStore } from '../state/agent-state.store';
import { localSecret } from '../host/local-secret';
import {
  CONTAINER_NAMES,
  controlPlaneApiSpec,
  controlPlaneImages,
  etcdClientUrl,
  etcdPeerUrl,
  etcdSpec,
  LOCAL_ETCD_HOSTS,
  postgresSpec,
  queueSpec,
  type ContainerSpec,
  type ControlPlaneComponent,
  type MemberContext,
} from './control-plane-containers';
import { addMember, initialClusterFrom, listMembers, removeMember, updateMemberPeerUrl } from './etcd-client';
import { PostgresLeaderProxy } from './postgres-leader-proxy';
import { POSTGRES_CLONE_CONTAINER, postgresCloneSpec } from './platform-backups';
import { applyPostgresCutover, SPILO_GID, SPILO_UID } from './postgres-cutover';
import { ensurePostgresTls } from './postgres-tls';

/** Marks which restore a clone data directory belongs to (a new restore starts from an empty directory). */
const CLONE_MARKER = '.loadweaver-clone';

/** Which components run for a role (3.2): witnesses only vote in etcd. */
export function componentsFor(role: ControlPlaneRole['role']): ControlPlaneComponent[] {
  switch (role) {
    case 'member':
      return ['etcd', 'postgres', 'queue', 'controlPlane'];
    case 'witness':
      return ['etcd'];
    default:
      return [];
  }
}

async function isEmptyDir(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0;
  } catch {
    return true;
  }
}

/**
 * Runs the control-plane components this node is responsible for (3.2): etcd on members and the witness,
 * Patroni / Postgres and the API on members. Grows and shrinks etcd membership as nodes join and leave.
 */
@Injectable()
export class ControlPlaneRoleManager {
  private readonly logger = new Logger(ControlPlaneRoleManager.name);

  constructor(
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
    private readonly leaderProxy: PostgresLeaderProxy,
    private readonly commands: CommandRunner,
  ) {}

  async apply(nodeName: string, address: string, role: ControlPlaneRole): Promise<boolean> {
    const wanted = new Set(componentsFor(role.role));
    let changed = false;

    for (const component of Object.keys(CONTAINER_NAMES) as ControlPlaneComponent[]) {
      if (!wanted.has(component)) changed = (await this.removeContainer(CONTAINER_NAMES[component])) || changed;
    }

    if (!wanted.has('postgres') || !role.logStore)
      changed = (await this.removeContainer(LOG_STORE_CONTAINER)) || changed;

    if (!wanted.has('postgres')) changed = (await this.removePostgresClone()) || changed;

    if (wanted.size === 0) {
      this.leaderProxy.stop(true);

      return changed;
    }

    const ctx: MemberContext = { nodeName, address, stateDir: this.state.dir, images: controlPlaneImages() };

    changed = (await this.applyEtcd(ctx, role)) || changed;

    if (wanted.has('postgres')) {
      await mkdir(join(ctx.stateDir, 'postgres'), { recursive: true, mode: 0o700 });
      // Spilo runs Postgres as its `postgres` user: the mounted data directory must be theirs (initdb fails otherwise).
      await this.ownBySpilo(join(ctx.stateDir, 'postgres'));
      const tls = await ensurePostgresTls(ctx.stateDir, role.postgresTls);

      if (tls.replaced) this.logger.log('Postgres server certificate from the cluster CA installed');

      ctx.postgresTls = tls.tls;
      // The scope the member's data belongs to; a cut-over to a point-in-time clone switches it (3.20).
      ctx.postgresScope = await applyPostgresCutover(
        ctx.stateDir,
        nodeName,
        role,
        {
          postgres: CONTAINER_NAMES.postgres,
          clone: POSTGRES_CLONE_CONTAINER,
          remove: async (name) => await this.removeContainer(name),
        },
        (line) => this.logger.warn(line),
      );
      changed = (await this.ensureContainer(postgresSpec(ctx, role))) || changed;
      await this.leaderProxy.ensure(role.members.filter((m) => !m.witness).map((m) => m.address));
      changed = (await this.applyPostgresClone(ctx, role)) || changed;

      await mkdir(join(ctx.stateDir, 'queue'), { recursive: true, mode: 0o700 });
      ctx.queuePassword = await localSecret(ctx.stateDir, 'queue');
      changed = (await this.ensureContainer(queueSpec(ctx))) || changed;

      // Logs before the API that writes them (3.14).
      if (role.logStore) changed = (await this.applyLogStore(ctx, role)) || changed;

      changed = (await this.ensureContainer(controlPlaneApiSpec(ctx, role))) || changed;
    }

    await this.pruneEtcdMembers(nodeName, role).catch((error: unknown) =>
      this.logger.warn(`etcd member cleanup deferred: ${error instanceof Error ? error.message : String(error)}`),
    );

    return changed;
  }

  /**
   * Point-in-time restore of the control-plane database into a new scope, side by side (3.20): runs while the
   * control plane asks for it on this member; a different restore starts from an empty data directory, and the
   * directory goes away with the clone.
   */
  private async applyPostgresClone(ctx: MemberContext, role: ControlPlaneRole): Promise<boolean> {
    const dir = join(ctx.stateDir, 'postgres-pitr');
    const spec = postgresCloneSpec(ctx, role, dir, LOCAL_ETCD_HOSTS);
    const clone = role.platformBackups?.postgresClone;

    // A clone being adopted by a cut-over is the member's database now (or is about to become it): never touched here.
    if (clone && role.platformBackups?.postgresCutover?.id === clone.id) return false;

    if (!spec || !clone) return await this.removePostgresClone();

    const marker = (await readFile(join(dir, CLONE_MARKER), 'utf8').catch(() => '')).trim();

    if (marker !== clone.id) {
      await this.removeContainer(POSTGRES_CLONE_CONTAINER);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await this.ownBySpilo(dir);
      await writeFile(join(dir, CLONE_MARKER), `${clone.id}\n`, { mode: 0o600 });
      this.logger.log(`Starting point-in-time clone ${clone.id} into scope ${clone.scope}`);
    }

    return await this.ensureContainer(spec);
  }

  /** Spilo's `postgres` user owns its data directory (the agent runs as root; tests don't). */
  private async ownBySpilo(dir: string): Promise<void> {
    await chown(dir, SPILO_UID, SPILO_GID).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPERM' || process.getuid?.() === 0) throw error;
    });
  }

  private async removePostgresClone(): Promise<boolean> {
    const removed = await this.removeContainer(POSTGRES_CLONE_CONTAINER);

    await rm(join(this.state.dir, 'postgres-pitr'), { recursive: true, force: true });

    return removed;
  }

  private async applyLogStore(ctx: MemberContext, role: ControlPlaneRole): Promise<boolean> {
    const dataDir = join(ctx.stateDir, 'opensearch');

    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chown(dataDir, OPENSEARCH_UID, OPENSEARCH_UID);

    // A cluster bound to the overlay enforces the bootstrap checks; one of them is this kernel setting.
    if (role.members.filter((m) => !m.witness).length > 1) {
      const current = Number((await readFile('/proc/sys/vm/max_map_count', 'utf8').catch(() => '0')).trim());

      if (current < MIN_MAX_MAP_COUNT) {
        await this.commands.run('sysctl', ['-w', `vm.max_map_count=${MIN_MAX_MAP_COUNT}`]);
        // Also after a reboot, before the container starts again.
        await writeFile(
          '/etc/sysctl.d/90-loadweaver-log-store.conf',
          `vm.max_map_count = ${MIN_MAX_MAP_COUNT}\n`,
        ).catch((error: unknown) => this.logger.warn(`vm.max_map_count not persisted: ${String(error)}`));
      }
    }

    return await this.containers.ensure(logStoreSpec(ctx.nodeName, ctx.address, role, dataDir, openSearchImage()));
  }

  private async applyEtcd(ctx: MemberContext, role: ControlPlaneRole): Promise<boolean> {
    const dataDir = join(ctx.stateDir, 'etcd');
    const peerUrl = etcdPeerUrl(ctx.address);

    await mkdir(dataDir, { recursive: true, mode: 0o700 });

    if (await isEmptyDir(dataDir)) {
      const others = role.members.filter((m) => m.name !== ctx.nodeName);

      if (others.length === 0) {
        return await this.ensureContainer(etcdSpec(ctx, role, 'new', `${ctx.nodeName}=${peerUrl}`));
      }

      // Join the existing cluster through any reachable member.
      for (const member of others) {
        try {
          const members = await addMember(etcdClientUrl(member.address), peerUrl);

          return await this.ensureContainer(
            etcdSpec(ctx, role, 'existing', initialClusterFrom(members, { name: ctx.nodeName, peerUrl })),
          );
        } catch {
          // try the next member
        }
      }

      throw new Error('no etcd member reachable to join the control plane');
    }

    // Existing member: keep the advertised peer URL in sync (e.g. loopback → overlay after bootstrap).
    const members = await listMembers(etcdClientUrl('127.0.0.1')).catch(() => []);
    const self = members.find((m) => m.name === ctx.nodeName);

    if (self && self.peerURLs?.[0] !== peerUrl) {
      await updateMemberPeerUrl(etcdClientUrl('127.0.0.1'), self.ID, peerUrl);
    }

    return await this.ensureContainer(
      etcdSpec(ctx, role, 'existing', initialClusterFrom(members, { name: ctx.nodeName, peerUrl })),
    );
  }

  /** The lowest-named member removes etcd members that are no longer voters, one at a time. */
  private async pruneEtcdMembers(nodeName: string, role: ControlPlaneRole): Promise<void> {
    const voters = role.members.map((m) => m.name).sort();

    if (voters[0] !== nodeName) return;

    const members = await listMembers(etcdClientUrl('127.0.0.1'));
    const stale = members.find((m) => m.name && !voters.includes(m.name));

    if (stale) {
      this.logger.log(`Removing etcd member ${stale.name}`);
      await removeMember(etcdClientUrl('127.0.0.1'), stale.ID);
    }
  }

  private async ensureContainer(spec: ContainerSpec): Promise<boolean> {
    return await this.containers.ensure(spec);
  }

  private async removeContainer(name: string): Promise<boolean> {
    return await this.containers.remove(name);
  }
}
