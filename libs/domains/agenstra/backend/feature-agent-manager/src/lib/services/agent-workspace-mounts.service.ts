import { posix } from 'node:path';

import {
  AGENSTRA_WORKSPACE_MOUNT_ROOT,
  type AgentContextEnvironmentSummary,
  type AgentContextListResponse,
  type AgentContextMountSummary,
  type AgentContextMountsResponse,
  type AgentHandoffAgentSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AGENT_VOLUME_HOST_ROOT } from '../constants/agent-context.constants';
import type { AgentEntity } from '../entities/agent.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentsRepository } from '../repositories/agents.repository';
import type { AgentContextTicketRecord } from '../types/agent-context.types';

import { AgentHandoffsApiService } from './agent-handoffs-api.service';

const DEFAULT_WORKING_DIRECTORY = '/app';
const MOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PEERS_UNAVAILABLE_NOTE =
  'Other environments of the workspace cannot be resolved right now (no controller connection); only your own ' +
  'environment is listed.';
const FOREIGN_DIRECTORIES_NOTE =
  `Directories below ${AGENSTRA_WORKSPACE_MOUNT_ROOT} that are not listed do not belong to environments of your ` +
  'workspace.';

/** Mount id of an agent's working directory (`/opt/agents/<mount id>` on the host), if it has a plain one. */
export function workspaceMountIdOf(volumePath: string | null | undefined): string | undefined {
  const prefix = `${AGENT_VOLUME_HOST_ROOT}/`;

  if (typeof volumePath !== 'string' || !volumePath.startsWith(prefix)) {
    return undefined;
  }

  const mountId = volumePath.slice(prefix.length);

  return MOUNT_ID_PATTERN.test(mountId) ? mountId : undefined;
}

/** `relative` below `base` (`""` for `base` itself), or undefined when `path` is not inside `base`. */
function relativeBelow(base: string, path: string): string | undefined {
  if (path === base) {
    return '';
  }

  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : undefined;
}

function joinMounted(mountPath: string | undefined, relativePath: string): string | undefined {
  if (!mountPath) {
    return undefined;
  }

  return relativePath ? `${mountPath}/${relativePath}` : mountPath;
}

/**
 * Maps the read-only `/opt/workspace` mount of a worker to the environments of the agent's workspace.
 *
 * Every worker sees the working directories of all agents on this host below `/opt/workspace/<mount id>` (mount ids
 * are not environment ids). Metadata is only revealed for environments the controller reports as members of the
 * calling agent's workspace (the handoff agent list); other directories stay anonymous.
 */
@Injectable()
export class AgentWorkspaceMountsService {
  private readonly logger = new Logger(AgentWorkspaceMountsService.name);

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly handoffs: AgentHandoffsApiService,
    private readonly providerFactory: AgentProviderFactory,
  ) {}

  /** Environments of the workspace with their mounts; optionally narrowed to the one `resolve` names. */
  async mounts(record: AgentContextTicketRecord, resolve?: string): Promise<AgentContextMountsResponse> {
    const { mounts, complete } = await this.workspaceMounts(record.agentId);
    const selected = new Set(record.environments.map((environment) => environment.id.toLowerCase()));
    const marked = mounts.map((mount) =>
      selected.has(mount.environmentId.toLowerCase()) ? { ...mount, selected: true } : mount,
    );
    const base = { root: AGENSTRA_WORKSPACE_MOUNT_ROOT, readOnly: true as const };

    if (!resolve) {
      return {
        ...base,
        mounts: marked,
        note: complete ? FOREIGN_DIRECTORIES_NOTE : PEERS_UNAVAILABLE_NOTE,
      };
    }

    const match = this.resolve(marked, resolve);

    if (!match) {
      return {
        ...base,
        mounts: [],
        note:
          `"${resolve}" matches no environment of your workspace (by environment id, mount id, name or path).` +
          (complete ? '' : ` ${PEERS_UNAVAILABLE_NOTE}`),
      };
    }

    const { mount, relativePath } = match;
    const mountedPath = relativePath !== undefined ? joinMounted(mount.mountPath, relativePath) : undefined;

    return {
      ...base,
      mounts: [mount],
      resolved: {
        input: resolve,
        environmentId: mount.environmentId,
        ...(relativePath !== undefined ? { relativePath } : {}),
        ...(mountedPath ? { mountedPath } : {}),
      },
      ...(mount.mountPath ? {} : { note: 'This environment has no working directory on this host.' }),
    };
  }

  /**
   * `context_list` answer with name and mount path of the selected environments that belong to the workspace.
   * Best effort: without a controller connection the environments stay plain ids.
   */
  async withEnvironmentMounts(
    record: AgentContextTicketRecord,
    response: AgentContextListResponse,
  ): Promise<AgentContextListResponse> {
    if (response.environments.length === 0) {
      return response;
    }

    try {
      const { mounts } = await this.workspaceMounts(record.agentId);
      const byId = new Map(mounts.map((mount) => [mount.environmentId.toLowerCase(), mount]));
      const environments = response.environments.map((environment): AgentContextEnvironmentSummary => {
        const mount = byId.get(environment.id.toLowerCase());

        if (!mount) {
          return environment;
        }

        return {
          id: environment.id,
          name: mount.name,
          ...(mount.mountPath ? { mountPath: mount.mountPath } : {}),
        };
      });

      return { ...response, environments };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.debug(`Environment mounts for agent ${record.agentId} unavailable: ${message}`);

      return response;
    }
  }

  /** Own environment first, then the workspace peers the controller reports (others are never revealed). */
  private async workspaceMounts(agentId: string): Promise<{ mounts: AgentContextMountSummary[]; complete: boolean }> {
    const self = await this.agentsRepository.findById(agentId);

    if (!self) {
      throw new NotFoundException('Agent not found');
    }

    let peers: AgentHandoffAgentSummary[] = [];
    let complete = true;

    try {
      peers = (await this.handoffs.peers(agentId)).filter((peer) => peer.id !== self.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.debug(`Workspace peers of agent ${agentId} unavailable: ${message}`);
      complete = false;
    }

    const entities = new Map(
      (await this.agentsRepository.findByIds(peers.map((peer) => peer.id))).map((entity) => [entity.id, entity]),
    );

    return {
      mounts: [this.selfMount(self), ...peers.map((peer) => this.peerMount(peer, entities.get(peer.id)))],
      complete,
    };
  }

  private selfMount(self: AgentEntity): AgentContextMountSummary {
    return {
      ...this.mountFields(self.id, self.name, self.volumePath),
      ...(self.description ? { description: self.description } : {}),
      ...(self.gitRepositoryUrl ? { repositoryUrl: self.gitRepositoryUrl } : {}),
      self: true,
      workingDirectory: this.workingDirectoryOf(self),
    };
  }

  /** Metadata comes from the controller (workspace view); only the mount location is read locally. */
  private peerMount(peer: AgentHandoffAgentSummary, entity: AgentEntity | undefined): AgentContextMountSummary {
    return {
      ...this.mountFields(peer.id, peer.name, entity?.volumePath),
      ...(peer.description ? { description: peer.description } : {}),
      ...(peer.repositoryUrl ? { repositoryUrl: peer.repositoryUrl } : {}),
    };
  }

  private mountFields(
    environmentId: string,
    name: string,
    volumePath: string | null | undefined,
  ): Pick<AgentContextMountSummary, 'environmentId' | 'name' | 'mountId' | 'mountPath'> {
    const mountId = workspaceMountIdOf(volumePath);

    return {
      environmentId,
      name,
      ...(mountId ? { mountId, mountPath: `${AGENSTRA_WORKSPACE_MOUNT_ROOT}/${mountId}` } : {}),
    };
  }

  private workingDirectoryOf(agent: AgentEntity): string {
    try {
      return (
        this.providerFactory.getProvider(agent.agentType || 'opencode').getBasePath?.() || DEFAULT_WORKING_DIRECTORY
      );
    } catch {
      return DEFAULT_WORKING_DIRECTORY;
    }
  }

  /**
   * Match by environment id, mount id, a path below a mount (or the own working directory), or a unique name.
   * Purely a lookup in the workspace list: nothing on the file system is touched.
   */
  private resolve(
    mounts: AgentContextMountSummary[],
    input: string,
  ): { mount: AgentContextMountSummary; relativePath?: string } | undefined {
    const lowered = input.toLowerCase();
    const byKey = mounts.find(
      (mount) => mount.environmentId.toLowerCase() === lowered || mount.mountId?.toLowerCase() === lowered,
    );

    if (byKey) {
      return { mount: byKey };
    }

    if (input.startsWith('/')) {
      const path = posix.normalize(input).replace(/\/+$/, '') || '/';

      for (const mount of mounts) {
        const roots = [mount.mountPath, mount.workingDirectory].filter((root): root is string => !!root);

        for (const root of roots) {
          const relativePath = relativeBelow(root, path);

          if (relativePath !== undefined) {
            return { mount, relativePath };
          }
        }
      }

      return undefined;
    }

    const named = mounts.filter((mount) => mount.name.trim().toLowerCase() === lowered);

    return named.length === 1 ? { mount: named[0] } : undefined;
  }
}
