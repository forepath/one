import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

import { ManagedContainers } from '../host/managed-containers';
import { AgentStateStore } from '../state/agent-state.store';
import {
  CONTAINER_NAMES,
  controlPlaneApiSpec,
  controlPlaneImages,
  etcdClientUrl,
  etcdPeerUrl,
  etcdSpec,
  postgresSpec,
  type ContainerSpec,
  type ControlPlaneComponent,
  type MemberContext,
} from './control-plane-containers';
import { addMember, initialClusterFrom, listMembers, removeMember, updateMemberPeerUrl } from './etcd-client';
import { PostgresLeaderProxy } from './postgres-leader-proxy';

/** Which components run for a role (3.2): witnesses only vote in etcd. */
export function componentsFor(role: ControlPlaneRole['role']): ControlPlaneComponent[] {
  switch (role) {
    case 'member':
      return ['etcd', 'postgres', 'controlPlane'];
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
  ) {}

  async apply(nodeName: string, address: string, role: ControlPlaneRole): Promise<boolean> {
    const wanted = new Set(componentsFor(role.role));
    let changed = false;

    for (const component of Object.keys(CONTAINER_NAMES) as ControlPlaneComponent[]) {
      if (!wanted.has(component)) changed = (await this.removeContainer(CONTAINER_NAMES[component])) || changed;
    }

    if (wanted.size === 0) {
      this.leaderProxy.stop();

      return changed;
    }

    const ctx: MemberContext = { nodeName, address, stateDir: this.state.dir, images: controlPlaneImages() };

    changed = (await this.applyEtcd(ctx, role)) || changed;

    if (wanted.has('postgres')) {
      await mkdir(join(ctx.stateDir, 'postgres'), { recursive: true, mode: 0o700 });
      changed = (await this.ensureContainer(postgresSpec(ctx, role))) || changed;
      await this.leaderProxy.ensure(role.members.filter((m) => !m.witness).map((m) => m.address));
      changed = (await this.ensureContainer(controlPlaneApiSpec(ctx, role))) || changed;
    }

    await this.pruneEtcdMembers(nodeName, role).catch((error: unknown) =>
      this.logger.warn(`etcd member cleanup deferred: ${error instanceof Error ? error.message : String(error)}`),
    );

    return changed;
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
