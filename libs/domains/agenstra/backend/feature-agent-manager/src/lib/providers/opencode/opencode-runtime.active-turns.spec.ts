import { AgentActiveTurnsService } from '../../services/agent-active-turns.service';
import { AgentToolCallsService } from '../../services/agent-tool-calls.service';

import type { OpenCodeClientFactory } from './opencode-client.factory';
import type { OpenCodeEventBridge } from './opencode-event-bridge';
import type { OpenCodeEventMapper } from './opencode-event-mapper';
import { OpenCodeRuntimeService } from './opencode-runtime.service';
import type { OpenCodeSessionService } from './opencode-session.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- the drain itself is stubbed */

describe('OpenCodeRuntimeService active turns', () => {
  const chatId = '33333333-3333-4333-8333-333333333333';
  const key = { agentId: 'agent-1', containerId: 'container-1', resumeSessionSuffix: `-chat-${chatId}` };
  let turns: AgentActiveTurnsService;
  let runtime: OpenCodeRuntimeService;

  beforeEach(() => {
    turns = new AgentActiveTurnsService();
    runtime = new OpenCodeRuntimeService(
      {} as OpenCodeClientFactory,
      {} as OpenCodeSessionService,
      {} as OpenCodeEventBridge,
      {} as OpenCodeEventMapper,
      undefined,
      turns,
    );
  });

  it('registers the turn of its session for the whole drain', async () => {
    const seen: unknown[] = [];

    jest.spyOn(runtime as any, 'drainTurn').mockImplementation(async function* () {
      seen.push(turns.callingContext('agent-1'));
      yield { type: 'result', result: 'ok' };
    });

    await runtime.sendMessage(key, 'hi');

    expect(seen).toEqual([{ kind: 'visible', context: { kind: 'chat', chatId } }]);
    expect(turns.callingContext('agent-1')).toEqual({ kind: 'idle' });
  });

  it('ends the turn when the drain fails', async () => {
    jest.spyOn(runtime as any, 'drainTurn').mockImplementation(async function* () {
      yield* [];
      throw new Error('prompt failed');
    });

    await expect(runtime.sendMessage({ ...key, resumeSessionSuffix: '-task-1' }, 'hi')).rejects.toThrow(
      'prompt failed',
    );
    expect(turns.callingContext('agent-1')).toEqual({ kind: 'idle' });
  });

  it('runs prompts of one session one after another, other sessions in parallel', async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    jest.spyOn(runtime as any, 'drainTurn').mockImplementation(async function* (_key: unknown, message: unknown) {
      order.push(`start:${String(message)}`);

      if (message === 'first') {
        await firstBlocked;
      }

      order.push(`end:${String(message)}`);
      yield { type: 'result', result: String(message) };
    });

    const first = runtime.sendMessage(key, 'first');
    const second = runtime.sendMessage(key, 'second');
    const other = runtime.sendMessage({ ...key, resumeSessionSuffix: '-task-1' }, 'other');

    await other;
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual(['start:first', 'start:other', 'end:other']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['start:first', 'start:other', 'end:other', 'end:first', 'start:second', 'end:second']);
  });

  it('feeds every worker event to the tool-call tracking', () => {
    const toolCalls = new AgentToolCallsService();
    const addTap = jest.fn();
    const observe = jest.spyOn(toolCalls, 'observe');

    new OpenCodeRuntimeService(
      {} as OpenCodeClientFactory,
      {} as OpenCodeSessionService,
      { addTap } as unknown as OpenCodeEventBridge,
      {} as OpenCodeEventMapper,
      undefined,
      turns,
      toolCalls,
    );

    const event = { type: 'session.idle', properties: { sessionID: 'ses-1' } };

    addTap.mock.calls[0][0]('agent-1', event);

    expect(observe).toHaveBeenCalledWith('agent-1', event);
  });

  it('registers its own prompt message (earliest exact match) as root for the tickets it carries', async () => {
    const toolCalls = new AgentToolCallsService();
    const register = jest.spyOn(toolCalls, 'registerPromptRoot');
    const withCalls = new OpenCodeRuntimeService(
      {} as OpenCodeClientFactory,
      {} as OpenCodeSessionService,
      { addTap: jest.fn() } as unknown as OpenCodeEventBridge,
      {} as OpenCodeEventMapper,
      undefined,
      turns,
      toolCalls,
    );
    const prompt = 'Context ticket: ctx-AbCdEfGhIjKlMnOpQrStUvWx\nDo it';
    const client = {
      session: {
        messages: jest.fn().mockResolvedValue({
          data: [
            { info: { id: 'msg-old', sessionID: 's', role: 'user' }, parts: [{ type: 'text', text: 'earlier' }] },
            { info: { id: 'msg-own', sessionID: 's', role: 'user' }, parts: [{ type: 'text', text: prompt }] },
            { info: { id: 'msg-copy', sessionID: 's', role: 'user' }, parts: [{ type: 'text', text: prompt }] },
          ],
        }),
      },
    };

    await (withCalls as any).registerPromptRoot(client, 'agent-1', 's', prompt);

    expect(register).toHaveBeenCalledWith('agent-1', 's', 'msg-own', prompt);

    await (withCalls as any).registerPromptRoot(client, 'agent-1', 's', 'no ticket here');
    expect(client.session.messages).toHaveBeenCalledTimes(1);
  });
});
