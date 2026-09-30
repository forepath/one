import { isOtelEffectivelyEnabled, resolveOtelRuntimeConfig, setGauge } from '@forepath/shared/backend/util-otel';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgentMessageEntity } from '../entities/agent-message.entity';
import { AgentEntity, ContainerType } from '../entities/agent.entity';
import {
  RegexFilterRuleDirection,
  RegexFilterRuleEntity,
  RegexFilterRuleType,
} from '../entities/regex-filter-rule.entity';

const METER_NAME = 'forepath.agenstra';
const POLL_INTERVAL_MS = 60_000;

const FILTER_DIRECTIONS: RegexFilterRuleDirection[] = ['incoming', 'outgoing', 'bidirectional'];
const FILTER_TYPES: RegexFilterRuleType[] = ['none', 'filter', 'drop'];
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
    @InjectRepository(RegexFilterRuleEntity)
    private readonly filterRulesRepository: Repository<RegexFilterRuleEntity>,
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
      await this.collectFilterRuleMetrics();
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

  private async collectFilterRuleMetrics(): Promise<void> {
    const filterRuleRows = await this.filterRulesRepository
      .createQueryBuilder('rule')
      .select('rule.direction', 'direction')
      .addSelect('rule.filterType', 'filterType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('rule.direction')
      .addGroupBy('rule.filterType')
      .getRawMany<{ direction: string; filterType: string; count: string }>();

    const byKey = new Map(
      filterRuleRows.map((row) => [`${row.direction}:${row.filterType}`, parseInt(row.count ?? '0', 10)]),
    );

    for (const direction of FILTER_DIRECTIONS) {
      for (const filterType of FILTER_TYPES) {
        setGauge(METER_NAME, 'agenstra.manager.filter_rules', byKey.get(`${direction}:${filterType}`) ?? 0, {
          direction,
          filter_type: filterType,
        });
      }
    }
  }
}
