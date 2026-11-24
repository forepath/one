import type { Server, Socket } from 'socket.io';

import type { ActionCenterRealtimeService } from '../services/action-center-realtime.service';

import { ActionCenterGatewayBase, type ActionCenterSocketAuthResult } from './action-center.gateway.base';

class TestGateway extends ActionCenterGatewayBase {
  constructor(
    realtime: ActionCenterRealtimeService,
    private readonly result: ActionCenterSocketAuthResult | null | Error,
  ) {
    super(realtime);
  }

  protected async authenticate(): Promise<ActionCenterSocketAuthResult | null> {
    if (this.result instanceof Error) {
      throw this.result;
    }

    return this.result;
  }
}

function setup(result: ActionCenterSocketAuthResult | null | Error) {
  const realtime = { attach: jest.fn(), register: jest.fn(() => true), unregister: jest.fn(), pushToSocket: jest.fn() };
  const gateway = new TestGateway(realtime as never, result);
  let middleware!: (socket: Socket, next: (error?: Error) => void) => Promise<void>;
  const server = { use: jest.fn((fn) => (middleware = fn)) } as unknown as Server;

  gateway.afterInit(server);

  return { gateway, realtime, run: (socket: Socket, next: jest.Mock) => middleware(socket, next) };
}

const auth: ActionCenterSocketAuthResult = {
  viewer: { userId: 'u', role: 'admin', scopeKey: 'tenant-a' },
  revalidate: async () => null,
};

describe('ActionCenterGatewayBase', () => {
  it('accepts authenticated sockets, registers and pushes the first view', async () => {
    const { gateway, realtime, run } = setup(auth);
    const socket = { id: 's', data: {}, disconnect: jest.fn() } as unknown as Socket;
    const next = jest.fn();

    await run(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(realtime.attach).toHaveBeenCalled();

    gateway.handleConnection(socket);
    expect(realtime.register).toHaveBeenCalledWith(expect.objectContaining({ viewer: auth.viewer }));
    expect(realtime.pushToSocket).toHaveBeenCalledWith('s');

    gateway.handleDisconnect(socket);
    expect(realtime.unregister).toHaveBeenCalledWith('s');
  });

  it.each([null, new Error('boom')])('rejects the handshake when authentication yields %p', async (result) => {
    const { run } = setup(result);
    const next = jest.fn();

    await run({ id: 's', data: {} } as unknown as Socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Unauthorized' }));
  });

  it('installs the auth middleware once per server and pushes once per socket', async () => {
    const { gateway, realtime } = setup(auth);
    const server = { use: jest.fn() } as unknown as Server;

    gateway.afterInit(server);
    gateway.afterInit(server);
    expect((server as unknown as { use: jest.Mock }).use).toHaveBeenCalledTimes(1);

    realtime.register.mockReturnValueOnce(false);
    gateway.handleConnection({ id: 's', data: { actionCenterAuth: auth } } as unknown as Socket);
    expect(realtime.pushToSocket).not.toHaveBeenCalled();
  });

  it('disconnects sockets that reach the connection handler without auth data', () => {
    const { gateway, realtime } = setup(auth);
    const socket = { id: 's', data: {}, disconnect: jest.fn() } as unknown as Socket;

    gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(realtime.register).not.toHaveBeenCalled();
  });
});
