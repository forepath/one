import { NotFoundException } from '@nestjs/common';

import { EgressEventsIngestService } from './egress-events-ingest.service';

function event(seq: string, overrides: Record<string, unknown> = {}) {
  return {
    seq,
    agentId: 'agent-1',
    kind: 'web',
    decision: 'blocked',
    host: 'example.org',
    rule: 'deny_host',
    matchedEntry: 'example.org',
    matchedSource: 'global',
    method: 'CONNECT',
    httpStatus: null,
    sampleUrl: null,
    count: 2,
    bytesIn: 0,
    bytesOut: 0,
    firstSeenAt: '2026-10-12T10:00:00.000Z',
    lastSeenAt: '2026-10-12T10:00:05.000Z',
    mode: 'enforce',
    policyRevision: 'rev',
    message: null,
    ...overrides,
  };
}

describe('EgressEventsIngestService', () => {
  let cursors: Record<string, jest.Mock>;
  let clients: Record<string, jest.Mock>;
  let proxy: Record<string, jest.Mock>;
  let statistics: Record<string, jest.Mock>;
  let publisher: Record<string, jest.Mock>;
  let syncTargets: Record<string, jest.Mock>;
  let service: EgressEventsIngestService;

  beforeEach(() => {
    cursors = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: unknown) => value),
      save: jest.fn(async (value: unknown) => value),
      find: jest.fn().mockResolvedValue([]),
    };
    clients = { findAllIds: jest.fn().mockResolvedValue(['c1', 'c2', 'c3']) };
    proxy = { listClientEgressEvents: jest.fn() };
    statistics = {
      recordEgressEvents: jest.fn(async (_clientId: string, events: Array<{ seq: string }>) =>
        events.map((entry) => ({ sourceSeq: entry.seq })),
      ),
    };
    publisher = { publishEgressDecision: jest.fn(), publishEgressGuardFailed: jest.fn() };
    syncTargets = { markAgentPending: jest.fn().mockResolvedValue(undefined) };
    service = new EgressEventsIngestService(
      cursors as never,
      clients as never,
      proxy as never,
      statistics as never,
      publisher as never,
      syncTargets as never,
    );
  });

  it('pages the manager feed from the stored cursor and advances it', async () => {
    cursors.findOne.mockResolvedValue({ clientId: 'c1', lastSeq: '10' });
    proxy.listClientEgressEvents
      .mockResolvedValueOnce({
        events: [event('11'), event('12', { decision: 'allowed' })],
        nextSeq: '12',
        hasMore: true,
      })
      .mockResolvedValueOnce({ events: [], nextSeq: '12', hasMore: false });

    await expect(service.ingestClient('c1')).resolves.toBe(2);

    expect(proxy.listClientEgressEvents).toHaveBeenNthCalledWith(1, 'c1', '10', 500);
    expect(proxy.listClientEgressEvents).toHaveBeenNthCalledWith(2, 'c1', '12', 500);
    expect(cursors.save).toHaveBeenCalledWith(expect.objectContaining({ lastSeq: '12', lastError: null }));
    expect(publisher.publishEgressDecision).toHaveBeenCalledTimes(1);
    expect(publisher.publishEgressDecision).toHaveBeenCalledWith(
      'egress.blocked',
      'c1',
      expect.objectContaining({ host: 'example.org', count: 2, rule: 'deny_host' }),
    );
  });

  it('aggregates notifications per destination and caps them per run', async () => {
    const many = Array.from({ length: 30 }, (_, index) => event(String(index + 1), { host: `h${index}.example` }));

    proxy.listClientEgressEvents.mockResolvedValue({
      events: [...many, event('99', { host: 'h0.example', count: 5 }), event('100', { decision: 'observed' })],
      nextSeq: '100',
      hasMore: false,
    });

    await service.ingestClient('c1');

    const blocked = publisher.publishEgressDecision.mock.calls.filter((call) => call[0] === 'egress.blocked');

    expect(blocked).toHaveLength(25);
    expect(blocked[0][2]).toEqual(expect.objectContaining({ host: 'h0.example', count: 7 }));
    expect(blocked[24][2]).toEqual(expect.objectContaining({ omittedDecisions: 5 }));
    expect(publisher.publishEgressDecision).toHaveBeenCalledWith('egress.observed', 'c1', expect.any(Object));
  });

  it('skips notifications for rows that were already ingested', async () => {
    statistics.recordEgressEvents.mockResolvedValue([]);
    proxy.listClientEgressEvents.mockResolvedValue({ events: [event('1')], nextSeq: '1', hasMore: false });

    await service.ingestClient('c1');

    expect(publisher.publishEgressDecision).not.toHaveBeenCalled();
  });

  it('notifies guard failures and re-syncs recovered guards', async () => {
    proxy.listClientEgressEvents.mockResolvedValue({
      events: [
        event('1', {
          kind: 'guard',
          decision: 'error',
          host: null,
          rule: 'guard',
          message: 'guard_missing: recreated',
        }),
        event('2', {
          kind: 'guard',
          decision: 'error',
          host: null,
          rule: 'guard',
          message: 'process_restarted: squid',
        }),
      ],
      nextSeq: '2',
      hasMore: false,
    });

    await service.ingestClient('c1');

    expect(publisher.publishEgressGuardFailed).toHaveBeenCalledTimes(2);
    expect(syncTargets.markAgentPending).toHaveBeenCalledTimes(1);
    expect(syncTargets.markAgentPending).toHaveBeenCalledWith('c1', 'agent-1');
  });

  it('records errors on the cursor (older managers without the feed)', async () => {
    proxy.listClientEgressEvents.mockRejectedValue(new NotFoundException('Cannot GET'));

    await expect(service.ingestClient('c1')).resolves.toBe(0);
    expect(cursors.save).toHaveBeenCalledWith(expect.objectContaining({ lastError: 'egress feed not available' }));
  });

  it('selects never-polled then least recently polled workspaces', async () => {
    cursors.find.mockResolvedValue([
      { clientId: 'c1', updatedAt: new Date(3000) },
      { clientId: 'c2', updatedAt: new Date(1000) },
    ]);

    await expect(service.findClientIdsDue(2)).resolves.toEqual(['c3', 'c2']);
    await expect(service.findClientIdsDue(5)).resolves.toEqual(['c1', 'c2', 'c3']);
    await expect(service.findClientIdsDue(0)).resolves.toEqual([]);
  });
});
