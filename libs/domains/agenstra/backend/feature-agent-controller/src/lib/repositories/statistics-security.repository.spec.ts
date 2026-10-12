import { StatisticsSecurityRepository } from './statistics-security.repository';

function queryBuilder(results: unknown[] = []) {
  const qb: Record<string, jest.Mock> = {};
  const chain = [
    'where',
    'andWhere',
    'select',
    'addSelect',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'limit',
    'skip',
    'take',
    'innerJoin',
    'insert',
    'into',
    'values',
    'orIgnore',
    'returning',
  ];

  for (const method of chain) {
    qb[method] = jest.fn(() => qb);
  }

  let call = 0;

  qb['getRawMany'] = jest.fn(async () => results[call++] ?? []);
  qb['getCount'] = jest.fn(async () => 0);
  qb['getMany'] = jest.fn(async () => []);
  qb['execute'] = jest.fn(async () => ({ raw: results[0] ?? [] }));

  return qb;
}

describe('StatisticsSecurityRepository', () => {
  function build(egressResults: unknown[] = [], dropResults: unknown[] = [], flagResults: unknown[] = []) {
    const egressQb = queryBuilder(egressResults);
    const egress = {
      createQueryBuilder: jest.fn(() => egressQb),
      create: jest.fn((value: unknown) => value),
      find: jest.fn(),
    };
    const drops = { createQueryBuilder: jest.fn(() => queryBuilder(dropResults)) };
    const flags = { createQueryBuilder: jest.fn(() => queryBuilder(flagResults)) };
    const repository = new StatisticsSecurityRepository(egress as never, drops as never, flags as never, {} as never);

    return { repository, egressQb };
  }

  it('returns empty aggregates without client scope', async () => {
    const { repository } = build();

    await expect(repository.queryEgressAggregate({ statisticsClientIds: [] })).resolves.toEqual({
      egressAllowedCount: 0,
      egressBlockedCount: 0,
      egressObservedCount: 0,
      egressGuardErrorCount: 0,
      egressBreakdown: [],
      egressTopBlockedHosts: [],
      egressRulesBreakdown: [],
    });
    await expect(repository.querySecuritySeries({ statisticsClientIds: [], groupBy: 'day' })).resolves.toEqual([]);
    await expect(repository.queryEgressEvents({ statisticsClientIds: [], limit: 10, offset: 0 })).resolves.toEqual({
      rows: [],
      total: 0,
    });
    await expect(repository.insertEgressEvents([])).resolves.toEqual([]);
  });

  it('sums decisions per kind and exposes top hosts and rules', async () => {
    const { repository, egressQb } = build([
      [
        { kind: 'web', decision: 'blocked', count: '3' },
        { kind: 'dns', decision: 'blocked', count: '2' },
        { kind: 'web', decision: 'allowed', count: '40' },
        { kind: 'guard', decision: 'error', count: '1' },
      ],
      [{ host: 'example.org', count: '5' }],
      [{ rule: 'deny_host', count: '5' }],
    ]);

    const aggregate = await repository.queryEgressAggregate({ statisticsClientIds: ['sc1'], agentId: 'agent-1' });

    expect(aggregate).toEqual(
      expect.objectContaining({
        egressAllowedCount: 40,
        egressBlockedCount: 5,
        egressObservedCount: 0,
        egressGuardErrorCount: 1,
        egressTopBlockedHosts: [{ host: 'example.org', count: 5 }],
        egressRulesBreakdown: [{ rule: 'deny_host', count: 5 }],
      }),
    );
    expect(egressQb['andWhere']).toHaveBeenCalledWith(expect.stringContaining('original_agent_id = :agentId'), {
      agentId: 'agent-1',
      ids: ['sc1'],
    });
  });

  it('merges filter and egress buckets into one ordered security series', async () => {
    const { repository } = build(
      [
        [
          { period: '2026-10-12T00:00:00.000Z', decision: 'blocked', count: '4' },
          { period: new Date('2026-10-11T00:00:00.000Z'), decision: 'allowed', count: '9' },
        ],
      ],
      [[{ period: '2026-10-12T00:00:00.000Z', count: '2' }]],
      [[{ period: '2026-10-10T00:00:00.000Z', count: '1' }]],
    );

    await expect(
      repository.querySecuritySeries({ statisticsClientIds: ['sc1'], groupBy: 'day', from: '2026-10-01' }),
    ).resolves.toEqual([
      {
        period: '2026-10-10T00:00:00.000Z',
        filterDrops: 0,
        filterFlags: 1,
        egressAllowed: 0,
        egressBlocked: 0,
        egressObserved: 0,
      },
      {
        period: '2026-10-11T00:00:00.000Z',
        filterDrops: 0,
        filterFlags: 0,
        egressAllowed: 9,
        egressBlocked: 0,
        egressObserved: 0,
      },
      {
        period: '2026-10-12T00:00:00.000Z',
        filterDrops: 2,
        filterFlags: 0,
        egressAllowed: 0,
        egressBlocked: 4,
        egressObserved: 0,
      },
    ]);
  });

  it('inserts with conflict skipping and maps returned rows', async () => {
    const { repository, egressQb } = build([
      [
        {
          id: 'e1',
          statistics_client_id: 'sc1',
          statistics_agent_id: 'sa1',
          source_seq: 5,
          kind: 'web',
          decision: 'blocked',
          count: 2,
          bytes_in: '1',
          bytes_out: '2',
          first_seen_at: '2026-10-12T10:00:00.000Z',
          occurred_at: '2026-10-12T10:00:05.000Z',
        },
      ],
    ]);

    const inserted = await repository.insertEgressEvents([
      {
        statisticsClientId: 'sc1',
        statisticsAgentId: 'sa1',
        sourceSeq: '5',
        kind: 'web',
        decision: 'blocked',
        count: 2,
        bytesIn: '1',
        bytesOut: '2',
        firstSeenAt: new Date(),
        occurredAt: new Date(),
      },
    ]);

    expect(egressQb['orIgnore']).toHaveBeenCalled();
    expect(inserted).toEqual([
      expect.objectContaining({
        id: 'e1',
        sourceSeq: '5',
        statisticsAgentId: 'sa1',
        count: 2,
        occurredAt: new Date('2026-10-12T10:00:05.000Z'),
      }),
    ]);
  });
});
