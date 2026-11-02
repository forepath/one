import {
  egressPolicyRequiresGuard,
  resolveEffectiveEgressPolicy,
  type EffectiveEgressPolicy,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger } from '@nestjs/common';

import {
  EGRESS_GUARD_AGENT_LABEL,
  EGRESS_GUARD_CLI,
  EGRESS_GUARD_FORWARDED_AGENT_PORTS,
  EGRESS_GUARD_LABEL,
  egressGuardContainerName,
  EGRESS_GUARD_NO_PROXY_DEFAULTS,
  EGRESS_GUARD_PROXY_ENV_KEYS,
  EGRESS_GUARD_PROXY_URL,
  EGRESS_GUARD_READY_TIMEOUT_MS,
  EGRESS_GUARD_STAGED_DIR_NAME,
  EGRESS_GUARD_STATE_DIR,
  resolveEgressGuardImage,
  resolveEgressGuardMemoryBytes,
} from '../constants/egress-guard.constants';
import type { AgentEgressStatusDto } from '../dto/agent-egress.dto';
import { AgentEntity } from '../entities/agent.entity';
import { AgentsRepository } from '../repositories/agents.repository';
import {
  computeEgressPolicyRevision,
  parseEgressUpstreamProxy,
  renderEgressGuardArtifacts,
  type EgressUpstreamProxy,
} from '../utils/egress-guard-config.utils';
import { resolveAgentContextEgressAllows } from '../utils/agent-context-egress.utils';
import { isolationRuntimeOptions } from '../utils/container-isolation.utils';

import { AgentRuntime } from '../runtime/agent-runtime';

/** Capabilities dropped from agents that join a guard namespace (no raw sockets / netfilter changes). */
export const EGRESS_GUARDED_AGENT_CAP_DROP = ['NET_ADMIN', 'NET_RAW'] as const;

export interface GuardRuntimeStatus {
  revision: string;
  mode: string;
  applied: string;
  squid: boolean;
  dnsmasq: boolean;
}

export interface AgentEgressApplyResult {
  ok: boolean;
  error?: string;
  /** Guard the agent must join (container recreate with `container:<guardId>` network mode). */
  joinGuardId?: string;
  /** Proxy env overrides for the agent container (`undefined` removes a key). */
  proxyEnv: Record<string, string | undefined>;
  /** Whether an apply happened (policy revision changed). */
  applied: boolean;
  revision: string | null;
}

const egressLocks = new Map<string, Promise<unknown>>();

/** Serialize guard topology / policy work per agent (sync, lifecycle and the background monitor). */
export async function withAgentEgressLock<T>(agentId: string, task: () => Promise<T>): Promise<T> {
  const previous = egressLocks.get(agentId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);

  egressLocks.set(agentId, tail);

  try {
    return await run;
  } finally {
    if (egressLocks.get(agentId) === tail) {
      egressLocks.delete(agentId);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.length > 1000 ? `${message.slice(0, 1000)}…` : message;
}

/**
 * Per-agent egress guard sidecar orchestration.
 *
 * The guard is created lazily the first time an agent's effective egress mode is not `off`. From then
 * on the agent lives in the guard's network namespace; switching back to `off` keeps the topology and
 * applies a pass-through policy (no container churn, instant re-enable).
 */
@Injectable()
export class AgentEgressService {
  private readonly logger = new Logger(AgentEgressService.name);
  private statusChangedBroadcaster?: (agentId: string) => void;

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly runtime: AgentRuntime,
  ) {}

  private get env(): NodeJS.ProcessEnv {
    return process.env;
  }

  registerStatusChangedBroadcaster(broadcaster: (agentId: string) => void): void {
    this.statusChangedBroadcaster = broadcaster;
  }

  /** Feature switch (`AGENT_EGRESS_GUARD_ENABLED=false` disables guard provisioning on this manager). */
  isEnabled(): boolean {
    return (this.env['AGENT_EGRESS_GUARD_ENABLED'] ?? 'true').trim().toLowerCase() !== 'false';
  }

  /** Parent proxy for the guard from layered network secrets (HTTPS_PROXY preferred). */
  resolveUpstream(secrets: Record<string, string>): EgressUpstreamProxy | null {
    return parseEgressUpstreamProxy(secrets['HTTPS_PROXY'] || secrets['HTTP_PROXY'], secrets['NO_PROXY']);
  }

  /**
   * Proxy environment for the agent container. While a guard enforces (mode ≠ off), every proxy variant
   * points at the guard's explicit proxy; otherwise lower-case variants are removed and upper-case values
   * fall back to the layered network secrets (handled by the caller).
   */
  buildProxyEnv(
    policy: EffectiveEgressPolicy | null | undefined,
    hasGuard: boolean,
    secrets: Record<string, string>,
  ): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};

    if (!hasGuard || !egressPolicyRequiresGuard(policy)) {
      for (const key of EGRESS_GUARD_PROXY_ENV_KEYS) {
        if (key === key.toLowerCase()) {
          env[key] = undefined;
        }
      }

      return env;
    }

    const noProxy = [
      ...EGRESS_GUARD_NO_PROXY_DEFAULTS,
      ...(secrets['NO_PROXY'] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ];
    const noProxyValue = [...new Set(noProxy)].join(',');

    env['HTTP_PROXY'] = EGRESS_GUARD_PROXY_URL;
    env['HTTPS_PROXY'] = EGRESS_GUARD_PROXY_URL;
    env['http_proxy'] = EGRESS_GUARD_PROXY_URL;
    env['https_proxy'] = EGRESS_GUARD_PROXY_URL;
    env['NO_PROXY'] = noProxyValue;
    env['no_proxy'] = noProxyValue;

    return env;
  }

  // -------------------------------------------------------------------------
  // Guard container primitives
  // -------------------------------------------------------------------------

  private async createGuard(agentId: string): Promise<string> {
    const network = this.env['AGENT_DOCKER_NETWORK']?.trim() || undefined;

    if (network) {
      await this.runtime.ensureNetworkExists(network);
    }

    const name = egressGuardContainerName(agentId);
    const create = () =>
      this.runtime.createEgressGuardContainer({
        name,
        image: resolveEgressGuardImage(this.env),
        labels: {
          [EGRESS_GUARD_LABEL]: '1',
          [EGRESS_GUARD_AGENT_LABEL]: agentId,
        },
        network,
        publishPorts: EGRESS_GUARD_FORWARDED_AGENT_PORTS,
        memoryBytes: resolveEgressGuardMemoryBytes(this.env),
      });

    try {
      return await create();
    } catch (error: unknown) {
      if ((error as { statusCode?: number }).statusCode !== 409) {
        throw error;
      }

      // A stale guard with the same name (e.g. left behind by a crashed recovery) blocks the name.
      const stale = await this.runtime.inspectContainerSummary(name);

      if (!stale || stale.labels[EGRESS_GUARD_LABEL] !== '1') {
        throw error;
      }

      await this.removeGuardContainer(stale.id);

      return await create();
    }
  }

  async getGuardStatus(guardId: string): Promise<GuardRuntimeStatus | null> {
    try {
      const output = await this.runtime.sendCommandToContainer(guardId, [EGRESS_GUARD_CLI, 'status'], undefined, true, {
        user: '0',
      });
      const line = output
        .split('\n')
        .map((entry) => entry.trim())
        .reverse()
        .find((entry) => entry.startsWith('{'));

      return line ? (JSON.parse(line) as GuardRuntimeStatus) : null;
    } catch {
      return null;
    }
  }

  private async waitForGuardReady(guardId: string): Promise<void> {
    const deadline = Date.now() + EGRESS_GUARD_READY_TIMEOUT_MS;
    let last: GuardRuntimeStatus | null = null;

    while (Date.now() < deadline) {
      last = await this.getGuardStatus(guardId);

      if (last?.squid && last.dnsmasq) {
        return;
      }

      await sleep(500);
    }

    throw new Error(
      `Egress guard ${guardId.slice(0, 12)} did not become ready (squid=${last?.squid ?? false}, dnsmasq=${last?.dnsmasq ?? false})`,
    );
  }

  /** Render, upload, validate and activate a policy bundle (the guard keeps the last known good on failure). */
  async applyPolicyToGuard(
    guardId: string,
    policy: EffectiveEgressPolicy,
    upstream: EgressUpstreamProxy | null,
    force = false,
  ): Promise<{ revision: string; applied: boolean }> {
    const platformAllows = await resolveAgentContextEgressAllows();
    const revision = computeEgressPolicyRevision(policy, upstream, undefined, platformAllows);

    if (!force) {
      const status = await this.getGuardStatus(guardId);

      if (status?.revision === revision && status.applied === revision && status.squid && status.dnsmasq) {
        return { revision, applied: false };
      }
    }

    const artifacts = renderEgressGuardArtifacts(policy, upstream, undefined, platformAllows);

    await this.runtime.sendCommandToContainer(guardId, [EGRESS_GUARD_CLI, 'prepare'], undefined, true, {
      user: '0',
    });
    await this.runtime.putFilesIntoContainer(
      guardId,
      `${EGRESS_GUARD_STATE_DIR}/${EGRESS_GUARD_STAGED_DIR_NAME}`,
      Object.entries(artifacts.files).map(([name, content]) => ({ name, content, mode: 0o640 })),
    );
    await this.runtime.sendCommandToContainer(guardId, [EGRESS_GUARD_CLI, 'apply'], undefined, true, {
      user: '0',
    });

    return { revision: artifacts.revision, applied: true };
  }

  /**
   * Create a guard and apply the policy before the agent's worker exists (fail closed at agent creation).
   * The agent id is assigned upfront, so the guard is named `agenstra-egress-<agentId>` from the start.
   * The guard is removed again when provisioning fails.
   */
  async provisionGuardForNewAgent(
    agentId: string,
    policy: EffectiveEgressPolicy,
    upstream: EgressUpstreamProxy | null,
  ): Promise<{ guardId: string; revision: string }> {
    const guardId = await this.createGuard(agentId);

    try {
      await this.waitForGuardReady(guardId);
      const { revision } = await this.applyPolicyToGuard(guardId, policy, upstream, true);

      return { guardId, revision };
    } catch (error) {
      await this.removeGuardContainer(guardId);

      throw error;
    }
  }

  async removeGuardContainer(guardId: string): Promise<void> {
    try {
      await this.runtime.deleteContainer(guardId);
    } catch (error: unknown) {
      this.logger.warn(`Failed to remove egress guard ${guardId.slice(0, 12)}: ${shortError(error)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Agent orchestration
  // -------------------------------------------------------------------------

  /**
   * Bring the agent's guard in line with its effective policy (create / start / apply).
   * Does not recreate the agent container; when the agent still runs on the legacy network the result
   * carries `joinGuardId` and the caller recreates it (together with its environment changes).
   */
  async applyPolicyForAgent(
    agentId: string,
    policyInput: EffectiveEgressPolicy | null | undefined,
    secrets: Record<string, string>,
  ): Promise<AgentEgressApplyResult> {
    return await withAgentEgressLock(agentId, async () => {
      const agent = await this.agentsRepository.findById(agentId);

      if (!agent) {
        return {
          ok: false,
          error: `Agent with ID '${agentId}' not found`,
          proxyEnv: {},
          applied: false,
          revision: null,
        };
      }

      const policy = policyInput ?? agent.egressPolicy ?? resolveEffectiveEgressPolicy([]);

      if (this.runtime.egress) {
        return await this.applyPolicyThroughRuntime(agent, policy, this.runtime.egress);
      }

      const upstream = this.resolveUpstream(secrets);
      const requiresGuard = egressPolicyRequiresGuard(policy);
      let guardId = agent.egressGuardContainerId ?? null;
      let guard = guardId ? await this.runtime.inspectContainerSummary(guardId) : null;

      if (guardId && !guard) {
        guardId = null;
      }

      if (!guardId && !requiresGuard) {
        await this.agentsRepository.update(agentId, {
          egressPolicy: policy,
          egressStatus: 'inactive',
          egressLastError: null,
          egressPolicyRevision: null,
        });

        return { ok: true, proxyEnv: this.buildProxyEnv(policy, false, secrets), applied: false, revision: null };
      }

      try {
        if (!guardId) {
          if (!this.isEnabled()) {
            throw new Error(
              'Egress guard sidecars are disabled on this agent manager (AGENT_EGRESS_GUARD_ENABLED=false)',
            );
          }

          guardId = await this.createGuard(agentId);
          guard = await this.runtime.inspectContainerSummary(guardId);
          await this.agentsRepository.update(agentId, { egressGuardContainerId: guardId, egressLogCursor: null });
        } else if (guard && !guard.running) {
          await this.runtime.startContainer(guardId);
        }

        await this.waitForGuardReady(guardId);
        const { revision, applied } = await this.applyPolicyToGuard(guardId, policy, upstream);
        const agentContainer = agent.containerId ? await this.runtime.inspectContainerSummary(agent.containerId) : null;
        const joined = agentContainer?.networkMode === `container:${guardId}`;

        await this.agentsRepository.update(agentId, {
          egressPolicy: policy,
          egressPolicyRevision: revision,
          egressStatus: requiresGuard ? 'active' : 'inactive',
          egressLastError: null,
          egressAppliedAt: applied ? new Date() : (agent.egressAppliedAt ?? new Date()),
        });

        if (joined) {
          await this.refreshAgentNamespaceIfStale(agent, guardId);
        }

        if (applied) {
          this.statusChangedBroadcaster?.(agentId);
        }

        return {
          ok: true,
          ...(joined || !agent.containerId ? {} : { joinGuardId: guardId }),
          proxyEnv: this.buildProxyEnv(policy, true, secrets),
          applied,
          revision,
        };
      } catch (error: unknown) {
        const message = shortError(error);

        this.logger.warn(`Egress policy apply failed for agent ${agentId}: ${message}`);
        const stopped = requiresGuard ? await this.stopUnguardedAgent(agent, guardId) : false;

        await this.agentsRepository.update(agentId, {
          egressPolicy: policy,
          egressStatus: 'failed',
          egressLastError: stopped ? `${message} (agent stopped until its egress guard is available)` : message,
          ...(guardId ? { egressGuardContainerId: guardId } : {}),
        });
        this.statusChangedBroadcaster?.(agentId);

        // Keep whatever proxy configuration the agent currently has: a guard that already exists still
        // enforces its last known good bundle.
        return {
          ok: false,
          error: message,
          proxyEnv: this.buildProxyEnv(agent.egressPolicy, !!agent.egressGuardContainerId, secrets),
          applied: false,
          revision: agent.egressPolicyRevision ?? null,
        };
      }
    });
  }

  /**
   * Runtime-managed egress (Loadweaver): the policy is compiled into the runtime's own filtering (node proxy policies)
   * and applied with the environment; no proxy variables (the filtering is transparent). On failure the last applied
   * policies stay in force (Loadweaver applies plans atomically or not at all).
   */
  private async applyPolicyThroughRuntime(
    agent: AgentEntity,
    policy: EffectiveEgressPolicy,
    egress: NonNullable<AgentRuntime['egress']>,
  ): Promise<AgentEgressApplyResult> {
    const requires = egressPolicyRequiresGuard(policy);

    if (!agent.containerId) {
      await this.agentsRepository.update(agent.id, { egressPolicy: policy, egressStatus: 'inactive' });

      return { ok: true, proxyEnv: {}, applied: false, revision: null };
    }

    try {
      const { revision } = await egress.applyPolicy(agent.containerId, policy);

      await this.agentsRepository.update(agent.id, {
        egressPolicy: policy,
        egressPolicyRevision: revision,
        egressStatus: requires ? 'active' : 'inactive',
        egressLastError: null,
        egressAppliedAt: new Date(),
      });
      this.statusChangedBroadcaster?.(agent.id);

      return { ok: true, proxyEnv: {}, applied: true, revision };
    } catch (error: unknown) {
      const message = shortError(error);

      this.logger.warn(`Egress policy apply failed for agent ${agent.id}: ${message}`);
      await this.agentsRepository.update(agent.id, { egressStatus: 'failed', egressLastError: message });
      this.statusChangedBroadcaster?.(agent.id);

      return { ok: false, error: message, proxyEnv: {}, applied: false, revision: agent.egressPolicyRevision ?? null };
    }
  }

  /**
   * Fail closed: an agent whose policy requires a guard must never keep running outside a guard
   * namespace. Agents already inside a guard namespace keep the guard's last known good bundle.
   * The next successful sync recreates (and starts) the agent inside the guard namespace.
   */
  private async stopUnguardedAgent(agent: AgentEntity, guardId: string | null): Promise<boolean> {
    if (!agent.containerId) {
      return false;
    }

    try {
      const container = await this.runtime.inspectContainerSummary(agent.containerId);

      if (!container?.running || (guardId && container.networkMode === `container:${guardId}`)) {
        return false;
      }

      this.logger.warn(`Stopping agent ${agent.id}: its egress policy requires a guard that could not be provisioned`);
      await this.runtime.stopContainer(agent.containerId);

      return true;
    } catch (error: unknown) {
      this.logger.error(`Failed to stop unguarded agent ${agent.id}: ${shortError(error)}`);

      return false;
    }
  }

  /** Refuse to (re)start an agent outside a guard namespace while its policy requires one. */
  private assertGuardNotRequired(agent: AgentEntity): void {
    // The runtime filters egress itself (Loadweaver): there is no guard to wait for.
    if (this.runtime.egress) {
      return;
    }

    if (egressPolicyRequiresGuard(agent.egressPolicy)) {
      throw new Error(
        `Agent ${agent.id} requires an egress guard (mode '${agent.egressPolicy?.mode}') that is not provisioned yet; it will be provisioned on the next config sync`,
      );
    }
  }

  /**
   * After the guard was (re)started its network namespace is new: a running agent still holds the old
   * namespace (no interfaces → no traffic, fail closed) and must be restarted to join the new one.
   */
  async refreshAgentNamespaceIfStale(agent: AgentEntity, guardId: string): Promise<boolean> {
    if (!agent.containerId) {
      return false;
    }

    const [guard, container] = await Promise.all([
      this.runtime.inspectContainerSummary(guardId),
      this.runtime.inspectContainerSummary(agent.containerId),
    ]);

    if (!guard?.running || !container?.running || !guard.startedAt || !container.startedAt) {
      return false;
    }

    if (guard.startedAt.getTime() <= container.startedAt.getTime()) {
      return false;
    }

    this.logger.log(`Restarting agent ${agent.id} to join the restarted egress guard namespace`);
    await this.runtime.restartContainer(agent.containerId);

    return true;
  }

  /** Start the guard (if any) before the agent container starts; refreshes stale namespaces. */
  async beforeAgentStart(agent: AgentEntity): Promise<void> {
    const guardId = agent.egressGuardContainerId;

    if (!guardId) {
      this.assertGuardNotRequired(agent);

      return;
    }

    await withAgentEgressLock(agent.id, async () => {
      const guard = await this.runtime.inspectContainerSummary(guardId);

      if (!guard) {
        throw new Error(`Egress guard for agent ${agent.id} is missing; it will be recreated on the next config sync`);
      }

      if (!guard.running) {
        await this.runtime.startContainer(guardId);
        await this.waitForGuardReady(guardId);
      }
    });
  }

  /** Restart the guard before an agent restart (fresh namespace, re-activates the stored bundle). */
  async beforeAgentRestart(agent: AgentEntity): Promise<void> {
    const guardId = agent.egressGuardContainerId;

    if (!guardId) {
      this.assertGuardNotRequired(agent);

      return;
    }

    await withAgentEgressLock(agent.id, async () => {
      const guard = await this.runtime.inspectContainerSummary(guardId);

      if (!guard) {
        throw new Error(`Egress guard for agent ${agent.id} is missing; it will be recreated on the next config sync`);
      }

      await this.runtime.restartContainer(guardId);
      await this.waitForGuardReady(guardId);
    });
  }

  /** Stop the guard after the agent stopped. */
  async afterAgentStop(agent: AgentEntity): Promise<void> {
    if (!agent.egressGuardContainerId) {
      return;
    }

    try {
      await this.runtime.stopContainer(agent.egressGuardContainerId);
    } catch (error: unknown) {
      this.logger.warn(`Failed to stop egress guard for agent ${agent.id}: ${shortError(error)}`);
    }
  }

  /** Remove the guard after the agent container was deleted. */
  async afterAgentRemove(agent: AgentEntity): Promise<void> {
    if (agent.egressGuardContainerId) {
      await this.removeGuardContainer(agent.egressGuardContainerId);
    }
  }

  /**
   * Recreate a missing guard for an agent living in a dead namespace (manual `docker rm`, host cleanup)
   * and move the agent into the new namespace. Uses the stored policy; returns the new guard id.
   */
  async recoverMissingGuard(agent: AgentEntity, secrets: Record<string, string> = {}): Promise<string | null> {
    if (!agent.containerId || !this.isEnabled() || this.runtime.egress) {
      return null;
    }

    return await withAgentEgressLock(agent.id, async () => {
      const fresh = await this.agentsRepository.findById(agent.id);

      if (!fresh?.containerId || !fresh.egressGuardContainerId) {
        return null;
      }

      if (await this.runtime.inspectContainerSummary(fresh.egressGuardContainerId)) {
        return null;
      }

      const policy = fresh.egressPolicy ?? resolveEffectiveEgressPolicy([]);
      const guardId = await this.createGuard(fresh.id);

      try {
        await this.waitForGuardReady(guardId);
        const { revision } = await this.applyPolicyToGuard(guardId, policy, this.resolveUpstream(secrets), true);
        const newContainerId = await this.runtime.updateContainer(fresh.containerId, {
          ...isolationRuntimeOptions(fresh),
          sharedNetworkContainerId: guardId,
          capDrop: [...EGRESS_GUARDED_AGENT_CAP_DROP],
        });

        await this.agentsRepository.update(fresh.id, {
          containerId: newContainerId,
          egressGuardContainerId: guardId,
          egressPolicyRevision: revision,
          egressStatus: egressPolicyRequiresGuard(policy) ? 'active' : 'inactive',
          egressLastError: null,
          egressAppliedAt: new Date(),
          egressLogCursor: null,
        });
        this.statusChangedBroadcaster?.(fresh.id);

        return guardId;
      } catch (error) {
        await this.removeGuardContainer(guardId);
        await this.agentsRepository.update(fresh.id, { egressStatus: 'failed', egressLastError: shortError(error) });

        throw error;
      }
    });
  }

  /** Guard containers that no agent references (created > 10 minutes ago, avoids racing provisioning). */
  async removeOrphanedGuards(): Promise<number> {
    if (this.runtime.egress) {
      return 0;
    }

    const guards = await this.runtime.listContainersByLabel(`${EGRESS_GUARD_LABEL}=1`);

    if (guards.length === 0) {
      return 0;
    }

    const agents = await this.agentsRepository.findAllWithEgressGuards();
    const referenced = new Set(agents.map((agent) => agent.egressGuardContainerId).filter(Boolean) as string[]);
    const cutoff = Date.now() - 10 * 60 * 1000;
    let removed = 0;

    for (const guard of guards) {
      const isReferenced = [...referenced].some(
        (id) => guard.id === id || guard.id.startsWith(id) || id.startsWith(guard.id),
      );

      if (isReferenced || guard.createdAt.getTime() > cutoff) {
        continue;
      }

      await this.removeGuardContainer(guard.id);
      removed += 1;
    }

    return removed;
  }

  /** Runtime status for API responses (cheap: DB only unless `live` is requested). */
  async describe(agent: AgentEntity, live = false): Promise<AgentEgressStatusDto> {
    const policy = agent.egressPolicy ?? null;
    const base: AgentEgressStatusDto = {
      status: agent.egressStatus ?? 'inactive',
      mode: policy?.mode ?? 'off',
      guardContainerId: agent.egressGuardContainerId ? agent.egressGuardContainerId.slice(0, 12) : null,
      policyRevision: agent.egressPolicyRevision ?? null,
      appliedAt: agent.egressAppliedAt ?? null,
      lastError: agent.egressLastError ?? null,
    };

    if (!live || !agent.egressGuardContainerId) {
      return base;
    }

    const [summary, runtime] = await Promise.all([
      this.runtime.inspectContainerSummary(agent.egressGuardContainerId),
      this.getGuardStatus(agent.egressGuardContainerId),
    ]);

    return {
      ...base,
      guard: {
        running: summary?.running ?? false,
        startedAt: summary?.startedAt ?? null,
        activeRevision: runtime?.revision || null,
        proxyRunning: runtime?.squid ?? false,
        dnsRunning: runtime?.dnsmasq ?? false,
      },
    };
  }
}
