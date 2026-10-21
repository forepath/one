import { NotFoundException } from '@nestjs/common';

import { AGENT_CONTEXT_ACCESS_REQUEST_TTL_MS } from '../constants/agent-context.constants';

import { AgentContextAccessService } from './agent-context-access.service';

describe('AgentContextAccessService', () => {
  let service: AgentContextAccessService;
  const input = { agentId: 'agent-1', ticket: 'ctx-1', refs: [{ kind: 'ticket' as const, sha: 'abcd1234' }] };

  beforeEach(() => {
    service = new AgentContextAccessService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates pending requests with ctx_ ids', () => {
    const request = service.create(input);

    expect(request.id).toMatch(/^ctx_[0-9a-f]{24}$/);
    expect(request.decision).toBe('pending');
    expect(AgentContextAccessService.isAccessRequestId(request.id)).toBe(true);
    expect(AgentContextAccessService.isAccessRequestId('per_123')).toBe(false);
  });

  it('scopes requests to their agent', () => {
    const request = service.create(input);

    expect(() => service.get('agent-2', request.id)).toThrow(NotFoundException);
  });

  it('applies the first decision only', () => {
    const request = service.create(input);

    expect(service.decide('agent-1', request.id, 'once').decision).toBe('granted');
    expect(service.decide('agent-1', request.id, 'reject')).toMatchObject({ decision: 'granted', reply: 'once' });
  });

  it('wakes waiters when a decision arrives', async () => {
    const request = service.create(input);
    const waiting = service.waitForDecision('agent-1', request.id, 10_000);

    service.decide('agent-1', request.id, 'reject');

    await expect(waiting).resolves.toMatchObject({ decision: 'denied', reply: 'reject' });
  });

  it('returns the pending record when the wait times out', async () => {
    jest.useFakeTimers();
    const request = service.create(input);
    const waiting = service.waitForDecision('agent-1', request.id, 1_000);

    jest.advanceTimersByTime(1_000);

    await expect(waiting).resolves.toMatchObject({ decision: 'pending' });
    // A later decision still resolves new waiters.
    service.decide('agent-1', request.id, 'always');
    await expect(service.waitForDecision('agent-1', request.id, 1_000)).resolves.toMatchObject({
      decision: 'granted',
    });
  });

  it('expires undecided requests', () => {
    jest.useFakeTimers({ now: 5_000 });
    const request = service.create(input);

    jest.setSystemTime(5_000 + AGENT_CONTEXT_ACCESS_REQUEST_TTL_MS + 1);

    expect(() => service.get('agent-1', request.id)).toThrow(NotFoundException);
  });
});
