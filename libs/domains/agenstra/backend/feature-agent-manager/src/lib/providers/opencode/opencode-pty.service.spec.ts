import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { OpenCodeClientFactory } from './opencode-client.factory';
import { OPENCODE_PTY_CONNECT_TOKEN_HEADER, OPENCODE_PTY_CONNECT_TOKEN_HEADER_VALUE } from './opencode-provider.config';
import { OpenCodePtyService } from './opencode-pty.service';

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = MockWebSocket.OPEN;
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.emit('open', {});
    });
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    this.listeners.get(type)?.add(listener);
  }

  send = jest.fn();

  close = jest.fn(() => {
    this.readyState = 3;
    this.emit('close', {});
  });

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe('OpenCodePtyService', () => {
  let service: OpenCodePtyService;
  let mockClientFactory: {
    waitForHealthy: jest.Mock;
    resolveConnection: jest.Mock;
  };
  let originalWebSocket: typeof WebSocket;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    originalWebSocket = global.WebSocket;
    originalFetch = global.fetch;
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    mockClientFactory = {
      waitForHealthy: jest.fn().mockResolvedValue(undefined),
      resolveConnection: jest.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:4096',
        authorization: 'Basic dGVzdA==',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OpenCodePtyService, { provide: OpenCodeClientFactory, useValue: mockClientFactory }],
    }).compile();

    service = module.get(OpenCodePtyService);
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockFetchSequence(): jest.Mock {
    const fetchMock = jest.fn(async (input: string, init?: RequestInit) => {
      if (
        input.includes('/pty') &&
        input.includes('directory=') &&
        init?.method === 'POST' &&
        !input.includes('/connect-token')
      ) {
        return new Response(JSON.stringify({ id: 'pty-1', status: 'running' }), { status: 200 });
      }

      if (input.includes('/connect-token')) {
        const headers = init?.headers as Record<string, string> | undefined;

        expect(headers?.[OPENCODE_PTY_CONNECT_TOKEN_HEADER]).toBe(OPENCODE_PTY_CONNECT_TOKEN_HEADER_VALUE);
        expect(headers?.Origin).toBe('http://127.0.0.1:4096');

        return new Response(JSON.stringify({ ticket: 'ticket-abc', expires_in: 60 }), { status: 200 });
      }

      if (init?.method === 'DELETE') {
        return new Response('true', { status: 200 });
      }

      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ id: 'pty-1' }), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    global.fetch = fetchMock as typeof fetch;

    return fetchMock;
  }

  it('open creates PTY, connects WebSocket, and forwards output', async () => {
    const fetchMock = mockFetchSequence();
    const sockets: MockWebSocket[] = [];

    global.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    } as unknown as typeof WebSocket;

    const onOutput = jest.fn();
    const onClosed = jest.fn();

    await service.open('agent-1', 'container-1', 'sess-1', { shell: 'bash' }, { onOutput, onClosed });

    expect(mockClientFactory.waitForHealthy).toHaveBeenCalledWith('agent-1', 'container-1', { timeoutMs: 30_000 });
    expect(service.hasSession('sess-1')).toBe(true);
    expect(sockets[0]?.url).toContain('ws://127.0.0.1:4096/pty/pty-1/connect');
    expect(sockets[0]?.url).toContain('directory=');
    expect(sockets[0]?.url).toContain('ticket=ticket-abc');

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/pty') && !String(url).includes('/connect-token') && init?.method === 'POST',
    );

    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ title: 'Agenstra console', command: 'bash' });

    sockets[0]?.emit('message', { data: 'hello' });

    expect(onOutput).toHaveBeenCalledWith('hello');

    onOutput.mockClear();

    const metaFrame = new Uint8Array([0, ...Buffer.from('{"cursor":12}', 'utf-8')]);

    sockets[0]?.emit('message', { data: metaFrame.buffer });

    expect(onOutput).not.toHaveBeenCalled();
  });

  it('open omits command so OpenCode uses configured shell', async () => {
    const fetchMock = mockFetchSequence();

    global.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
      }
    } as unknown as typeof WebSocket;

    await service.open('agent-1', 'container-1', 'sess-default', {}, { onOutput: jest.fn(), onClosed: jest.fn() });

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/pty') && !String(url).includes('/connect-token') && init?.method === 'POST',
    );

    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ title: 'Agenstra console' });
  });

  it('write sends data on open WebSocket', async () => {
    mockFetchSequence();
    const sockets: MockWebSocket[] = [];

    global.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    } as unknown as typeof WebSocket;

    await service.open('agent-1', 'container-1', 'sess-w', {}, { onOutput: jest.fn(), onClosed: jest.fn() });

    await service.write('sess-w', 'ls\n');

    expect(sockets[0]?.send).toHaveBeenCalledWith('ls\n');
  });

  it('close removes session and deletes PTY', async () => {
    const fetchMock = mockFetchSequence();
    const sockets: MockWebSocket[] = [];

    global.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    } as unknown as typeof WebSocket;

    await service.open('agent-1', 'container-1', 'sess-c', {}, { onOutput: jest.fn(), onClosed: jest.fn() });

    await service.close('sess-c');

    expect(service.hasSession('sess-c')).toBe(false);
    expect(sockets[0]?.close).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).includes('pty-1'))).toBe(
      true,
    );
  });

  it('write throws when session missing', async () => {
    await expect(service.write('missing', 'x')).rejects.toThrow(NotFoundException);
  });

  it('notifyClosed fires once on WebSocket close', async () => {
    mockFetchSequence();
    const onClosed = jest.fn();
    const sockets: MockWebSocket[] = [];

    global.WebSocket = class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    } as unknown as typeof WebSocket;

    await service.open('agent-1', 'container-1', 'sess-once', {}, { onOutput: jest.fn(), onClosed });

    sockets[0]?.close();

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(service.hasSession('sess-once')).toBe(false);
  });
});
