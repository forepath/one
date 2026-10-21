import { EventEmitter } from 'events';

import { AuthenticationType } from '@forepath/identity/backend';

import { RemoteAgentsSessionService } from './remote-agents-session.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- minimal socket.io client fake */

class FakeRemoteSocket extends EventEmitter {
  readonly sent: Array<{ event: string; payload: unknown }> = [];

  /** Client → server emits are recorded; `connect` / `login` are answered like the agent-manager does. */
  override emit(event: string, payload?: unknown): boolean {
    this.sent.push({ event, payload });

    if (event === 'login') {
      setImmediate(() => super.emit('loginSuccess'));
    }

    return true;
  }

  /** Server → client frame. */
  push(event: string, payload: unknown): void {
    super.emit(event, payload);
  }

  disconnect(): void {
    // noop
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
}));

describe('RemoteAgentsSessionService.sendChatStreaming', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const agentId = '00000000-0000-4000-8000-000000000020';
  let service: RemoteAgentsSessionService;

  beforeEach(() => {
    fakeSocket = new FakeRemoteSocket();
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
      { findByClientAndAgent: jest.fn().mockResolvedValue({ password: 'pw' }) } as any,
      { recordChatInput: jest.fn(), recordChatOutput: jest.fn() } as any,
    );
  });

  const waitForChatEmit = async () => {
    for (let i = 0; i < 50 && !fakeSocket.sent.some((entry) => entry.event === 'chat'); i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  const assistantMessage = (chatId: string, text: string) => ({
    success: true,
    data: { kind: 'assistantMessage', chatId, payload: { text } },
  });

  it('ignores frames of other chats of the agent when a visible chat is targeted', async () => {
    const onEvent = jest.fn();
    const result = service.sendChatStreaming({
      clientId,
      agentId,
      chatId: 'chat-own',
      ephemeral: false,
      message: 'hi',
      correlationId: 'c1',
      onEvent,
    });

    await waitForChatEmit();
    expect(fakeSocket.sent.find((entry) => entry.event === 'chat')?.payload).toEqual(
      expect.objectContaining({ chatId: 'chat-own', ephemeral: false }),
    );

    fakeSocket.push('chatEvent', assistantMessage('chat-other', 'not mine'));
    fakeSocket.push('chatMessage', {
      success: true,
      data: { from: 'agent', chatId: 'chat-other', response: { type: 'result', result: 'not mine either' } },
    });
    fakeSocket.push('chatEvent', assistantMessage('chat-own', 'mine'));

    await expect(result).resolves.toEqual(expect.objectContaining({ text: 'mine' }));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('ignores visible-chat frames and other turns in hidden sessions', async () => {
    const onEvent = jest.fn();
    const result = service.sendChatStreaming({
      clientId,
      agentId,
      resumeSessionSuffix: '-task-x',
      message: 'run',
      correlationId: 'agent-task:run-1',
      onEvent,
    });

    await waitForChatEmit();
    fakeSocket.push('chatEvent', assistantMessage('chat-visible', 'user chat answer'));
    fakeSocket.push('chatEvent', {
      success: true,
      data: { kind: 'assistantMessage', correlationId: 'other-turn', payload: { text: 'other' } },
    });
    fakeSocket.push('chatEvent', {
      success: true,
      data: { kind: 'assistantMessage', correlationId: 'agent-task:run-1', payload: { text: 'task result' } },
    });

    await expect(result).resolves.toEqual(expect.objectContaining({ text: 'task result' }));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps settling on any frame for hidden sessions', async () => {
    const result = service.sendChatStreaming({
      clientId,
      agentId,
      resumeSessionSuffix: '-plan-x',
      message: 'hi',
      correlationId: 'c1',
    });

    await waitForChatEmit();
    fakeSocket.push('chatEvent', { success: true, data: { kind: 'assistantMessage', payload: { text: 'plan' } } });

    await expect(result).resolves.toEqual(expect.objectContaining({ text: 'plan' }));
  });
});
