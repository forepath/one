import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocketAuthService, UserRole, UsersRepository } from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';
import type { Socket } from 'socket.io';

import { SubscriptionStatus } from '../entities/subscription.entity';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { SubscriptionItemServerService } from '../services/subscription-item-server.service';
import { SubscriptionService } from '../services/subscription.service';

import { BillingMeterRealtimeService } from './billing-meter-realtime.service';
import { BillingStatusGateway } from './billing-status.gateway';

function createMockSocket(
  overrides: Partial<Socket> & {
    data?: { userInfo?: unknown; tenantId?: string; meterSubscriptionRooms?: string[] };
  } = {},
): Socket {
  const { data: dataOverride, ...rest } = overrides;

  return {
    id: 'socket-1',
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    ...rest,
    data: { tenantId: 'default', ...(dataOverride ?? {}) },
  } as unknown as Socket;
}

describe('BillingStatusGateway', () => {
  let gateway: BillingStatusGateway;
  let socketAuth: jest.Mocked<Pick<SocketAuthService, 'validateAndGetUser'>>;
  let subscriptionService: jest.Mocked<Pick<SubscriptionService, 'listSubscriptions' | 'getSubscription'>>;
  let itemServerService: jest.Mocked<Pick<SubscriptionItemServerService, 'listItems' | 'getServerInfo'>>;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findByIdForTenant'>>;
  let subscriptionsRepository: jest.Mocked<Pick<SubscriptionsRepository, 'findByIdOrThrow'>>;
  let billingMeterRealtime: jest.Mocked<Pick<BillingMeterRealtimeService, 'attachServer' | 'buildMeterSummaryPayload'>>;
  const userSocketInfo = {
    isApiKeyAuth: false,
    userId: 'user-1',
    userRole: UserRole.USER,
    user: { id: 'user-1', roles: ['user'] },
  };
  const adminSocketInfo = {
    isApiKeyAuth: false,
    userId: 'admin-1',
    userRole: UserRole.ADMIN,
    user: { id: 'admin-1', roles: ['admin'] },
  };

  beforeEach(async () => {
    socketAuth = {
      validateAndGetUser: jest.fn(),
    };
    subscriptionService = {
      listSubscriptions: jest.fn(),
      getSubscription: jest.fn(),
    };
    itemServerService = {
      listItems: jest.fn(),
      getServerInfo: jest.fn(),
    };
    usersRepository = {
      findByIdForTenant: jest.fn().mockResolvedValue({ id: 'user-1', tenantId: 'default' }),
    };
    subscriptionsRepository = {
      findByIdOrThrow: jest.fn(),
    };
    billingMeterRealtime = {
      attachServer: jest.fn(),
      buildMeterSummaryPayload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingStatusGateway,
        { provide: SocketAuthService, useValue: socketAuth },
        { provide: SubscriptionService, useValue: subscriptionService },
        { provide: SubscriptionItemServerService, useValue: itemServerService },
        { provide: UsersRepository, useValue: usersRepository },
        { provide: SubscriptionsRepository, useValue: subscriptionsRepository },
        { provide: BillingMeterRealtimeService, useValue: billingMeterRealtime },
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
        handshake: { headers: {}, auth: { tenantId: 'default' } },
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
        handshake: { headers: { authorization: 'Bearer x' }, auth: { tenantId: 'default' } },
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
      expect(socketAuth.validateAndGetUser).toHaveBeenCalledWith('Bearer x', 'default', { websocket: 'billing' });
      expect((mockSocket as unknown as { data: { userInfo: unknown; tenantId: string } }).data.userInfo).toEqual(
        userSocketInfo,
      );
      expect((mockSocket as unknown as { data: { tenantId: string } }).data.tenantId).toBe('default');
      expect(billingMeterRealtime.attachServer).toHaveBeenCalledWith(server);
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
          serviceTypeName: 'Hetzner',
          provisioningStatus: 'active',
          hostname: 'h1',
          displayName: 'My server',
          service: 'agenstra-controller' as const,
          sshAccessGranted: true,
          hasProviderReference: true,
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
              service: 'agenstra-controller',
              serviceTypeName: 'Hetzner',
              displayName: 'My server',
              name: 'srv',
              publicIp: '1.1.1.1',
              status: 'running',
              sshAccessGranted: true,
            }),
          ],
        }),
      );

      const otherSocket = createMockSocket({ id: 'socket-2', data: { userInfo: userSocketInfo } });

      expect(otherSocket.emit).not.toHaveBeenCalled();
    });

    it('includes pending_withdrawal subscriptions until the instance is deprovisioned', async () => {
      const socket = createMockSocket({ data: { userInfo: userSocketInfo } });
      const sub = {
        id: 'sub-w',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
      } as Awaited<ReturnType<SubscriptionService['listSubscriptions']>>[number];

      subscriptionService.listSubscriptions.mockResolvedValue([sub]);
      itemServerService.listItems.mockResolvedValue([
        {
          id: 'item-1',
          subscriptionId: 'sub-w',
          serviceTypeId: 'st',
          serviceTypeName: 'Hetzner',
          provisioningStatus: 'active',
          hostname: 'h1',
          displayName: null,
          service: 'agenstra-controller' as const,
          sshAccessGranted: false,
          hasProviderReference: true,
        },
      ]);
      itemServerService.getServerInfo.mockResolvedValue({
        serverId: 'srv-1',
        name: 'srv',
        publicIp: '1.1.1.1',
        status: 'running',
        metadata: {},
      });

      await gateway.handleSubscribe({}, socket);

      expect(itemServerService.listItems).toHaveBeenCalledWith('sub-w', 'user-1');
      expect(socket.emit).toHaveBeenCalledWith(
        'dashboardStatusUpdate',
        expect.objectContaining({
          items: [expect.objectContaining({ subscriptionId: 'sub-w', itemId: 'item-1' })],
        }),
      );
    });

    it('skips canceled subscriptions in dashboard status ticks', async () => {
      const socket = createMockSocket({ data: { userInfo: userSocketInfo } });
      const sub = {
        id: 'sub-canceled',
        status: SubscriptionStatus.CANCELED,
      } as Awaited<ReturnType<SubscriptionService['listSubscriptions']>>[number];

      subscriptionService.listSubscriptions.mockResolvedValue([sub]);

      await gateway.handleSubscribe({}, socket);

      expect(itemServerService.listItems).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('dashboardStatusUpdate', expect.objectContaining({ items: [] }));
    });

    it('includes null displayName when the item has no label', async () => {
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
          serviceTypeName: 'Hetzner',
          provisioningStatus: 'active',
          hostname: 'h1',
          displayName: null,
          service: 'agenstra-controller' as const,
          sshAccessGranted: false,
          hasProviderReference: true,
        },
      ]);
      itemServerService.getServerInfo.mockResolvedValue({
        serverId: 'srv-1',
        name: 'srv',
        publicIp: '1.1.1.1',
        status: 'running',
        metadata: {},
      });

      await gateway.handleSubscribe({}, socket);

      expect(socket.emit).toHaveBeenCalledWith(
        'dashboardStatusUpdate',
        expect.objectContaining({
          items: [expect.objectContaining({ displayName: null })],
        }),
      );
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

  describe('subscribeSubscriptionMeters', () => {
    it('requires subscriptionId', async () => {
      const socket = createMockSocket({ data: { userInfo: userSocketInfo } });

      await gateway.handleSubscribeMeters({}, socket);

      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'subscriptionId is required' });
      expect(subscriptionService.getSubscription).not.toHaveBeenCalled();
    });

    it('emits access denied when the subscription does not belong to the user', async () => {
      const socket = createMockSocket({ data: { userInfo: userSocketInfo } });

      subscriptionService.getSubscription.mockRejectedValue(
        new BadRequestException('Subscription does not belong to user'),
      );

      await gateway.handleSubscribeMeters({ subscriptionId: 'sub-other' }, socket);

      expect(subscriptionService.getSubscription).toHaveBeenCalledWith('sub-other', 'user-1');
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Access denied' });
    });

    it('joins the subscription room and emits initial meter summaries', async () => {
      const socket = createMockSocket({ data: { userInfo: userSocketInfo } });
      const payload = {
        subscriptionId: 'sub-a',
        generatedAt: '2026-01-01T00:00:00.000Z',
        meters: [],
      };

      subscriptionService.getSubscription.mockResolvedValue({ id: 'sub-a' } as never);
      billingMeterRealtime.buildMeterSummaryPayload.mockResolvedValue(payload);

      await gateway.handleSubscribeMeters({ subscriptionId: 'sub-a' }, socket);

      expect(socket.join).toHaveBeenCalledWith('subscription:sub-a');
      expect(billingMeterRealtime.buildMeterSummaryPayload).toHaveBeenCalledWith('sub-a');
      expect(socket.emit).toHaveBeenCalledWith('meterSummaryUpdate', payload);
      expect((socket as { data: { meterSubscriptionRooms?: string[] } }).data.meterSubscriptionRooms).toEqual([
        'subscription:sub-a',
      ]);
    });

    it('allows admin to join without ownership when the subscription exists', async () => {
      const socket = createMockSocket({ data: { userInfo: adminSocketInfo } });
      const payload = {
        subscriptionId: 'sub-other',
        generatedAt: '2026-01-01T00:00:00.000Z',
        meters: [],
      };

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-other' } as never);
      billingMeterRealtime.buildMeterSummaryPayload.mockResolvedValue(payload);

      await gateway.handleSubscribeMeters({ subscriptionId: 'sub-other' }, socket);

      expect(subscriptionsRepository.findByIdOrThrow).toHaveBeenCalledWith('sub-other');
      expect(subscriptionService.getSubscription).not.toHaveBeenCalled();
      expect(socket.join).toHaveBeenCalledWith('subscription:sub-other');
      expect(socket.emit).toHaveBeenCalledWith('meterSummaryUpdate', payload);
    });

    it('denies admin when the subscription does not exist in the tenant', async () => {
      const socket = createMockSocket({ data: { userInfo: adminSocketInfo } });

      subscriptionsRepository.findByIdOrThrow.mockRejectedValue(
        new NotFoundException('Subscription with ID sub-missing not found'),
      );

      await gateway.handleSubscribeMeters({ subscriptionId: 'sub-missing' }, socket);

      expect(subscriptionsRepository.findByIdOrThrow).toHaveBeenCalledWith('sub-missing');
      expect(subscriptionService.getSubscription).not.toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Access denied' });
    });

    it('unsubscribeSubscriptionMeters leaves the room and clears tracking', async () => {
      const socket = createMockSocket({
        data: { userInfo: userSocketInfo, meterSubscriptionRooms: ['subscription:sub-a'] },
      });

      await gateway.handleUnsubscribeMeters({ subscriptionId: 'sub-a' }, socket);

      expect(socket.leave).toHaveBeenCalledWith('subscription:sub-a');
      expect((socket as { data: { meterSubscriptionRooms?: string[] } }).data.meterSubscriptionRooms).toEqual([]);
    });

    it('handleDisconnect leaves tracked meter rooms', async () => {
      const socket = createMockSocket({
        data: { userInfo: userSocketInfo, meterSubscriptionRooms: ['subscription:sub-a', 'subscription:sub-b'] },
      });

      gateway.handleDisconnect(socket);

      expect(socket.leave).toHaveBeenCalledWith('subscription:sub-a');
      expect(socket.leave).toHaveBeenCalledWith('subscription:sub-b');
      expect((socket as { data: { meterSubscriptionRooms?: string[] } }).data.meterSubscriptionRooms).toEqual([]);
    });
  });
  describe('machine tokens (PAT / app access tokens)', () => {
    const machineAdmin = (scopes: string[]) => ({
      isApiKeyAuth: false,
      userId: 'admin-1',
      userRole: UserRole.ADMIN,
      amr: ['pat'],
      scopes,
      user: { id: 'admin-1', roles: ['admin'], amr: ['pat'], scopes },
    });

    it('limits admin tokens without usage:admin to their own subscriptions', async () => {
      const socket = createMockSocket({
        data: { userInfo: machineAdmin(['websocket:billing:read', 'subscriptions:read']) },
      });

      subscriptionService.getSubscription.mockRejectedValue(new Error('not owner'));

      await gateway.handleSubscribeMeters({ subscriptionId: 'sub-other' }, socket);

      expect(subscriptionsRepository.findByIdOrThrow).not.toHaveBeenCalled();
      expect(subscriptionService.getSubscription).toHaveBeenCalledWith('sub-other', 'admin-1');
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Access denied' });
    });

    it('lets admin tokens with usage:admin watch any subscription via the per-event room only', async () => {
      const socket = createMockSocket({
        data: { userInfo: machineAdmin(['websocket:billing:read', 'subscriptions:read', 'usage:admin']) },
      });

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-other' } as never);
      billingMeterRealtime.buildMeterSummaryPayload.mockResolvedValue(null as never);

      await gateway.handleSubscribeMeters({ subscriptionId: 'sub-other' }, socket);

      expect(subscriptionService.getSubscription).not.toHaveBeenCalled();
      expect(socket.join).toHaveBeenCalledWith('subscription:sub-other#event:meterSummaryUpdate');
      expect(socket.join).not.toHaveBeenCalledWith('subscription:sub-other');

      await gateway.handleUnsubscribeMeters({ subscriptionId: 'sub-other' }, socket);

      expect(socket.leave).toHaveBeenCalledWith('subscription:sub-other#event:meterSummaryUpdate');
      expect((socket as { data: { meterSubscriptionRooms?: string[] } }).data.meterSubscriptionRooms).toEqual([]);
    });

    it('authenticates with the billing websocket scope', async () => {
      const use = jest.fn();

      socketAuth.validateAndGetUser.mockResolvedValue(null);
      gateway.afterInit({ use } as never);
      await use.mock.calls[0][0](
        { id: 's', handshake: { headers: { authorization: 'Bearer t', 'x-tenant': 'default' } } },
        jest.fn(),
      );

      expect(socketAuth.validateAndGetUser).toHaveBeenCalledWith('Bearer t', expect.any(String), {
        websocket: 'billing',
      });
    });
  });
});
