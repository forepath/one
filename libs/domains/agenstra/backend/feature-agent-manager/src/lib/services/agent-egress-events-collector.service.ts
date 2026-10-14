import { normalizeEffectiveEgressPolicy } from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import {
  EGRESS_GUARD_CLI,
  resolveEgressEventsPollIntervalMs,
  resolveEgressEventsRetentionHours,
} from '../constants/egress-guard.constants';
import { AgentEntity } from '../entities/agent.entity';
import { AgentEgressEventsRepository, type NewAgentEgressEvent } from '../repositories/agent-egress-events.repository';
import { AgentsRepository } from '../repositories/agents.repository';
import {
  aggregateEgressObservations,
  compareDockerTimestamps,
  diffEgressCounters,
  parseEgressCounters,
  parseGuardLogLine,
  splitDockerTimestamp,
  type EgressGuardObservation,
} from '../utils/egress-guard-log.utils';

import { AgentEgressService } from './agent-egress.service';
import { DockerService } from './docker.service';

const PRUNE_EVERY_MS = 10 * 60 * 1000;

/**
 * Background collector for egress guard decisions and health.
 *
 * Every poll it reads each guard's new log lines (Squid access log, dnsmasq query log, supervisor
 * events) and netfilter counters, aggregates identical decisions and stores them in
 * `agent_egress_events` for the controller's audit ingestion. It also keeps the topology healthy:
 * a stopped guard is started, agents holding a stale namespace are restarted, and a missing guard is
 * recreated (fail closed meanwhile: the agent's namespace has no route without its guard).
 */
@Injectable()
export class AgentEgressEventsCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentEgressEventsCollectorService.name);
  private interval?: NodeJS.Timeout;
  private running = false;
  private lastPruneAt = 0;
  private readonly counterSnapshots = new Map<string, Map<string, number>>();

  constructor(
    private readonly agentsRepository: AgentsRepository,
    private readonly eventsRepository: AgentEgressEventsRepository,
    private readonly dockerService: DockerService,
    private readonly agentEgress: AgentEgressService,
  ) {}

  onModuleInit(): void {
    if ((process.env['AGENT_EGRESS_EVENTS_COLLECTOR_ENABLED'] ?? 'true').trim().toLowerCase() === 'false') {
      return;
    }

    this.interval = setInterval(() => void this.runCycle(), resolveEgressEventsPollIntervalMs());
    this.interval.unref?.();
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /** One collection cycle over every guarded agent (re-entrancy safe). */
  async runCycle(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const agents = await this.agentsRepository.findAllWithEgressGuards();

      for (const agent of agents) {
        try {
          await this.collectForAgent(agent);
        } catch (error: unknown) {
          this.logger.warn(`Egress collection failed for agent ${agent.id}: ${(error as Error).message}`);
        }
      }

      if (Date.now() - this.lastPruneAt > PRUNE_EVERY_MS) {
        this.lastPruneAt = Date.now();
        await this.prune();
      }
    } catch (error: unknown) {
      this.logger.warn(`Egress collection cycle failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async prune(): Promise<number> {
    const cutoff = new Date(Date.now() - resolveEgressEventsRetentionHours() * 60 * 60 * 1000);
    const removed = await this.eventsRepository.deleteCreatedBefore(cutoff);

    try {
      await this.agentEgress.removeOrphanedGuards();
    } catch (error: unknown) {
      this.logger.debug(`Orphaned guard cleanup skipped: ${(error as Error).message}`);
    }

    return removed;
  }

  async collectForAgent(agent: AgentEntity): Promise<number> {
    const guardId = agent.egressGuardContainerId;

    if (!guardId) {
      return 0;
    }

    const policy = agent.egressPolicy ? normalizeEffectiveEgressPolicy(agent.egressPolicy) : null;
    const mode = policy?.mode ?? 'off';
    const guard = await this.dockerService.inspectContainerSummary(guardId);
    const observations: EgressGuardObservation[] = [];

    if (!guard) {
      observations.push({
        kind: 'guard',
        decision: 'error',
        occurredAt: new Date(),
        host: null,
        rule: 'guard',
        message: 'guard_missing: egress guard container not found; recreating it (agent egress is blocked meanwhile)',
        count: 1,
      });
      await this.persist(agent, observations, mode);
      this.counterSnapshots.delete(guardId);

      try {
        await this.agentEgress.recoverMissingGuard(agent);
      } catch (error: unknown) {
        this.logger.warn(`Failed to recover egress guard for agent ${agent.id}: ${(error as Error).message}`);
      }

      return observations.length;
    }

    const agentContainer = agent.containerId
      ? await this.dockerService.inspectContainerSummary(agent.containerId)
      : null;

    if (!guard.running && agentContainer?.running) {
      observations.push({
        kind: 'guard',
        decision: 'error',
        occurredAt: new Date(),
        host: null,
        rule: 'guard',
        message: 'guard_stopped: egress guard was not running while its agent was; restarting both',
        count: 1,
      });

      try {
        await this.agentEgress.beforeAgentStart(agent);
      } catch (error: unknown) {
        this.logger.warn(`Failed to restart egress guard for agent ${agent.id}: ${(error as Error).message}`);
      }
    }

    if (agentContainer?.networkMode === `container:${guardId}`) {
      try {
        await this.agentEgress.refreshAgentNamespaceIfStale(agent, guardId);
      } catch (error: unknown) {
        this.logger.warn(`Failed to refresh agent namespace for ${agent.id}: ${(error as Error).message}`);
      }
    }

    if (guard.running) {
      const cursor = await this.collectLogs(agent, guardId, mode, policy, observations);

      await this.collectCounters(guardId, mode, observations);

      if (cursor && cursor !== agent.egressLogCursor) {
        await this.agentsRepository.update(agent.id, { egressLogCursor: cursor });
      }
    }

    return await this.persist(agent, observations, mode);
  }

  private async collectLogs(
    agent: AgentEntity,
    guardId: string,
    mode: ReturnType<typeof normalizeEffectiveEgressPolicy>['mode'],
    policy: ReturnType<typeof normalizeEffectiveEgressPolicy> | null,
    observations: EgressGuardObservation[],
  ): Promise<string | null> {
    const cursor = agent.egressLogCursor ?? null;
    const sinceSeconds = cursor ? Math.floor(new Date(cursor).getTime() / 1000) : 0;
    const raw = await this.dockerService.getContainerLogsSince(
      guardId,
      Number.isFinite(sinceSeconds) ? sinceSeconds : 0,
    );
    let latest = cursor;

    for (const rawLine of raw.split('\n')) {
      const entry = splitDockerTimestamp(rawLine);

      if (!entry || (cursor && compareDockerTimestamps(entry.timestamp, cursor) <= 0)) {
        continue;
      }

      if (!latest || compareDockerTimestamps(entry.timestamp, latest) > 0) {
        latest = entry.timestamp;
      }

      const observation = parseGuardLogLine(entry, mode, policy);

      if (observation) {
        observations.push(observation);
      }
    }

    return latest;
  }

  private async collectCounters(
    guardId: string,
    mode: ReturnType<typeof normalizeEffectiveEgressPolicy>['mode'],
    observations: EgressGuardObservation[],
  ): Promise<void> {
    let output: string;

    try {
      output = await this.dockerService.sendCommandToContainer(
        guardId,
        [EGRESS_GUARD_CLI, 'counters'],
        undefined,
        true,
        {
          user: '0',
        },
      );
    } catch {
      return;
    }

    const samples = parseEgressCounters(output);
    const { observations: counted, snapshot } = diffEgressCounters(
      this.counterSnapshots.get(guardId) ?? null,
      samples,
      mode,
      new Date(),
    );

    this.counterSnapshots.set(guardId, snapshot);
    observations.push(...counted);
  }

  private async persist(
    agent: AgentEntity,
    observations: readonly EgressGuardObservation[],
    mode: string,
  ): Promise<number> {
    if (observations.length === 0) {
      return 0;
    }

    const rows: NewAgentEgressEvent[] = aggregateEgressObservations(observations).map((observation) => ({
      agentId: agent.id,
      kind: observation.kind,
      decision: observation.decision,
      host: observation.host?.slice(0, 255) ?? null,
      rule: observation.rule,
      matchedEntry: observation.matchedEntry?.slice(0, 255) ?? null,
      matchedSource: observation.matchedSource ?? null,
      method: observation.method?.slice(0, 32) ?? null,
      httpStatus: observation.httpStatus ?? null,
      sampleUrl: observation.url ?? null,
      count: Math.min(observation.count, 2_147_483_647),
      bytesIn: String(observation.bytesIn ?? 0),
      bytesOut: String(observation.bytesOut ?? 0),
      firstSeenAt: observation.firstSeenAt,
      lastSeenAt: observation.lastSeenAt,
      mode,
      policyRevision: agent.egressPolicyRevision ?? null,
      message: observation.message ?? null,
    }));

    await this.eventsRepository.insertMany(rows);

    return rows.length;
  }
}
