import { EventEmitter } from 'events';

import { AuthenticationType } from '@forepath/identity/backend';
import {
  BadGatewayException,
  GatewayTimeoutException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';

import { RemoteAgentsSessionService, RemoteChatTurnAbortedError } from './remote-agents-session.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- minimal socket.io client fake */

class FakeRemoteSocket extends EventEmitter {
  readonly sent: Array<{ event: string; payload: unknown }> = [];
  disconnected = false;

  override emit(event: string, payload?: unknown): boolean {
    this.sent.push({ event, payload });

    if (event === 'login') {
      setImmediate(() => super.emit('loginSuccess'));
    }

    return true;
  }

  push(event: string, payload: unknown): void {
    super.emit(event, payload);
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

let fakeSocket: FakeRemoteSocket;

jest.mock('@forepath/shared/backend/util-http-context', () => ({
  createCorrelationAwareSocketIoClient: jest.fn(() => {
    setImmediate(() => EventEmitter.prototype.emit.call(fakeSocket, 'connect'));

    return fakeSocket;
  }),
}));

jest.mock('../utils/client-endpoint-security', () => ({
  validateClientEndpointWithDnsOrThrow: jest.fn().mockResolvedValue(undefined),
  getClientEndpointTlsPolicy: jest.fn().mockReturnValue({ rejectUnauthorized: true }),
  createPinnedSocketAgent: jest.fn().mockReturnValue({ pinned: true }),
}));

describe('RemoteAgentsSessionService.sendVisibleChatTurn', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const agentId = '00000000-0000-4000-8000-000000000020';
  const chatId = '00000000-0000-4000-8000-000000000030';
  const otherChatId = '00000000-0000-4000-8000-000000000031';
  let service: RemoteAgentsSessionService;
  let statistics: { recordChatInput: jest.Mock; recordChatOutput: jest.Mock };
  let credentials: { findByClientAndAgent: jest.Mock };

  beforeEach(() => {
    fakeSocket = new FakeRemoteSocket();
    statistics = { recordChatInput: jest.fn(), recordChatOutput: jest.fn() };
    credentials = { findByClientAndAgent: jest.fn().mockResolvedValue({ password: 'pw' }) };
    service = new RemoteAgentsSessionService(
      {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          id: clientId,
          endpoint: 'http://manager:3000/api',
          authenticationType: AuthenticationType.API_KEY,
          apiKey: 'key',
        }),
      } as any,
      {} as any,
      credentials as any,
      statistics as any,
    );
  });

  const waitForChatEmit = async () => {
    for (let i = 0; i < 50 && !fakeSocket.sent.some((entry) => entry.event === 'chat'); i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  const start = (overrides: Record<string, unknown> = {}) =>
    service.sendVisibleChatTurn({
      clientId,
      agentId,
      chatId,
      message: 'hello agent',
      correlationId: 'openai:1',
      userId: 'user-1',
      ...overrides,
    });

  const agentMessage = (forChatId: string, response: unknown) => ({
    success: true,
    data: { from: 'agent', chatId: forChatId, response },
  });

  it('sends a console-equivalent chat turn without trust markers or hidden-session suffixes', async () => {
    const result = start({ model: 'openai/gpt-5' });

    await waitForChatEmit();

    const chat = fakeSocket.sent.find((entry) => entry.event === 'chat')?.payload as Record<string, unknown>;

    expect(chat).toEqual({
      message: 'hello agent',
      correlationId: 'openai:1',
      responseMode: 'stream',
      ephemeral: false,
      chatId,
      model: 'openai/gpt-5',
    });
    expect(chat).not.toHaveProperty('unattendedAutomation');
    expect(chat).not.toHaveProperty('resumeSessionSuffix');
    expect(fakeSocket.sent.find((entry) => entry.event === 'login')?.payload).toEqual({ agentId, password: 'pw' });

    fakeSocket.push('chatMessage', agentMessage(chatId, { type: 'result', result: 'done' }));
    await expect(result).resolves.toEqual({ text: 'done', finishReason: 'stop', usage: undefined });
  });

  it('streams only this chat and turn, and settles on the filtered final agent message', async () => {
    const deltas: string[] = [];
    const result = start({ onDeltaText: (delta: string) => deltas.push(delta) });

    await waitForChatEmit();
    fakeSocket.push('chatEvent', {
      success: true,
      data: { kind: 'assistantDelta', chatId, payload: { delta: 'Hel' } },
    });
    fakeSocket.push('chatEvent', {
      success: true,
      data: { kind: 'assistantDelta', chatId: otherChatId, payload: { delta: 'foreign' } },
    });
    fakeSocket.push('chatEvent', {
      success: true,
      data: { kind: 'assistantDelta', chatId, correlationId: 'console-turn', payload: { delta: 'other turn' } },
    });
    fakeSocket.push('chatEvent', {
      success: true,
      data: { kind: 'assistantDelta', chatId, correlationId: 'openai:1', payload: { delta: 'lo' } },
    });
    // Raw terminal stream text never settles the turn (it is unfiltered).
    fakeSocket.push('chatEvent', {
      success: true,
      data: { kind: 'assistantMessage', chatId, payload: { text: 'Hello secret' } },
    });
    fakeSocket.push('chatMessage', { success: true, data: { from: 'user', chatId, text: 'hello agent' } });
    fakeSocket.push('chatMessage', agentMessage(otherChatId, { type: 'result', result: 'foreign' }));
    fakeSocket.push(
      'chatMessage',
      agentMessage(chatId, {
        type: 'agenstra_turn',
        parts: [
          { type: 'tool', name: 'bash' },
          { type: 'result', result: 'Hello [redacted]', usage: { inputTokens: 10, outputTokens: 3 } },
        ],
      }),
    );

    await expect(result).resolves.toEqual({
      text: 'Hello [redacted]',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 3 },
    });
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(statistics.recordChatInput).toHaveBeenCalledWith(
      clientId,
      agentId,
      2,
      'hello agent'.length,
      'user-1',
      StatisticsInteractionKind.CHAT,
    );
    expect(statistics.recordChatOutput).toHaveBeenCalledWith(
      clientId,
      agentId,
      2,
      'Hello [redacted]'.length,
      'user-1',
      StatisticsInteractionKind.CHAT,
      { inputTokens: 10, outputTokens: 3 },
    );
    expect(fakeSocket.disconnected).toBe(true);
  });

  it.each([
    ['incoming', 'dropped'],
    ['outgoing', 'dropped'],
  ])('reports content_filter when an %s filter drops the turn', async (direction, status) => {
    const onFilterResult = jest.fn();
    const result = start({ onFilterResult });

    await waitForChatEmit();
    fakeSocket.push('messageFilterResult', { success: true, data: { direction, status, chatId: otherChatId } });
    fakeSocket.push('messageFilterResult', {
      success: true,
      data: { direction, status, chatId, matchedFilter: { type: 'regex' } },
    });

    await expect(result).resolves.toEqual({ text: '', finishReason: 'content_filter' });
    expect(onFilterResult).toHaveBeenCalledTimes(1);
    expect(onFilterResult).toHaveBeenCalledWith(expect.objectContaining({ direction, status, chatId }));
    expect(statistics.recordChatOutput).not.toHaveBeenCalled();
  });

  it('reports flagged (filtered) results without settling', async () => {
    const onFilterResult = jest.fn();
    const result = start({ onFilterResult });

    await waitForChatEmit();
    fakeSocket.push('messageFilterResult', {
      success: true,
      data: { direction: 'outgoing', status: 'filtered', chatId },
    });
    fakeSocket.push('messageFilterResult', {
      success: true,
      data: { direction: 'outgoing', status: 'allowed', chatId },
    });
    fakeSocket.push('chatMessage', agentMessage(chatId, { type: 'result', result: 'ok' }));

    await expect(result).resolves.toEqual(expect.objectContaining({ text: 'ok', finishReason: 'stop' }));
    expect(onFilterResult).toHaveBeenCalledTimes(1);
  });

  it('maps a dropped single-path agent response to content_filter', async () => {
    const result = start();

    await waitForChatEmit();
    fakeSocket.push(
      'chatMessage',
      agentMessage(chatId, { type: 'error', is_error: true, result: 'MESSAGE_DROPPED', message: 'dropped' }),
    );

    await expect(result).resolves.toEqual({ text: '', finishReason: 'content_filter' });
  });

  it('fails with 502 and the agent error when the turn ended in an error result', async () => {
    const result = start();

    await waitForChatEmit();
    fakeSocket.push(
      'chatMessage',
      agentMessage(chatId, {
        type: 'agenstra_turn',
        parts: [{ type: 'result', subtype: 'error', is_error: true, result: 'Provider quota exceeded' }],
      }),
    );

    await expect(result).rejects.toThrow(
      new BadGatewayException('The agent failed to answer: Provider quota exceeded'),
    );
  });

  it('maps an unknown chat session reported by the manager to 404', async () => {
    const result = start();

    await waitForChatEmit();
    fakeSocket.push('error', {
      success: false,
      error: { message: 'Invalid or unknown chat session', code: 'INVALID_CHAT_ID' },
    });

    await expect(result).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps other manager errors to 502 and ignores transport errors', async () => {
    const result = start();

    await waitForChatEmit();
    fakeSocket.push('error', new Error('transport hiccup'));
    fakeSocket.push('error', {
      success: false,
      error: { message: 'Error processing chat message', code: 'CHAT_ERROR' },
    });

    await expect(result).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('fails with 502 when the manager connection closes mid-turn', async () => {
    const result = start();

    await waitForChatEmit();
    fakeSocket.push('disconnect', 'transport close');

    await expect(result).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('times out with 504', async () => {
    const result = start({ chatTimeoutMs: 20 });

    await expect(result).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('stops waiting and disconnects when the caller aborts', async () => {
    const controller = new AbortController();
    const result = start({ signal: controller.signal });

    await waitForChatEmit();
    controller.abort();

    await expect(result).rejects.toBeInstanceOf(RemoteChatTurnAbortedError);
    expect(fakeSocket.disconnected).toBe(true);
    expect(statistics.recordChatOutput).not.toHaveBeenCalled();
  });

  it('does not connect when already aborted', async () => {
    const controller = new AbortController();

    controller.abort();

    await expect(start({ signal: controller.signal })).rejects.toBeInstanceOf(RemoteChatTurnAbortedError);
    expect(fakeSocket.sent).toEqual([]);
  });

  it('fails with 503 when the agent has no stored credentials', async () => {
    credentials.findByClientAndAgent.mockResolvedValue(null);

    await expect(start()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails with 503 when the manager rejects the agent login', async () => {
    fakeSocket.emit = function (this: FakeRemoteSocket, event: string, payload?: unknown) {
      this.sent.push({ event, payload });

      if (event === 'login') {
        setImmediate(() => EventEmitter.prototype.emit.call(this, 'loginError', { error: { message: 'bad' } }));
      }

      return true;
    } as any;

    await expect(start()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fakeSocket.sent.some((entry) => entry.event === 'chat')).toBe(false);
  });
});
