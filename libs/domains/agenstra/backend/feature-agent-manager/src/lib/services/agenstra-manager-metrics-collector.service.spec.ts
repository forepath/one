const setGauge = jest.fn();
const isOtelEffectivelyEnabled = jest.fn(() => true);
const resolveOtelRuntimeConfig = jest.fn(() => ({ enabled: true }));

jest.mock('@forepath/shared/backend/util-otel', () => ({
  isOtelEffectivelyEnabled,
  resolveOtelRuntimeConfig,
  setGauge,
}));

jest.mock('../entities/agent.entity', () => ({
  ContainerType: {
    GENERIC: 'generic',
    DOCKER: 'docker',
    TERRAFORM: 'terraform',
    KUBERNETES: 'kubernetes',
  },
  AgentEntity: class AgentEntity {},
}));

import { AgenstraManagerMetricsCollectorService } from './agenstra-manager-metrics-collector.service';

describe('AgenstraManagerMetricsCollectorService', () => {
  const agentCreateQueryBuilder = jest.fn();
  const messageCreateQueryBuilder = jest.fn();
  const filterCreateQueryBuilder = jest.fn();
  const agentRepository = {
    createQueryBuilder: agentCreateQueryBuilder,
    count: jest.fn(),
  };
  const messageRepository = {
    createQueryBuilder: messageCreateQueryBuilder,
  };
  const filterRulesRepository = {
    createQueryBuilder: filterCreateQueryBuilder,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    isOtelEffectivelyEnabled.mockReturnValue(true);
    resolveOtelRuntimeConfig.mockReturnValue({ enabled: true });
  });

  it('sets agent, chat, filter-trigger, and filter-rule gauges when OTEL is enabled', async () => {
    agentCreateQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(2),
      getRawMany: jest.fn().mockResolvedValue([{ agentType: 'opencode', containerType: 'docker', count: '2' }]),
    });
    agentRepository.count.mockResolvedValue(3);
    messageCreateQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { actor: 'user', filtered: false, count: '10', charCount: '100', wordCount: '20' },
        { actor: 'agent', filtered: true, count: '2', charCount: '40', wordCount: '8' },
      ]),
    });
    filterCreateQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ direction: 'incoming', filterType: 'drop', count: '3' }]),
    });

    const service = new AgenstraManagerMetricsCollectorService(
      agentRepository as never,
      messageRepository as never,
      filterRulesRepository as never,
    );

    await (service as unknown as { collectMetrics: () => Promise<void> }).collectMetrics();

    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.manager.agents', 2, {
      agent_type: 'opencode',
      container_type: 'docker',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.manager.agents.total', 3);
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.manager.agents.provisioned', 2);
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.manager.chat_messages', 10, {
      actor: 'user',
      filtered: 'false',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.manager.chat_words', 20, {
      actor: 'user',
      filtered: 'false',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.manager.chat_chars', 100, {
      actor: 'user',
      filtered: 'false',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.manager.filter_triggers', 2, {
      actor: 'agent',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.manager.filter_rules', 3, {
      direction: 'incoming',
      filter_type: 'drop',
    });
    expect(setGauge).toHaveBeenCalledWith('forepath.agenstra', 'agenstra.manager.filter_rules', 0, {
      direction: 'outgoing',
      filter_type: 'filter',
    });
  });
});
