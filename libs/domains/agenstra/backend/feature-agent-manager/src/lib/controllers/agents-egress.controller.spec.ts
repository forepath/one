import { BadRequestException } from '@nestjs/common';

import { AgentsEgressController } from './agents-egress.controller';

describe('AgentsEgressController', () => {
  const row = {
    seq: '7',
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
    bytesIn: '10',
    bytesOut: '20',
    firstSeenAt: new Date(1),
    lastSeenAt: new Date(2),
    mode: 'enforce',
    policyRevision: 'rev',
    message: null,
  };
  let agents: Record<string, jest.Mock>;
  let events: Record<string, jest.Mock>;
  let egress: Record<string, jest.Mock>;
  let controller: AgentsEgressController;

  beforeEach(() => {
    agents = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'agent-1',
        egressPolicy: { mode: 'enforce' },
        messageFilters: [{ name: 'A', pattern: 'a', action: 'drop', source: 'global' }],
      }),
    };
    events = {
      findAfter: jest.fn().mockResolvedValue([row, { ...row, seq: '8' }]),
      findRecentForAgent: jest.fn().mockResolvedValue([row]),
    };
    egress = { describe: jest.fn().mockResolvedValue({ status: 'active', mode: 'enforce' }) };
    controller = new AgentsEgressController(agents as never, events as never, egress as never);
  });

  it('pages events after a cursor', async () => {
    const page = await controller.listEvents('5', 1);

    expect(events.findAfter).toHaveBeenCalledWith('5', 2, undefined);
    expect(page).toEqual({
      events: [expect.objectContaining({ seq: '7', bytesIn: 10, bytesOut: 20, count: 2 })],
      nextSeq: '7',
      hasMore: true,
    });
  });

  it('defaults and clamps paging parameters', async () => {
    events.findAfter.mockResolvedValue([]);

    await expect(controller.listEvents(undefined, 999999)).resolves.toEqual({
      events: [],
      nextSeq: '0',
      hasMore: false,
    });
    expect(events.findAfter).toHaveBeenCalledWith('0', 1001, undefined);
  });

  it('rejects invalid cursors and agent ids', async () => {
    await expect(controller.listEvents('-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.listEvents('1', 10, 'nope')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the agent egress details with live status', async () => {
    const details = await controller.getAgentEgress('agent-1');

    expect(egress.describe).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-1' }), true);
    expect(details).toEqual({
      agentId: 'agent-1',
      status: { status: 'active', mode: 'enforce' },
      policy: { mode: 'enforce' },
      messageFilters: [expect.objectContaining({ name: 'A', source: 'global' })],
      recentEvents: [expect.objectContaining({ seq: '7' })],
    });
  });
});
