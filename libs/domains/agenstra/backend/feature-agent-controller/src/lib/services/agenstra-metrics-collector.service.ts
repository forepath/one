import { isOtelEffectivelyEnabled, resolveOtelRuntimeConfig, setGauge } from '@forepath/shared/backend/util-otel';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ChatDirection, StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket.enums';
import { ClientsRepository } from '../repositories/clients.repository';
import { StatisticsSecurityRepository } from '../repositories/statistics-security.repository';
import { StatisticsRepository } from '../repositories/statistics.repository';

const METER_NAME = 'forepath.agenstra';
const POLL_INTERVAL_MS = 60_000;

@Injectable()
export class AgenstraMetricsCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgenstraMetricsCollectorService.name);
  private intervalHandle: NodeJS.Timeout | undefined;

  constructor(
    private readonly clientsRepository: ClientsRepository,
    @InjectRepository(TicketEntity)
    private readonly ticketRepository: Repository<TicketEntity>,
    private readonly statisticsRepository: StatisticsRepository,
    private readonly statisticsSecurityRepository: StatisticsSecurityRepository,
  ) {}

  onModuleInit(): void {
    const config = resolveOtelRuntimeConfig(process.env, 'agenstra-agent-controller');

    if (!isOtelEffectivelyEnabled(config)) {
      return;
    }

    void this.collectMetrics();
    this.intervalHandle = setInterval(() => {
      void this.collectMetrics();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  private async collectMetrics(): Promise<void> {
    try {
      const workspaceCount = await this.clientsRepository.count();

      setGauge(METER_NAME, 'agenstra.workspaces', workspaceCount);

      const clientIds = await this.clientsRepository.findAllIds();
      const countsByClientAndStatus = await this.countTicketsGroupedByClientAndStatus();

      for (const clientId of clientIds) {
        for (const status of Object.values(TicketStatus)) {
          const key = `${clientId}:${status}`;
          const count = countsByClientAndStatus.get(key) ?? 0;

          setGauge(METER_NAME, 'agenstra.tickets', count, {
            client_id: clientId,
            status,
          });
        }
      }

      await this.collectChatAndFilterMetrics(clientIds);
      await this.collectEgressMetrics();
    } catch (error) {
      this.logger.warn(`Failed to collect Agenstra OTEL metrics: ${(error as Error).message}`);
    }
  }

  private async collectChatAndFilterMetrics(clientIds: string[]): Promise<void> {
    const chatRows = await this.statisticsRepository.countChatIoGroupedForMetrics();
    const chatByKey = new Map(
      chatRows.map((row) => [`${row.clientId}:${row.direction}:${row.interactionKind}`, row] as const),
    );

    for (const clientId of clientIds) {
      for (const direction of Object.values(ChatDirection)) {
        for (const interactionKind of Object.values(StatisticsInteractionKind)) {
          const row = chatByKey.get(`${clientId}:${direction}:${interactionKind}`);
          const labels = {
            client_id: clientId,
            direction,
            interaction_kind: interactionKind,
          };

          setGauge(METER_NAME, 'agenstra.chat_messages', row?.count ?? 0, labels);
          setGauge(METER_NAME, 'agenstra.chat_words', row?.wordCount ?? 0, labels);
          setGauge(METER_NAME, 'agenstra.chat_chars', row?.charCount ?? 0, labels);
        }
      }
    }

    const dropRows = await this.statisticsRepository.countFilterDropsGroupedForMetrics();

    for (const row of dropRows) {
      setGauge(METER_NAME, 'agenstra.filter_drops', row.count, {
        client_id: row.clientId,
        direction: row.direction,
        filter_type: row.filterType,
      });
    }

    const flagRows = await this.statisticsRepository.countFilterFlagsGroupedForMetrics();

    for (const row of flagRows) {
      setGauge(METER_NAME, 'agenstra.filter_flags', row.count, {
        client_id: row.clientId,
        direction: row.direction,
        filter_type: row.filterType,
      });
    }
  }

  private async collectEgressMetrics(): Promise<void> {
    const rows = await this.statisticsSecurityRepository.countEgressEventsGroupedForMetrics();

    for (const row of rows) {
      setGauge(METER_NAME, 'agenstra.egress_events', row.count, {
        client_id: row.clientId,
        kind: row.kind,
        decision: row.decision,
      });
    }
  }

  private async countTicketsGroupedByClientAndStatus(): Promise<Map<string, number>> {
    const rows = await this.ticketRepository
      .createQueryBuilder('ticket')
      .select('ticket.client_id', 'clientId')
      .addSelect('ticket.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ticket.client_id')
      .addGroupBy('ticket.status')
      .getRawMany<{ clientId: string; status: string; count: string }>();

    const result = new Map<string, number>();

    for (const row of rows) {
      result.set(`${row.clientId}:${row.status}`, parseInt(row.count, 10));
    }

    return result;
  }
}
