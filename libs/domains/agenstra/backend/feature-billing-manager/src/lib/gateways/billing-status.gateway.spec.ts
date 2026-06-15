import { SocketAuthService, UserRole } from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';
import type { Socket } from 'socket.io';

import { SubscriptionStatus } from '../entities/subscription.entity';
import { SubscriptionItemServerService } from '../services/subscription-item-server.service';
import { SubscriptionService } from '../services/subscription.service';

import { BillingStatusGateway } from './billing-status.gateway';

function createMockSocket(overrides: Partial<Socket> & { data?: { userInfo?: unknown } } = {}): Socket {
  return {
    id: 'socket-1',
    emit: jest.fn(),
    data: {},
    ...overrides,
  } as unknown as Socket;
}

describe('BillingStatusGateway', () => {
  let gateway: BillingStatusGateway;
  let socketAuth: jest.Mocked<Pick<SocketAuthService, 'validateAndGetUser'>>;
  let subscriptionService: jest.Mocked<Pick<SubscriptionService, 'listSubscriptions'>>;
  let itemServerService: jest.Mocked<Pick<SubscriptionItemServerService, 'listItems' | 'getServerInfo'>>;
  const userSocketInfo = {
    isApiKeyAuth: false,
    userId: 'user-1',
    userRole: UserRole.USER,
    user: { id: 'user-1', roles: ['user'] },
  };

  beforeEach(async () => {
    socketAuth = {
      validateAndGetUser: jest.fn(),
    };
    subscriptionService = {
      listSubscriptions: jest.fn(),
    };
    itemServerService = {
      listItems: jest.fn(),
      getServerInfo: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingStatusGateway,
        { provide: SocketAuthService, useValue: socketAuth },
        { provide: SubscriptionService, useValue: subscriptionService },
        { provide: SubscriptionItemServerService, useValue: itemServerService },
      ],
    }).compile();

    gateway = module.get(BillingStatusGateway);
  });

  describe('afterInit', () => {
    it('rejects connection when validateAndGetUser returns null', async () => {
      socketAuth.validateAndGetUser.mockResolvedValue(null);
      const next = jest.fn();
      const mockSocket = {
        id: 's1',
        handshake: { headers: {}, auth: {} },
        data: {},
      };
      const useCallbacks: Array<(s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>> = [];
      const server = {
        use: jest.fn((cb: (s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>) => {
          useCallbacks.push(cb);
        }),
      };

      gateway.afterInit(server as never);
      await useCallbacks[0](mockSocket, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((mockSocket as { data?: unknown }).data).toEqual({});
    });

    it('attaches userInfo when auth succeeds', async () => {
      socketAuth.validateAndGetUser.mockResolvedValue(userSocketInfo);
      const next = jest.fn();
      const mockSocket = {
        id: 's1',
        handshake: { headers: { authorization: 'Bearer x' }, auth: {} },
        data: {},
      };
      const useCallbacks: Array<(s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>> = [];
      const server = {
        use: jest.fn((cb: (s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>) => {
          useCallbacks.push(cb);
        }),
      };

      gateway.afterInit(server as never);
      await useCallbacks[0](mockSocket, next);
      expect(next).toHaveBeenCalledWith();
      expect((mockSocket as unknown as { data: { userInfo: unknown } }).data.userInfo).toEqual(userSocketInfo);
    });
  });

  describe('subscribeDashboardStatus', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('emits error and does not poll for API key auth', async () => {
      const socket = createMockSocket({
        data: { userInfo: { isApiKeyAuth: true, user: { id: 'api-key-user', roles: [] } } },
      });

      await gateway.handleSubscribe({}, socket);
      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'User not authenticated' });
      expect(subscriptionService.listSubscriptions).not.toHaveBeenCalled();
    });

    it('emits dashboardStatusUpdate only to the subscribing socket with permitted data', async () => {
      const socket = createMockSocket({ data: { userInfo: userSocketInfo } });
      const sub = {
        id: 'sub-a',
        status: SubscriptionStatus.ACTIVE,
      } as Awaited<ReturnType<SubscriptionService['listSubscriptions']>>[number];

      subscriptionService.listSubscriptions.mockResolvedValue([sub]);
      itemServerService.listItems.mockResolvedValue([
        {
          id: 'item-1',
          subscriptionId: 'sub-a',
          serviceTypeId: 'st',
          provisioningStatus: 'active',
          hostname: 'h1',
          service: 'controller' as const,
        },
      ]);
      itemServerService.getServerInfo.mockResolvedValue({
        serverId: 'srv-1',
        name: 'srv',
        publicIp: '1.1.1.1',
        status: 'running',
        metadata: { provider: 'hetzner' },
        hostname: 'h1',
        hostnameFqdn: 'h1.example.com',
      });

      await gateway.handleSubscribe({ pollIntervalMs: 30_000 }, socket);

      expect(subscriptionService.listSubscriptions).toHaveBeenCalledWith('user-1', 1000, 0);
      expect(itemServerService.listItems).toHaveBeenCalledWith('sub-a', 'user-1');
      expect(itemServerService.getServerInfo).toHaveBeenCalledWith('sub-a', 'item-1', 'user-1');

      expect(socket.emit).toHaveBeenCalledWith(
        'dashboardStatusUpdate',
        expect.objectContaining({
          items: [
            expect.objectContaining({
              subscriptionId: 'sub-a',
              itemId: 'item-1',
              service: 'controller',
              name: 'srv',
              publicIp: '1.1.1.1',
              status: 'running',
            }),
          ],
        }),
      );

      const otherSocket = createMockSocket({ id: 'socket-2', data: { userInfo: userSocketInfo } });

      expect(otherSocket.emit).not.toHaveBeenCalled();
    });

    it('unsubscribeDashboardStatus clears polling', async () => {
      const socket = createMockSocket({ data: { userInfo: userSocketInfo } });

      subscriptionService.listSubscriptions.mockResolvedValue([]);

      await gateway.handleSubscribe({ pollIntervalMs: 30_000 }, socket);
      const callCountAfterFirst = subscriptionService.listSubscriptions.mock.calls.length;

      gateway.handleUnsubscribe(socket);
      jest.advanceTimersByTime(60_000);

      expect(subscriptionService.listSubscriptions.mock.calls.length).toBe(callCountAfterFirst);
    });

    it('handleDisconnect clears polling', async () => {
      const socket = createMockSocket({ data: { userInfo: userSocketInfo } });

      subscriptionService.listSubscriptions.mockResolvedValue([]);

      await gateway.handleSubscribe({ pollIntervalMs: 30_000 }, socket);
      const callCountAfterFirst = subscriptionService.listSubscriptions.mock.calls.length;

      gateway.handleDisconnect(socket);
      jest.advanceTimersByTime(60_000);

      expect(subscriptionService.listSubscriptions.mock.calls.length).toBe(callCountAfterFirst);
    });
  });
});
