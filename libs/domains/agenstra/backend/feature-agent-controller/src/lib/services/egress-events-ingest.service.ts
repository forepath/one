import type { AgentEgressEventDto } from '@forepath/agenstra/backend/feature-agent-manager';
import { NotFoundException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EgressEventIngestCursorEntity } from '../entities/egress-event-ingest-cursor.entity';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAgentProxyService } from './client-agent-proxy.service';
import { OpencodeConfigSyncTargetsService } from './opencode-config-sync-targets.service';
import { StatisticsService } from './statistics.service';

const PAGE_SIZE = 500;
const MAX_PAGES_PER_RUN = 10;
/** Distinct blocked / observed decisions published per type and ingestion run (the rest is summarized). */
const MAX_DECISION_NOTIFICATIONS_PER_RUN = 25;
const MAX_GUARD_NOTIFICATIONS_PER_RUN = 10;

type IngestedEvent = AgentEgressEventDto;

/**
 * Pulls aggregated egress guard decisions from each workspace's agent manager
 * (`GET /api/egress/events?afterSeq=`), stores them for /audit and publishes notifications.
 */
@Injectable()
export class EgressEventsIngestService {
  private readonly logger = new Logger(EgressEventsIngestService.name);

  constructor(
    @InjectRepository(EgressEventIngestCursorEntity)
    private readonly cursors: Repository<EgressEventIngestCursorEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientAgentProxy: ClientAgentProxyService,
    private readonly statisticsService: StatisticsService,
    @Optional() private readonly notificationPublisher?: AgenstraNotificationPublisher,
    @Optional() private readonly configSyncTargets?: OpencodeConfigSyncTargetsService,
  ) {}

  /** Workspaces to poll next: never-polled first, then least recently polled. */
  async findClientIdsDue(max: number): Promise<string[]> {
    if (max <= 0) {
      return [];
    }

    const clientIds = await this.clientsRepository.findAllIds();

    if (clientIds.length <= max) {
      return clientIds;
    }

    const rows = await this.cursors.find({ select: ['clientId', 'updatedAt'] });
    const polledAt = new Map(rows.map((row) => [row.clientId, row.updatedAt?.getTime() ?? 0]));

    return [...clientIds].sort((left, right) => (polledAt.get(left) ?? -1) - (polledAt.get(right) ?? -1)).slice(0, max);
  }

  /** Ingest every new event of one workspace (bounded per run). Returns the number of stored rows. */
  async ingestClient(clientId: string): Promise<number> {
    let cursor = await this.cursors.findOne({ where: { clientId } });

    if (!cursor) {
      cursor = this.cursors.create({ clientId, lastSeq: '0', lastError: null, lastIngestedAt: null });
    }

    let stored = 0;
    const blocked: IngestedEvent[] = [];
    const guardErrors: IngestedEvent[] = [];

    try {
      for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
        const result = await this.clientAgentProxy.listClientEgressEvents(clientId, String(cursor.lastSeq), PAGE_SIZE);
        const events = Array.isArray(result?.events) ? result.events : [];

        if (events.length > 0) {
          const inserted = await this.statisticsService.recordEgressEvents(clientId, events);
          const insertedSeqs = new Set(inserted.map((row) => String(row.sourceSeq)));

          stored += inserted.length;

          for (const event of events) {
            if (!insertedSeqs.has(String(event.seq))) {
              continue;
            }

            if (event.decision === 'blocked' || event.decision === 'observed') {
              blocked.push(event);
            } else if (event.kind === 'guard' && event.decision === 'error') {
              guardErrors.push(event);
            }
          }
        }

        if (typeof result?.nextSeq === 'string' && /^\d+$/.test(result.nextSeq)) {
          cursor.lastSeq = result.nextSeq;
        }

        if (!result?.hasMore) {
          break;
        }
      }

      cursor.lastError = null;
      cursor.lastIngestedAt = new Date();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Managers without the egress feed (older releases) answer 404: nothing to ingest.
      cursor.lastError = error instanceof NotFoundException ? 'egress feed not available' : message.slice(0, 1000);
      this.logger.debug(`Egress event ingestion for client ${clientId} failed: ${message}`);
    }

    await this.cursors.save(cursor);
    this.publishDecisionNotifications(clientId, blocked);
    await this.handleGuardErrors(clientId, guardErrors);

    return stored;
  }

  private publishDecisionNotifications(clientId: string, events: readonly IngestedEvent[]): void {
    if (!this.notificationPublisher || events.length === 0) {
      return;
    }

    for (const decision of ['blocked', 'observed'] as const) {
      const grouped = new Map<string, IngestedEvent & { total: number }>();

      for (const event of events) {
        if (event.decision !== decision) {
          continue;
        }

        const key = [event.agentId, event.kind, event.host ?? '', event.rule ?? ''].join('|');
        const existing = grouped.get(key);

        if (existing) {
          existing.total += event.count;
          existing.lastSeenAt = event.lastSeenAt > existing.lastSeenAt ? event.lastSeenAt : existing.lastSeenAt;
        } else {
          grouped.set(key, { ...event, total: event.count });
        }
      }

      const ordered = [...grouped.values()].sort((left, right) => right.total - left.total);
      const published = ordered.slice(0, MAX_DECISION_NOTIFICATIONS_PER_RUN);
      const omitted = ordered.length - published.length;

      published.forEach((event, index) => {
        this.notificationPublisher?.publishEgressDecision(
          decision === 'blocked' ? 'egress.blocked' : 'egress.observed',
          clientId,
          {
            agentId: event.agentId,
            kind: event.kind,
            decision: event.decision,
            host: event.host ?? null,
            rule: event.rule ?? null,
            matchedEntry: event.matchedEntry ?? null,
            matchedSource: event.matchedSource ?? null,
            method: event.method ?? null,
            count: event.total,
            firstSeenAt: new Date(event.firstSeenAt).toISOString(),
            lastSeenAt: new Date(event.lastSeenAt).toISOString(),
            ...(index === published.length - 1 && omitted > 0 ? { omittedDecisions: omitted } : {}),
          },
        );
      });
    }
  }

  private async handleGuardErrors(clientId: string, events: readonly IngestedEvent[]): Promise<void> {
    for (const event of events.slice(0, MAX_GUARD_NOTIFICATIONS_PER_RUN)) {
      this.notificationPublisher?.publishEgressGuardFailed(clientId, {
        agentId: event.agentId,
        message: event.message ?? 'egress guard failure',
        occurredAt: new Date(event.lastSeenAt).toISOString(),
      });
    }

    // A recreated guard only received the stored policy: re-sync so the upstream proxy (layered network
    // secrets) and the current effective policy are applied again.
    const recovered = new Set(
      events.filter((event) => (event.message ?? '').startsWith('guard_missing')).map((event) => event.agentId),
    );

    for (const agentId of recovered) {
      try {
        await this.configSyncTargets?.markAgentPending(clientId, agentId);
      } catch (error: unknown) {
        this.logger.debug(`Failed to mark agent ${agentId} for re-sync: ${(error as Error).message}`);
      }
    }
  }
}
