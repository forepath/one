import {
  CreateAgentDto,
  HostIsolationCapabilitiesDto,
  IsolationLevel,
  IsolationResolution,
  IsolationResolutionError,
  resolveIsolationRequest,
} from '@forepath/agenstra/backend/feature-agent-manager';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { ClientIsolationSummaryDto } from '../dto/client-isolation.dto';
import { ClientIsolationSnapshotEntity } from '../entities/client-isolation-snapshot.entity';
import {
  AgenstraNotificationPublisher,
  type IsolationHostTransitionType,
} from '../notifications/agenstra-notification.publisher';
import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAgentProxyService } from './client-agent-proxy.service';

/** Message prefix of the agent manager when a sandboxed (gVisor) worker container fails to start. */
const SANDBOX_RUNTIME_FAILURE_PATTERN = /sandboxed \(gVisor\) container could not be started/i;

/** Strip credentials embedded in URLs and bound the length of error messages sent to webhooks. */
export function redactErrorMessage(message: string): string {
  return message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s@]+@/gi, '$1***@')
    .replace(/(bearer\s+)\S+/gi, '$1***')
    .replace(/((?:token|password|secret|api[_-]?key)\s*[=:]\s*)\S+/gi, '$1***')
    .slice(0, 300);
}

/** Agent manager without isolation support (older release): standard Docker only, no selection. */
const LEGACY_SUMMARY: ClientIsolationSummaryDto = {
  supported: false,
  recommendedLevel: 'standard',
  availableLevels: ['standard'],
  levels: {
    standard: { rank: 1, runtime: 'runc', state: 'ready' },
    sandboxed: {
      rank: 2,
      runtime: 'runsc-systrap',
      state: 'unsupported',
      reasonCode: 'E_MANAGER_UNSUPPORTED',
      reason: 'The agent manager of this workspace does not support container isolation levels yet',
    },
  },
  revision: null,
  probedAt: null,
  probing: false,
  stale: false,
};

export interface CreationIsolationPlan {
  /** Fields forwarded to the agent manager (never trusted from the request beyond level + revision). */
  forward: Pick<CreateAgentDto, 'isolationLevel' | 'capabilityRevision' | 'isolationSelection'>;
  /** Resolution computed against the current capabilities (`null` for legacy agent managers). */
  resolution: IsolationResolution | null;
  capabilities: HostIsolationCapabilitiesDto | null;
}

/**
 * Container isolation capabilities of workspace hosts.
 *
 * - Summaries for workspace responses / `GET /clients/:id/isolation` (live, stale snapshot fallback).
 * - Server-side validation of the isolation level on environment creation (stale revision, unavailable
 *   level, host without runc baseline), mirroring the agent manager's own re-validation.
 * - Transition detection against a persisted snapshot, published as webhook notifications.
 */
@Injectable()
export class ClientIsolationService {
  private readonly logger = new Logger(ClientIsolationService.name);

  constructor(
    private readonly clientAgentProxyService: ClientAgentProxyService,
    private readonly clientsRepository: ClientsRepository,
    @InjectRepository(ClientIsolationSnapshotEntity)
    private readonly snapshots: Repository<ClientIsolationSnapshotEntity>,
    @Optional() private readonly notificationPublisher?: AgenstraNotificationPublisher,
  ) {}

  /** Map a manager capability record to the workspace summary. */
  summarize(capabilities: HostIsolationCapabilitiesDto | undefined | null, stale = false): ClientIsolationSummaryDto {
    if (!capabilities?.levels) {
      return { ...LEGACY_SUMMARY };
    }

    return {
      supported: true,
      recommendedLevel: capabilities.recommendedLevel ?? null,
      availableLevels: capabilities.availableLevels ?? [],
      levels: capabilities.levels,
      revision: capabilities.revision ?? null,
      probedAt: capabilities.probedAt ?? null,
      probing: capabilities.probing === true,
      stale,
    };
  }

  /**
   * Summary for a workspace response. Uses capabilities already fetched with the workspace config
   * (and records them), otherwise the last snapshot (stale) when the manager was unreachable.
   */
  async summaryForClient(
    clientId: string,
    config: { isolation?: HostIsolationCapabilitiesDto } | undefined | null,
  ): Promise<ClientIsolationSummaryDto | undefined> {
    if (config) {
      if (config.isolation) {
        void this.observe(clientId, config.isolation).catch((error: unknown) =>
          this.logger.warn(
            `Failed to record isolation capabilities of client ${clientId}: ${(error as Error).message}`,
          ),
        );
      }

      return this.summarize(config.isolation);
    }

    const snapshot = await this.snapshots.findOne({ where: { clientId } }).catch(() => null);

    return snapshot?.capabilities ? this.summarize(snapshot.capabilities, true) : undefined;
  }

  /** Live summary (`GET /clients/:id/isolation`); falls back to the stored snapshot. */
  async getSummary(clientId: string): Promise<ClientIsolationSummaryDto> {
    const capabilities = await this.fetchCapabilities(clientId);

    if (capabilities) {
      await this.observe(clientId, capabilities).catch(() => undefined);

      return this.summarize(capabilities);
    }

    const snapshot = await this.snapshots.findOne({ where: { clientId } }).catch(() => null);

    if (snapshot?.capabilities) {
      return this.summarize(snapshot.capabilities, true);
    }

    return this.summarize(null);
  }

  /** Re-probe the host now (`POST /clients/:id/isolation/probe`). */
  async probe(clientId: string): Promise<ClientIsolationSummaryDto> {
    let capabilities: HostIsolationCapabilitiesDto;

    try {
      capabilities = await this.clientAgentProxyService.probeClientIsolation(clientId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return this.summarize(null);
      }

      throw error;
    }

    await this.observe(clientId, capabilities).catch(() => undefined);

    return this.summarize(capabilities);
  }

  /** Background refresh of one workspace host (capability transitions → notifications). */
  async refresh(clientId: string): Promise<void> {
    const capabilities = await this.fetchCapabilities(clientId);

    // Record every check (also legacy / unreachable managers) so the coordinator rotates fairly.
    await this.snapshots
      .createQueryBuilder()
      .insert()
      .into(ClientIsolationSnapshotEntity)
      .values({ clientId, checkedAt: new Date() })
      .orUpdate(['checked_at'], ['client_id'])
      .execute()
      .catch((error: unknown) =>
        this.logger.warn(`Failed to record isolation check of client ${clientId}: ${(error as Error).message}`),
      );

    if (capabilities) {
      await this.observe(clientId, capabilities);
    }
  }

  /** Workspace ids checked least recently (never checked first). */
  async findClientIdsDue(max: number): Promise<string[]> {
    if (max <= 0) {
      return [];
    }

    const clientIds = await this.clientsRepository.findAllIds();

    if (clientIds.length <= max) {
      return clientIds;
    }

    const rows = await this.snapshots.find({ select: ['clientId', 'checkedAt'] });
    const checkedAt = new Map(rows.map((row) => [row.clientId, row.checkedAt?.getTime() ?? 0]));

    return [...clientIds]
      .sort((left, right) => (checkedAt.get(left) ?? -1) - (checkedAt.get(right) ?? -1))
      .slice(0, max);
  }

  /**
   * Validate the isolation request of a new environment against the host's current capabilities.
   * Explicit levels are never replaced; stale revisions and unavailable levels are rejected.
   */
  async planCreation(
    clientId: string,
    request: Pick<CreateAgentDto, 'isolationLevel' | 'capabilityRevision'>,
    userId?: string,
  ): Promise<CreationIsolationPlan> {
    let capabilities = await this.fetchCapabilities(clientId);

    // The manager's first probe is still pending, or the standard floor failed (e.g. a transient
    // registry error): re-probe instead of rejecting with stale results.
    if (capabilities && (!capabilities.probedAt || capabilities.levels.standard.state !== 'ready')) {
      capabilities = await this.clientAgentProxyService
        .probeClientIsolation(clientId)
        .then((probed) => (probed?.levels ? probed : capabilities))
        .catch(() => capabilities);
    }

    if (!capabilities) {
      // Legacy (or unreachable) agent manager: it can only run the standard level.
      if (request.isolationLevel === 'sandboxed') {
        throw new ConflictException('Sandboxed isolation is not available on this workspace');
      }

      // Forward an explicit choice anyway: should the manager support isolation after all (transient
      // fetch failure), it re-validates the level itself instead of applying its recommendation.
      return {
        forward: {
          ...(request.isolationLevel ? { isolationLevel: request.isolationLevel } : {}),
          ...(request.capabilityRevision ? { capabilityRevision: request.capabilityRevision } : {}),
          isolationSelection: userId ? { selectedBy: userId } : {},
        },
        resolution: null,
        capabilities: null,
      };
    }

    let resolution: IsolationResolution;

    try {
      resolution = resolveIsolationRequest(capabilities, request);
    } catch (error) {
      if (error instanceof IsolationResolutionError) {
        if (error.code === 'invalid-level') {
          throw new BadRequestException(error.message);
        }

        if (error.code === 'host-not-runnable') {
          throw new ServiceUnavailableException(error.message);
        }

        throw new ConflictException(error.message);
      }

      throw error;
    }

    return {
      forward: {
        ...(request.isolationLevel ? { isolationLevel: request.isolationLevel } : {}),
        // Pin the manager to the capabilities this resolution was computed against.
        capabilityRevision: capabilities.revision,
        isolationSelection: userId ? { selectedBy: userId } : {},
      },
      resolution,
      capabilities,
    };
  }

  /** Publish creation outcomes of a planned isolation selection. */
  notifyCreated(
    clientId: string,
    plan: CreationIsolationPlan,
    created: {
      id: string;
      name?: string;
      isolation?: { level?: IsolationLevel; selection?: { selectedBy?: string | null } | null };
    },
  ): void {
    if (plan.resolution?.selectionSource !== 'user-override') {
      return;
    }

    this.notificationPublisher?.publishAgentIsolationOverride(clientId, {
      agentId: created.id,
      agentName: created.name ?? null,
      automaticSelection: plan.resolution.automaticSelection,
      effectiveSelection: created.isolation?.level ?? plan.resolution.level,
      selectedBy: created.isolation?.selection?.selectedBy ?? null,
      capabilityRevision: plan.capabilities?.revision ?? null,
    });
  }

  notifyCreationFailed(clientId: string, plan: CreationIsolationPlan, agentName: string, error: unknown): void {
    const message = (error as { message?: string })?.message ?? '';

    // Only runtime failures of the sandboxed container (reported by the agent manager), not e.g.
    // validation errors such as a duplicate environment name.
    if (plan.resolution?.level !== 'sandboxed' || !SANDBOX_RUNTIME_FAILURE_PATTERN.test(message)) {
      return;
    }

    this.notificationPublisher?.publishAgentSandboxCreationFailed(clientId, {
      agentName,
      isolationLevel: 'sandboxed',
      runtime: plan.capabilities?.levels.sandboxed.runtime ?? 'runsc-systrap',
      error: redactErrorMessage(message || 'Unknown error'),
      occurredAt: new Date().toISOString(),
    });

    // A failure may indicate a broken runtime: refresh the snapshot so transitions are detected.
    void this.refresh(clientId).catch(() => undefined);
  }

  /**
   * Record observed capabilities and publish transitions. Only completed probes are recorded, and
   * the snapshot is replaced with a conditional update so concurrent observers (several requests or
   * controller instances) publish a transition only once.
   */
  async observe(clientId: string, capabilities: HostIsolationCapabilitiesDto): Promise<void> {
    if (!capabilities?.levels || !capabilities.probedAt || !capabilities.revision) {
      return;
    }

    const previous = await this.snapshots.findOne({ where: { clientId } });

    if (previous?.revision === capabilities.revision) {
      return;
    }

    const values = {
      revision: capabilities.revision,
      standardState: capabilities.levels.standard.state,
      sandboxedState: capabilities.levels.sandboxed.state,
      recommendedLevel: capabilities.recommendedLevel ?? null,
      capabilities,
      probedAt: new Date(capabilities.probedAt),
    };
    let won: boolean;

    if (previous) {
      const result = await this.snapshots
        .createQueryBuilder()
        .update(ClientIsolationSnapshotEntity)
        .set(values)
        .where(
          previous.revision === null || previous.revision === undefined
            ? 'client_id = :clientId AND revision IS NULL'
            : 'client_id = :clientId AND revision = :revision',
          { clientId, revision: previous.revision },
        )
        .execute();

      won = (result.affected ?? 0) > 0;
    } else {
      const result = await this.snapshots
        .createQueryBuilder()
        .insert()
        .into(ClientIsolationSnapshotEntity)
        .values({ clientId, ...values })
        .orIgnore()
        .returning(['client_id'])
        .execute();

      won = Array.isArray(result.raw) && result.raw.length > 0;
    }

    if (!won) {
      return;
    }

    await this.publishTransitions(clientId, previous, capabilities);
  }

  private async publishTransitions(
    clientId: string,
    previous: ClientIsolationSnapshotEntity | null,
    capabilities: HostIsolationCapabilitiesDto,
  ): Promise<void> {
    if (!this.notificationPublisher) {
      return;
    }

    const transitions: Array<{
      type: IsolationHostTransitionType;
      level: 'standard' | 'sandboxed';
      previousState: string | null;
    }> = [];
    const sandboxed = capabilities.levels.sandboxed.state;
    const standard = capabilities.levels.standard.state;
    const previousSandboxed = previous?.sandboxedState ?? null;
    const previousStandard = previous?.standardState ?? null;

    if (sandboxed === 'ready' && previousSandboxed !== 'ready') {
      transitions.push({ type: 'isolation.sandbox_available', level: 'sandboxed', previousState: previousSandboxed });
    }

    if (sandboxed !== 'ready' && previousSandboxed === 'ready') {
      transitions.push({ type: 'isolation.sandbox_unavailable', level: 'sandboxed', previousState: previousSandboxed });
    }

    if (standard !== 'ready' && previousStandard !== standard) {
      transitions.push({ type: 'isolation.baseline_failed', level: 'standard', previousState: previousStandard });
    }

    if (transitions.length === 0) {
      return;
    }

    const client = await this.clientsRepository.findById(clientId).catch(() => null);

    for (const transition of transitions) {
      const level = capabilities.levels[transition.level];

      this.notificationPublisher.publishIsolationHostTransition(transition.type, clientId, {
        clientId,
        clientName: client?.name ?? null,
        level: transition.level,
        runtime: level.runtime,
        previousState: transition.previousState,
        state: level.state,
        reasonCode: level.reasonCode ?? null,
        recommendedLevel: capabilities.recommendedLevel ?? null,
        revision: capabilities.revision,
        probedAt: capabilities.probedAt ?? null,
      });
    }
  }

  /** Current capabilities from the agent manager; `null` for legacy or unreachable managers. */
  private async fetchCapabilities(clientId: string): Promise<HostIsolationCapabilitiesDto | null> {
    try {
      const capabilities = await this.clientAgentProxyService.getClientIsolation(clientId);

      return capabilities?.levels ? capabilities : null;
    } catch (error) {
      this.logger.debug(`Isolation capabilities of client ${clientId} unavailable: ${(error as Error).message}`);

      return null;
    }
  }
}
