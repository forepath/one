import type { OpenCodeClientFactory } from './opencode-client.factory';
import type { OpenCodeEventBridge } from './opencode-event-bridge';
import type { OpenCodeEventMapper } from './opencode-event-mapper';
import { OpenCodeRuntimeService } from './opencode-runtime.service';
import type { OpenCodeSessionService } from './opencode-session.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- only the session start of the drain is exercised */

describe('OpenCodeRuntimeService automation sessions', () => {
  const stop = new Error('stop after the session was resolved');
  let sessions: { clearSession: jest.Mock; getOrCreateSessionId: jest.Mock };
  let runtime: OpenCodeRuntimeService;

  beforeEach(() => {
    sessions = {
      clearSession: jest.fn().mockResolvedValue(undefined),
      getOrCreateSessionId: jest.fn().mockResolvedValue('ses-1'),
    };
    runtime = new OpenCodeRuntimeService(
      {
        ensureInstanceReady: jest.fn().mockResolvedValue(undefined),
        getClient: jest.fn().mockRejectedValue(stop),
      } as unknown as OpenCodeClientFactory,
      sessions as unknown as OpenCodeSessionService,
      {} as OpenCodeEventBridge,
      {} as OpenCodeEventMapper,
    );
  });

  async function startTurn(resumeSessionSuffix: string, options: { continue?: boolean }): Promise<void> {
    const drain = (runtime as any).drainTurn(
      { agentId: 'agent-1', containerId: 'container-1', resumeSessionSuffix },
      'prompt',
      options,
    ) as AsyncIterator<unknown>;

    await expect(drain.next()).rejects.toBe(stop);
  }

  it('starts every ticket automation run in a fresh session', async () => {
    await startTurn('-ticket-auto-loop', { continue: false });

    expect(sessions.clearSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', resumeSessionSuffix: '-ticket-auto-loop' }),
    );
    expect(sessions.clearSession.mock.invocationCallOrder[0]).toBeLessThan(
      sessions.getOrCreateSessionId.mock.invocationCallOrder[0],
    );
  });

  it('continues the run session on later turns', async () => {
    await startTurn('-ticket-auto-loop', { continue: true });

    expect(sessions.clearSession).not.toHaveBeenCalled();
  });

  it('keeps task and chat sessions (their history is intended)', async () => {
    await startTurn('-task-11111111-1111-4111-8111-111111111111', { continue: false });
    await startTurn('-chat-22222222-2222-4222-8222-222222222222', { continue: false });

    expect(sessions.clearSession).not.toHaveBeenCalled();
  });
});
