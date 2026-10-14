const setGauge = jest.fn();
const isOtelEffectivelyEnabled = jest.fn(() => true);
const resolveOtelRuntimeConfig = jest.fn(() => ({ enabled: true }));

jest.mock('@forepath/shared/backend/util-otel', () => ({
  isOtelEffectivelyEnabled,
  resolveOtelRuntimeConfig,
  setGauge,
}));

jest.mock('../repositories/clients.repository', () => ({
  ClientsRepository: class ClientsRepository {},
}));

jest.mock('../repositories/statistics.repository', () => ({
  StatisticsRepository: class StatisticsRepository {},
}));

jest.mock('../repositories/statistics-security.repository', () => ({
  StatisticsSecurityRepository: class StatisticsSecurityRepository {},
}));

jest.mock('../entities/ticket.enums', () => ({
  TicketStatus: {
    DRAFT: 'draft',
    TODO: 'todo',
    IN_PROGRESS: 'in_progress',
    PROTOTYPE: 'prototype',
    DONE: 'done',
    CLOSED: 'closed',
  },
}));

jest.mock('../entities/statistics-chat-io.entity', () => ({
  ChatDirection: { INPUT: 'input', OUTPUT: 'output' },
  StatisticsInteractionKind: {
    CHAT: 'chat',
    PROMPT_ENHANCEMENT: 'prompt_enhancement',
    TICKET_BODY_GENERATION: 'ticket_body_generation',
    AUTO_CONTEXT_ENRICHMENT: 'auto_context_enrichment',
    AUTONOMOUS_TICKET_RUN: 'autonomous_ticket_run',
    AUTONOMOUS_TICKET_RUN_TURN: 'autonomous_ticket_run_turn',
    AUTONOMOUS_TICKET_COMMIT_MESSAGE: 'autonomous_ticket_commit_message',
  },
}));

import { AgenstraMetricsCollectorService } from './agenstra-metrics-collector.service';

describe('AgenstraMetricsCollectorService', () => {
  const clientsRepository = {
    count: jest.fn(),
    findAllIds: jest.fn(),
  };
  const createQueryBuilder = jest.fn();
  const ticketRepository = {
    createQueryBuilder,
  };
  const statisticsRepository = {
    countChatIoGroupedForMetrics: jest.fn(),
    countFilterDropsGroupedForMetrics: jest.fn(),
    countFilterFlagsGroupedForMetrics: jest.fn(),
  };
  const statisticsSecurityRepository = {
    countEgressEventsGroupedForMetrics: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    isOtelEffectivelyEnabled.mockReturnValue(true);
    resolveOtelRuntimeConfig.mockReturnValue({ enabled: true });
  });

  it('sets workspace, ticket, chat, filter-trigger, and egress gauges when OTEL is enabled', async () => {
    clientsRepository.count.mockResolvedValue(1);
    clientsRepository.findAllIds.mockResolvedValue(['client-a']);
    createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ clientId: 'client-a', status: 'todo', count: '4' }]),
    });
    statisticsRepository.countChatIoGroupedForMetrics.mockResolvedValue([
      {
        clientId: 'client-a',
        direction: 'input',
        interactionKind: 'chat',
        count: 12,
        wordCount: 100,
        charCount: 500,
      },
    ]);
    statisticsRepository.countFilterDropsGroupedForMetrics.mockResolvedValue([
      { clientId: 'client-a', direction: 'incoming', filterType: 'drop', count: 3 },
    ]);
    statisticsRepository.countFilterFlagsGroupedForMetrics.mockResolvedValue([
      { clientId: 'client-a', direction: 'outgoing', filterType: 'filter', count: 2 },
    ]);
    statisticsSecurityRepository.countEgressEventsGroupedForMetrics.mockResolvedValue([
      { clientId: 'client-a', kind: 'web', decision: 'blocked', count: 7 },
    ]);

    const service = new AgenstraMetricsCollectorService(
      clientsRepository as never,
      ticketRepository as never,
      statisticsRepository as never,
      statisticsSecurityRepository as never,
    );

    await (service as unknown as { collectMetrics: () => Promise<void> }).collectMetrics();

    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.workspaces', 1);
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.tickets', 4, {
      client_id: 'client-a',
      status: 'todo',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.chat_messages', 12, {
      client_id: 'client-a',
      direction: 'input',
      interaction_kind: 'chat',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.chat_words', 100, {
      client_id: 'client-a',
      direction: 'input',
      interaction_kind: 'chat',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.chat_chars', 500, {
      client_id: 'client-a',
      direction: 'input',
      interaction_kind: 'chat',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.filter_drops', 3, {
      client_id: 'client-a',
      direction: 'incoming',
      filter_type: 'drop',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.filter_flags', 2, {
      client_id: 'client-a',
      direction: 'outgoing',
      filter_type: 'filter',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.egress_events', 7, {
      client_id: 'client-a',
      kind: 'web',
      decision: 'blocked',
    });
    expect(setGauge).not.toHaveBeenCalledWith(
      'forepath.agenstra',
      'agenstra.filter_rules',
      expect.anything(),
      expect.anything(),
    );
  });
});
