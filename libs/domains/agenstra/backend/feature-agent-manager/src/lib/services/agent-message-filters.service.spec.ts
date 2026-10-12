import { AgentMessageFiltersService } from './agent-message-filters.service';

describe('AgentMessageFiltersService', () => {
  const rules = [
    {
      name: 'Drop keys',
      pattern: 'BEGIN PRIVATE KEY',
      flags: 'g',
      direction: 'bidirectional',
      action: 'drop',
      enabled: true,
      source: 'global',
    },
    {
      name: 'Mask tokens',
      pattern: 'token-\\d+',
      flags: 'g',
      direction: 'incoming',
      action: 'replace',
      replacement: '[redacted]',
      enabled: true,
      source: 'workspace',
    },
    {
      name: 'Flag hello',
      pattern: 'hello',
      flags: 'gi',
      direction: 'outgoing',
      action: 'flag',
      enabled: true,
      source: 'environment',
    },
  ];
  let repository: { findById: jest.Mock; update: jest.Mock };
  let service: AgentMessageFiltersService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue({ id: 'agent-1', messageFilters: rules }),
      update: jest.fn().mockResolvedValue({}),
    };
    service = new AgentMessageFiltersService(repository as never);
  });

  it('returns not filtered without an agent id or rules', async () => {
    await expect(service.evaluate(undefined, 'x', 'incoming')).resolves.toEqual({ filtered: false });

    repository.findById.mockResolvedValue({ id: 'agent-2', messageFilters: null });
    await expect(service.evaluate('agent-2', 'BEGIN PRIVATE KEY', 'incoming')).resolves.toEqual({ filtered: false });
  });

  it('drops when a drop rule matches and reports the rule with its layer', async () => {
    await expect(service.evaluate('agent-1', 'token-1 BEGIN PRIVATE KEY', 'incoming')).resolves.toEqual({
      filtered: true,
      action: 'drop',
      reason: 'Drop keys (global)',
    });
  });

  it('replaces content and flags by direction', async () => {
    await expect(service.evaluate('agent-1', 'use token-42', 'incoming')).resolves.toEqual({
      filtered: true,
      action: 'flag',
      modifiedMessage: 'use [redacted]',
      reason: 'Mask tokens (workspace)',
    });
    await expect(service.evaluate('agent-1', 'Hello world', 'outgoing')).resolves.toEqual({
      filtered: true,
      action: 'flag',
      reason: 'Flag hello (environment)',
    });
    await expect(service.evaluate('agent-1', 'use token-42', 'outgoing')).resolves.toEqual({ filtered: false });
  });

  it('caches rules per agent and refreshes them on store', async () => {
    await service.evaluate('agent-1', 'a', 'incoming');
    await service.evaluate('agent-1', 'b', 'incoming');

    expect(repository.findById).toHaveBeenCalledTimes(1);

    const stored = await service.store('agent-1', [
      { name: 'Only', pattern: 'x', action: 'drop', source: 'workspace' },
      { name: 'Invalid', pattern: '(', action: 'drop' },
    ]);

    expect(stored).toEqual([
      expect.objectContaining({
        name: 'Only',
        flags: 'g',
        direction: 'bidirectional',
        enabled: true,
        source: 'workspace',
      }),
    ]);
    expect(repository.update).toHaveBeenCalledWith('agent-1', { messageFilters: stored });
    await expect(service.evaluate('agent-1', 'x', 'outgoing')).resolves.toEqual(
      expect.objectContaining({ action: 'drop', reason: 'Only (workspace)' }),
    );
    expect(repository.findById).toHaveBeenCalledTimes(1);

    service.invalidate('agent-1');
    await service.evaluate('agent-1', 'x', 'outgoing');
    expect(repository.findById).toHaveBeenCalledTimes(2);
  });

  it('fails open (not filtered) when rules cannot be loaded', async () => {
    repository.findById.mockRejectedValue(new Error('db down'));

    await expect(service.evaluate('agent-3', 'x', 'incoming')).resolves.toEqual({ filtered: false });
  });
});
