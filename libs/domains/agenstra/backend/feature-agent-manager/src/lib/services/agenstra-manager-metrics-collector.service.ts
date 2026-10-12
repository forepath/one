import { isOtelEffectivelyEnabled, resolveOtelRuntimeConfig, setGauge } from '@forepath/shared/backend/util-otel';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgentMessageEntity } from '../entities/agent-message.entity';
import { AgentEgressEventEntity } from '../entities/agent-egress-event.entity';
import { AgentEntity, ContainerType } from '../entities/agent.entity';

const METER_NAME = 'forepath.agenstra';
const POLL_INTERVAL_MS = 60_000;

const EGRESS_STATUSES = ['inactive', 'active', 'failed'] as const;
const EGRESS_KINDS = ['web', 'dns', 'network', 'guard'] as const;
const EGRESS_DECISIONS = ['allowed', 'blocked', 'observed', 'error'] as const;
const CHAT_ACTORS = ['user', 'agent'] as const;

@Injectable()
export class AgenstraManagerMetricsCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgenstraManagerMetricsCollectorService.name);
  private intervalHandle: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(AgentEntity)
    private readonly agentRepository: Repository<AgentEntity>,
    @InjectRepository(AgentMessageEntity)
    private readonly messageRepository: Repository<AgentMessageEntity>,
    @InjectRepository(AgentEgressEventEntity)
    private readonly egressEventsRepository: Repository<AgentEgressEventEntity>,
  ) {}

  onModuleInit(): void {
    const config = resolveOtelRuntimeConfig(process.env, 'agenstra-agent-manager');

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
      await this.collectAgentMetrics();
      await this.collectChatMetrics();
      await this.collectSecurityPolicyMetrics();
    } catch (error) {
      this.logger.warn(`Failed to collect Agenstra manager OTEL metrics: ${(error as Error).message}`);
    }
  }

  private async collectAgentMetrics(): Promise<void> {
    const agentRows = await this.agentRepository
      .createQueryBuilder('agent')
      .select('agent.agentType', 'agentType')
      .addSelect('agent.containerType', 'containerType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('agent.agentType')
      .addGroupBy('agent.containerType')
      .getRawMany<{ agentType: string; containerType: string; count: string }>();

    const byKey = new Map(agentRows.map((row) => [`${row.agentType}:${row.containerType}`, parseInt(row.count, 10)]));
    const agentTypes = new Set<string>([...agentRows.map((row) => row.agentType), 'opencode']);

    for (const agentType of agentTypes) {
      for (const containerType of Object.values(ContainerType)) {
        setGauge(METER_NAME, 'agenstra.manager.agents', byKey.get(`${agentType}:${containerType}`) ?? 0, {
          agent_type: agentType,
          container_type: containerType,
        });
      }
    }

    const [totalAgents, provisionedAgents] = await Promise.all([
      this.agentRepository.count(),
      this.agentRepository.createQueryBuilder('agent').where('agent.containerId IS NOT NULL').getCount(),
    ]);

    setGauge(METER_NAME, 'agenstra.manager.agents.total', totalAgents);
    setGauge(METER_NAME, 'agenstra.manager.agents.provisioned', provisionedAgents);
  }

  private async collectChatMetrics(): Promise<void> {
    const messageRows = await this.messageRepository
      .createQueryBuilder('message')
      .select('message.actor', 'actor')
      .addSelect('message.filtered', 'filtered')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(CHAR_LENGTH(message.message)), 0)', 'charCount')
      .addSelect(
        `COALESCE(SUM(
          CASE
            WHEN message.message IS NULL OR TRIM(message.message) = '' THEN 0
            ELSE COALESCE(ARRAY_LENGTH(REGEXP_SPLIT_TO_ARRAY(TRIM(message.message), '\\s+'), 1), 0)
          END
        ), 0)`,
        'wordCount',
      )
      .groupBy('message.actor')
      .addGroupBy('message.filtered')
      .getRawMany<{ actor: string; filtered: boolean | string; count: string; charCount: string; wordCount: string }>();

    const byKey = new Map(
      messageRows.map((row) => {
        const filtered = row.filtered === true || row.filtered === 'true' || row.filtered === '1';

        return [
          `${row.actor}:${filtered ? 'true' : 'false'}`,
          {
            count: parseInt(row.count ?? '0', 10),
            charCount: parseInt(row.charCount ?? '0', 10),
            wordCount: parseInt(row.wordCount ?? '0', 10),
          },
        ] as const;
      }),
    );

    for (const actor of CHAT_ACTORS) {
      for (const filtered of ['true', 'false'] as const) {
        const row = byKey.get(`${actor}:${filtered}`);
        const labels = { actor, filtered };

        setGauge(METER_NAME, 'agenstra.manager.chat_messages', row?.count ?? 0, labels);
        setGauge(METER_NAME, 'agenstra.manager.chat_words', row?.wordCount ?? 0, labels);
        setGauge(METER_NAME, 'agenstra.manager.chat_chars', row?.charCount ?? 0, labels);
      }
    }

    // Explicit filter-trigger totals (manager only stores a filtered flag, not drop vs flag).
    for (const actor of CHAT_ACTORS) {
      const filteredRow = byKey.get(`${actor}:true`);

      setGauge(METER_NAME, 'agenstra.manager.filter_triggers', filteredRow?.count ?? 0, {
        actor,
      });
    }
  }

  private async collectSecurityPolicyMetrics(): Promise<void> {
    const statusRows = await this.agentRepository
      .createQueryBuilder('agent')
      .select("COALESCE(agent.egressStatus, 'inactive')", 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy("COALESCE(agent.egressStatus, 'inactive')")
      .getRawMany<{ status: string; count: string }>();
    const byStatus = new Map(statusRows.map((row) => [row.status, parseInt(row.count ?? '0', 10)]));

    for (const status of EGRESS_STATUSES) {
      setGauge(METER_NAME, 'agenstra.manager.egress_guards', byStatus.get(status) ?? 0, { status });
    }

    const eventRows = await this.egressEventsRepository
      .createQueryBuilder('event')
      .select('event.kind', 'kind')
      .addSelect('event.decision', 'decision')
      .addSelect('COALESCE(SUM(event.count), 0)', 'count')
      .groupBy('event.kind')
      .addGroupBy('event.decision')
      .getRawMany<{ kind: string; decision: string; count: string }>();
    const byKey = new Map(eventRows.map((row) => [`${row.kind}:${row.decision}`, parseInt(row.count ?? '0', 10)]));

    for (const kind of EGRESS_KINDS) {
      for (const decision of EGRESS_DECISIONS) {
        setGauge(METER_NAME, 'agenstra.manager.egress_decisions', byKey.get(`${kind}:${decision}`) ?? 0, {
          kind,
          decision,
        });
      }
    }

    const ruleRow = await this.agentRepository
      .createQueryBuilder('agent')
      .select(
        "COALESCE(SUM(CASE WHEN jsonb_typeof(agent.messageFilters) = 'array' THEN jsonb_array_length(agent.messageFilters) ELSE 0 END), 0)",
        'count',
      )
      .getRawOne<{ count: string }>();

    setGauge(METER_NAME, 'agenstra.manager.message_filter_rules', parseInt(ruleRow?.count ?? '0', 10));
  }
}
