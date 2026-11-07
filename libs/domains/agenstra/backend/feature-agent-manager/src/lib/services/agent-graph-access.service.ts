import { posix } from 'node:path';

import {
  AGENSTRA_WORKSPACE_MOUNT_ROOT,
  type AgentGraphEnvironmentSummary,
  type AgentGraphEnvironmentsResponse,
  type AgentHandoffAgentSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AgentEntity } from '../entities/agent.entity';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentGraphCollectorService } from './agent-graph-collector.service';
import type { AgentGraphPathBase } from './agent-graph.service';
import { AgentGraphService } from './agent-graph.service';
import { AgentHandoffsApiService } from './agent-handoffs-api.service';
import { workspaceMountIdOf } from './agent-workspace-mounts.service';
import { DockerService } from './docker.service';

/** A graph an agent may read, and how its paths look from the agent's container. */
export interface AgentGraphAccessTarget {
  environmentId: string;
  self: boolean;
  workspacePeer: boolean;
  /** `/opt/workspace/<mountId>` of another environment: its only name for callers outside its workspace. */
  mountId?: string;
  /** Internal only (never returned): lets redaction recognise labels derived from the environment name. */
  environmentName?: string;
  /** Prompt reference graphs: own environment and controller-verified workspace peers only. */
  referencesReadable: boolean;
  base: AgentGraphPathBase;
  /** Path relative to the target's working directory when the lookup was a path. */
  relativePath?: string;
}

const MOUNT_CHECK_CACHE_TTL_MS = 60_000;
const PEERS_CACHE_TTL_MS = 30_000;
const MAX_LOOKUP_LENGTH = 1024;

/**
 * Decides which environment graphs a calling agent (platform MCP server) may read.
 *
 * - Its own environment: everything.
 * - Every other environment whose working directory is visible in the caller's read-only `/opt/workspace` mount
 *   (same manager host): the file-derived layers (`code`, `paths`) — they only describe files the agent can already
 *   read. Environments that are not members of the caller's workspace stay anonymous (mount id only).
 * - Prompt reference graphs (`references`) of other environments: only controller-verified workspace peers, with
 *   prompt excerpts removed.
 */
@Injectable()
export class AgentGraphAccessService {
  private readonly logger = new Logger(AgentGraphAccessService.name);
  private readonly mountChecks = new Map<string, { value: boolean; expiresAt: number }>();
  private readonly peerCache = new Map<
    string,
    { peers: AgentHandoffAgentSummary[]; complete: boolean; expiresAt: number }
  >();

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
    private readonly handoffs: AgentHandoffsApiService,
    private readonly graphs: AgentGraphService,
    private readonly collector: AgentGraphCollectorService,
  ) {}

  async environments(callerId: string): Promise<AgentGraphEnvironmentsResponse> {
    const { self, others, peers, complete, mounted } = await this.reachable(callerId);
    const statuses = await this.graphs.statuses([self.id, ...others.map((agent) => agent.id)]);
    const summary = (agent: AgentEntity, isSelf: boolean): AgentGraphEnvironmentSummary => {
      const peer = peers.get(agent.id);
      const status = statuses.get(agent.id);
      const mountId = workspaceMountIdOf(agent.volumePath);

      return {
        environmentId: agent.id,
        ...(isSelf ? { name: agent.name, self: true } : peer ? { name: peer.name, workspacePeer: true } : {}),
        ...(mountId ? { mountId, mountPath: posix.join(AGENSTRA_WORKSPACE_MOUNT_ROOT, mountId) } : {}),
        ...(isSelf ? { workingDirectory: this.collector.workingDirectoryOf(agent) } : {}),
        status: status?.status ?? 'missing',
        builtAt: status?.builtAt ?? null,
        fileCount: status?.fileCount ?? 0,
        referencesReadable: isSelf || !!peer,
      };
    };
    const notes: string[] = [];

    if (!mounted) {
      notes.push(`Your environment has no ${AGENSTRA_WORKSPACE_MOUNT_ROOT} mount, so only its own graph is available.`);
    }

    if (!complete) {
      notes.push(
        'Workspace membership cannot be resolved right now (no controller connection); peers are shown anonymously.',
      );
    }

    return {
      environments: [summary(self, true), ...others.map((agent) => summary(agent, false))],
      ...(notes.length ? { note: notes.join(' ') } : {}),
    };
  }

  /**
   * Resolve the environment a tool call targets: own environment by default; otherwise an environment id, a mount id,
   * the name of a workspace peer, or an absolute path (`/app/...` or `/opt/workspace/<mount id>/...`).
   */
  async resolve(callerId: string, input: string | undefined): Promise<AgentGraphAccessTarget> {
    const lookup = input?.trim() ?? '';

    if (lookup.length > MAX_LOOKUP_LENGTH) {
      throw new NotFoundException('Environment lookup is too long');
    }

    const { self, others, peers } = await this.reachable(callerId);
    const selfTarget = (relativePath?: string): AgentGraphAccessTarget => ({
      environmentId: self.id,
      self: true,
      workspacePeer: false,
      referencesReadable: true,
      base: { root: this.collector.workingDirectoryOf(self) },
      ...(relativePath !== undefined ? { relativePath } : {}),
    });
    const otherTarget = (agent: AgentEntity, relativePath?: string): AgentGraphAccessTarget => {
      const mountId = workspaceMountIdOf(agent.volumePath) as string;

      return {
        environmentId: agent.id,
        self: false,
        workspacePeer: peers.has(agent.id),
        mountId,
        environmentName: agent.name,
        referencesReadable: peers.has(agent.id),
        base: { root: posix.join(AGENSTRA_WORKSPACE_MOUNT_ROOT, mountId) },
        ...(relativePath !== undefined ? { relativePath } : {}),
      };
    };

    if (!lookup || lookup === 'self') {
      return selfTarget();
    }

    const lowered = lookup.toLowerCase();

    if (lowered === self.id.toLowerCase() || lowered === workspaceMountIdOf(self.volumePath)?.toLowerCase()) {
      return selfTarget();
    }

    const byKey = others.find(
      (agent) => agent.id.toLowerCase() === lowered || workspaceMountIdOf(agent.volumePath)?.toLowerCase() === lowered,
    );

    if (byKey) {
      return otherTarget(byKey);
    }

    if (lookup.startsWith('/')) {
      const path = posix.normalize(lookup).replace(/\/+$/, '') || '/';
      const workingDirectory = this.collector.workingDirectoryOf(self);
      const own =
        relativeBelow(workingDirectory, path) ??
        relativeBelow(posix.join(AGENSTRA_WORKSPACE_MOUNT_ROOT, workspaceMountIdOf(self.volumePath) ?? '\0'), path);

      if (own !== undefined) {
        return selfTarget(own);
      }

      for (const agent of others) {
        const relative = relativeBelow(
          posix.join(AGENSTRA_WORKSPACE_MOUNT_ROOT, workspaceMountIdOf(agent.volumePath) as string),
          path,
        );

        if (relative !== undefined) {
          return otherTarget(agent, relative);
        }
      }
    }

    // Names only resolve for environments whose names the caller may know (own + workspace peers).
    if (self.name.trim().toLowerCase() === lowered) {
      return selfTarget();
    }

    const named = others.filter((agent) => peers.get(agent.id)?.name.trim().toLowerCase() === lowered);

    if (named.length === 1) {
      return otherTarget(named[0]);
    }

    throw new NotFoundException(
      `"${lookup}" matches no environment you can reach (environment id, mount id, workspace peer name or path below ${AGENSTRA_WORKSPACE_MOUNT_ROOT}).`,
    );
  }

  /** Guard for reference-graph reads of another environment. */
  assertReferencesReadable(target: AgentGraphAccessTarget): void {
    if (!target.referencesReadable) {
      throw new ForbiddenException('Prompt references of environments outside your workspace are not available.');
    }
  }

  private async reachable(callerId: string): Promise<{
    self: AgentEntity;
    others: AgentEntity[];
    peers: Map<string, AgentHandoffAgentSummary>;
    complete: boolean;
    mounted: boolean;
  }> {
    const self = await this.agentsRepository.findById(callerId);

    if (!self) {
      throw new NotFoundException('Agent not found');
    }

    const mounted = !!self.containerId && (await this.hasWorkspaceMount(self.containerId));
    const { peers, complete } = await this.workspacePeers(callerId);

    if (!mounted) {
      return { self, others: [], peers, complete, mounted };
    }

    // Exactly what the read-only /opt/agents bind exposes: every environment of this host with a working directory.
    const others = (await this.agentsRepository.findAllWithContainers()).filter(
      (agent) => agent.id !== self.id && !!workspaceMountIdOf(agent.volumePath),
    );

    return { self, others, peers, complete, mounted };
  }

  private async hasWorkspaceMount(containerId: string): Promise<boolean> {
    const cached = this.mountChecks.get(containerId);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let value = false;

    try {
      value = await this.dockerService.hasWorkspaceContextMount(containerId);
    } catch (error) {
      this.logger.debug(`Workspace mount check for ${containerId} failed: ${String(error)}`);
    }

    this.mountChecks.set(containerId, { value, expiresAt: Date.now() + MOUNT_CHECK_CACHE_TTL_MS });

    return value;
  }

  private async workspacePeers(
    agentId: string,
  ): Promise<{ peers: Map<string, AgentHandoffAgentSummary>; complete: boolean }> {
    const cached = this.peerCache.get(agentId);

    if (cached && cached.expiresAt > Date.now()) {
      return { peers: new Map(cached.peers.map((peer) => [peer.id, peer])), complete: cached.complete };
    }

    let peers: AgentHandoffAgentSummary[] = [];
    let complete = true;

    try {
      peers = (await this.handoffs.peers(agentId)).filter((peer) => peer.id !== agentId);
    } catch (error) {
      this.logger.debug(`Workspace peers of agent ${agentId} unavailable: ${String(error)}`);
      complete = false;
    }

    // Only successful lookups are cached; a missing controller connection is retried on the next call.
    if (complete) {
      this.peerCache.set(agentId, { peers, complete, expiresAt: Date.now() + PEERS_CACHE_TTL_MS });
    }

    return { peers: new Map(peers.map((peer) => [peer.id, peer])), complete };
  }
}

function relativeBelow(base: string, path: string): string | undefined {
  if (path === base) {
    return '';
  }

  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : undefined;
}
