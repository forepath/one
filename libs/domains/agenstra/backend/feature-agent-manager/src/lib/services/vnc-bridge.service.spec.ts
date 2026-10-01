import WebSocket = require('ws');

import { VncBridgeService } from './vnc-bridge.service';

type WsHandler = (...args: unknown[]) => void;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = MockWebSocket.OPEN;
  send = jest.fn();
  close = jest.fn();
  private handlers = new Map<string, WsHandler[]>();

  on(event: string, handler: WsHandler) {
    const list = this.handlers.get(event) || [];

    list.push(handler);
    this.handlers.set(event, list);

    return this;
  }

  once(event: string, handler: WsHandler) {
    return this.on(event, handler);
  }

  off(event: string, handler: WsHandler) {
    const list = this.handlers.get(event) || [];

    this.handlers.set(
      event,
      list.filter((item) => item !== handler),
    );

    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) || []) {
      handler(...args);
    }
  }
}

jest.mock('ws', () => {
  const ctor = jest.fn(() => new MockWebSocket()) as jest.Mock & {
    OPEN: number;
    CONNECTING: number;
  };

  ctor.OPEN = 1;
  ctor.CONNECTING = 0;

  return ctor;
});

describe('VncBridgeService', () => {
  const dockerService = {
    resolveContainerHttpBaseUrl: jest.fn(),
  };
  const openCodeClientFactory = {
    resolveConnection: jest.fn(),
  };

  let service: VncBridgeService;
  let latestSocket: MockWebSocket;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VncBridgeService(dockerService as never, openCodeClientFactory as never);
    dockerService.resolveContainerHttpBaseUrl.mockResolvedValue('http://172.28.0.3:6080');
    openCodeClientFactory.resolveConnection.mockResolvedValue({
      baseUrl: 'http://172.28.0.3:4096',
      authorization: 'Basic dGVzdA==',
    });

    (WebSocket as unknown as jest.Mock).mockImplementation(() => {
      latestSocket = new MockWebSocket();

      return latestSocket;
    });
  });

  it('opens upstream websocket using websockify port and forwards bytes', async () => {
    const onMessage = jest.fn();
    const onClose = jest.fn();
    const onError = jest.fn();

    const openPromise = service.open('session-1', 'agent-1', 'container-1', {
      onMessage,
      onClose,
      onError,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(latestSocket).toBeDefined();
    latestSocket.emit('open');
    await openPromise;

    expect(dockerService.resolveContainerHttpBaseUrl).toHaveBeenCalledWith('container-1', 6080);
    expect(openCodeClientFactory.resolveConnection).toHaveBeenCalledWith('agent-1', 'container-1');
    expect(service.hasSession('session-1')).toBe(true);

    const payload = Buffer.from([1, 2, 3]);

    latestSocket.emit('message', payload, true);
    expect(onMessage).toHaveBeenCalledWith(payload, true);

    service.send('session-1', Buffer.from('hi'), false);
    expect(latestSocket.send).toHaveBeenCalled();

    latestSocket.emit('close');
    expect(onClose).toHaveBeenCalled();
    expect(service.hasSession('session-1')).toBe(false);
  });
});
