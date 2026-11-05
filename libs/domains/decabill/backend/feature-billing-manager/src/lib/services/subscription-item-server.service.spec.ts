import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { ProvisioningStatus } from '../entities/subscription-item.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { SubscriptionItemServerService } from './subscription-item-server.service';

describe('SubscriptionItemServerService', () => {
  const subscriptionService = {
    getSubscription: jest.fn().mockResolvedValue({ id: 'sub-1', userId: 'user-1', planId: 'plan-1', number: 'S-1' }),
  };
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn().mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
    }),
  };
  const subscriptionItemsRepository = {
    findBySubscription: jest.fn(),
    findByIdAndSubscriptionId: jest.fn(),
    claimSshAccessGranted: jest.fn(),
    updateDisplayName: jest.fn(),
    updateServerInfoSnapshot: jest.fn(),
  };
  const provisioningService = {
    getServerInfo: jest.fn(),
    startServer: jest.fn(),
    stopServer: jest.fn(),
    restartServer: jest.fn(),
  };
  const cloudflareDnsService = {
    getFqdn: jest.fn((hostname: string) => `${hostname}.example.test`),
  };
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Starter' }),
  };
  const billingNotificationPublisher = {
    publish: jest.fn(),
    publishSshAccessGranted: jest.fn(),
  };
  const billingEmailPublisher = {
    publishSshAccessGranted: jest.fn().mockResolvedValue(undefined),
  };
  const subscriptionAddonsRepository = {
    findActiveBySubscriptionId: jest.fn().mockResolvedValue([]),
  };
  const addonModuleRegistry = {
    get: jest.fn(),
    has: jest.fn(),
    list: jest.fn().mockReturnValue([]),
  };
  const containerManagerService = {
    getCachedSummary: jest.fn().mockResolvedValue(null),
  };
  const integratedStackRegistry = {
    get: jest.fn(),
    has: jest.fn(),
    list: jest.fn().mockReturnValue([]),
  };
  const cloudInitModuleRegistry = {
    get: jest.fn(),
    has: jest.fn(),
    list: jest.fn().mockReturnValue([]),
  };
  const cloudInitConfigsRepository = {
    findById: jest.fn(),
  };
  const service = new SubscriptionItemServerService(
    subscriptionService as never,
    subscriptionsRepository as never,
    subscriptionItemsRepository as never,
    subscriptionAddonsRepository as never,
    provisioningService as never,
    cloudflareDnsService as never,
    servicePlansRepository as never,
    billingNotificationPublisher as never,
    billingEmailPublisher as never,
    addonModuleRegistry as never,
    containerManagerService as never,
    integratedStackRegistry as never,
    cloudInitModuleRegistry as never,
    cloudInitConfigsRepository as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
    });
    subscriptionService.getSubscription.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      number: 'S-1',
    });
    subscriptionAddonsRepository.findActiveBySubscriptionId.mockResolvedValue([]);
    integratedStackRegistry.get.mockReturnValue(undefined);
    cloudInitModuleRegistry.get.mockReturnValue(undefined);
    cloudInitConfigsRepository.findById.mockResolvedValue(null);
  });

  describe('listItems', () => {
    it('maps custom service, displayName, and sshAccessGranted from config snapshot', async () => {
      subscriptionItemsRepository.findBySubscription.mockResolvedValue([
        {
          id: 'item-1',
          subscriptionId: 'sub-1',
          serviceTypeId: 'st-1',
          serviceType: { name: 'Hetzner' },
          provisioningStatus: ProvisioningStatus.ACTIVE,
          hostname: 'host1',
          displayName: 'Production',
          configSnapshot: { service: 'custom', cloudInitConfigId: 'cfg-1' },
          sshAccessGrantedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

      const items = await service.listItems('sub-1', 'user-1');

      expect(items[0]?.service).toBe('custom');
      expect(items[0]?.serviceTypeName).toBe('Hetzner');
      expect(items[0]?.displayName).toBe('Production');
      expect(items[0]?.sshAccessGranted).toBe(true);
      expect(items[0]?.hasProviderReference).toBe(false);
    });

    it('maps sshAccessGranted false when marker is unset', async () => {
      subscriptionItemsRepository.findBySubscription.mockResolvedValue([
        {
          id: 'item-1',
          subscriptionId: 'sub-1',
          serviceTypeId: 'st-1',
          serviceType: { name: 'DigitalOcean' },
          provisioningStatus: ProvisioningStatus.ACTIVE,
          hostname: 'host1',
          displayName: null,
          providerReference: 'srv-1',
          configSnapshot: { service: 'agenstra-controller' },
        },
      ]);

      const items = await service.listItems('sub-1', 'user-1');

      expect(items[0]?.serviceTypeName).toBe('DigitalOcean');
      expect(items[0]?.displayName).toBeNull();
      expect(items[0]?.sshAccessGranted).toBe(false);
      expect(items[0]?.hasProviderReference).toBe(true);
    });

    it('maps empty serviceTypeName when relation is missing', async () => {
      subscriptionItemsRepository.findBySubscription.mockResolvedValue([
        {
          id: 'item-1',
          subscriptionId: 'sub-1',
          serviceTypeId: 'st-1',
          provisioningStatus: ProvisioningStatus.ACTIVE,
          hostname: 'host1',
          configSnapshot: { service: 'agenstra-controller' },
        },
      ]);

      const items = await service.listItems('sub-1', 'user-1');

      expect(items[0]?.serviceTypeName).toBe('');
      expect(items[0]?.displayName).toBeNull();
    });

    it('maps null serviceTypeId as null', async () => {
      subscriptionItemsRepository.findBySubscription.mockResolvedValue([
        {
          id: 'item-1',
          subscriptionId: 'sub-1',
          serviceTypeId: null,
          provisioningStatus: ProvisioningStatus.ACTIVE,
          hostname: undefined,
          configSnapshot: {},
        },
      ]);

      const items = await service.listItems('sub-1', 'user-1');

      expect(items[0]?.serviceTypeId).toBeNull();
      expect(items[0]?.serviceTypeName).toBe('');
      expect(items[0]?.service).toBeUndefined();
    });
  });

  describe('getItemDetail', () => {
    const activeItem = {
      id: 'item-1',
      subscriptionId: 'sub-1',
      serviceTypeId: 'st-1',
      serviceType: { name: 'Hetzner', provider: 'hetzner' },
      provisioningStatus: ProvisioningStatus.ACTIVE,
      providerReference: 'srv-1',
      hostname: 'host1',
      displayName: 'Prod',
      configSnapshot: { service: 'agenstra-controller' },
      serverInfoSnapshot: {
        name: 'host1',
        publicIp: '203.0.113.10',
        status: 'running',
        metadata: { provider: 'hetzner', location: 'fsn1', locationName: 'Falkenstein' },
      },
    };

    it('returns item detail with cached server info for active provisioned items', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(activeItem);

      const detail = await service.getItemDetail('sub-1', 'item-1', 'user-1');

      expect(detail.id).toBe('item-1');
      expect(detail.displayName).toBe('Prod');
      expect(detail.serverInfo).toEqual(
        expect.objectContaining({
          name: 'host1',
          publicIp: '203.0.113.10',
          status: 'running',
          hostname: 'host1',
          hostnameFqdn: 'host1.example.test',
          metadata: expect.objectContaining({ location: 'fsn1', locationName: 'Falkenstein' }),
        }),
      );
      expect(provisioningService.getServerInfo).not.toHaveBeenCalled();
    });

    it('merges integrated stack tabs into item detail', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(activeItem);
      integratedStackRegistry.get.mockReturnValue({
        key: 'agenstra-controller',
        displayName: 'Agenstra Controller',
        serviceTabs: [{ id: 'controller-ops', label: 'Controller', order: 40 }],
      });

      const detail = await service.getItemDetail('sub-1', 'item-1', 'user-1');

      expect(detail.tabs).toEqual([
        { id: 'details', label: 'Details', order: 0, moduleKey: null, source: 'details' },
        {
          id: 'controller-ops',
          label: 'Controller',
          order: 40,
          moduleKey: 'agenstra-controller',
          source: 'integrated',
        },
      ]);
      expect(integratedStackRegistry.get).toHaveBeenCalledWith('agenstra-controller');
    });

    it('merges CloudInit entity and code-module tabs for custom items', async () => {
      const configId = '11111111-1111-4111-8111-111111111111';
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
        ...activeItem,
        configSnapshot: { service: 'custom', cloudInitConfigId: configId },
      });
      cloudInitConfigsRepository.findById.mockResolvedValue({
        id: configId,
        key: 'my-app',
        serviceTabs: [{ id: 'app-status', label: 'App status', order: 30 }],
      });
      cloudInitModuleRegistry.get.mockReturnValue({
        key: 'my-app',
        displayName: 'My App',
        serviceTabs: [{ id: 'app-logs', label: 'Logs', order: 50 }],
      });

      const detail = await service.getItemDetail('sub-1', 'item-1', 'user-1');

      expect(detail.tabs.map((tab) => tab.id)).toEqual(['details', 'app-status', 'app-logs']);
      expect(detail.tabs.find((tab) => tab.id === 'app-status')).toEqual({
        id: 'app-status',
        label: 'App status',
        order: 30,
        moduleKey: 'my-app',
        source: 'cloud-init',
      });
      expect(cloudInitConfigsRepository.findById).toHaveBeenCalledWith(configId);
      expect(cloudInitModuleRegistry.get).toHaveBeenCalledWith('my-app');
    });

    it('enriches location from config snapshot when cached server info omits geography', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
        ...activeItem,
        configSnapshot: { service: 'agenstra-controller', location: 'nbg1', region: 'nbg1' },
        serverInfoSnapshot: {
          name: 'host1',
          publicIp: '203.0.113.10',
          status: 'running',
          metadata: { provider: 'hetzner' },
        },
      });
      provisioningService.getServerInfo.mockResolvedValue(undefined);

      const detail = await service.getItemDetail('sub-1', 'item-1', 'user-1');

      expect(detail.serverInfo?.metadata).toEqual(
        expect.objectContaining({
          provider: 'hetzner',
          location: 'nbg1',
          region: 'nbg1',
        }),
      );
    });

    it('keeps cached server info when live provider refresh fails', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
        ...activeItem,
        serverInfoSnapshot: {
          name: 'host1',
          publicIp: '203.0.113.10',
          status: 'running',
          metadata: { provider: 'hetzner' },
        },
      });
      provisioningService.getServerInfo.mockRejectedValue(new Error('provider timeout'));

      const detail = await service.getItemDetail('sub-1', 'item-1', 'user-1');

      expect(detail.serverInfo).toEqual(
        expect.objectContaining({
          name: 'host1',
          publicIp: '203.0.113.10',
          status: 'running',
        }),
      );
    });

    it('rejects items on canceled subscriptions even when provider reference remains', async () => {
      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.CANCELED,
      });
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(activeItem);

      await expect(service.getItemDetail('sub-1', 'item-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns detail while pending withdrawal when the item is still provisioned', async () => {
      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
      });
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(activeItem);

      const detail = await service.getItemDetail('sub-1', 'item-1', 'user-1');

      expect(detail.id).toBe('item-1');
      expect(detail.hasProviderReference).toBe(true);
    });

    it('returns detail while pending instant cancel when the item is still provisioned', async () => {
      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_INSTANT_CANCEL,
      });
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(activeItem);

      const detail = await service.getItemDetail('sub-1', 'item-1', 'user-1');

      expect(detail.id).toBe('item-1');
    });

    it('rejects removed items without provider reference', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
        ...activeItem,
        providerReference: undefined,
      });

      await expect(service.getItemDetail('sub-1', 'item-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects non-active items', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
        ...activeItem,
        provisioningStatus: ProvisioningStatus.FAILED,
      });

      await expect(service.getItemDetail('sub-1', 'item-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects missing items', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(null);

      await expect(service.getItemDetail('sub-1', 'item-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getItemDetailAsAdmin loads detail without subscription ownership check', async () => {
      const item = {
        id: 'item-1',
        subscriptionId: 'sub-1',
        serviceTypeId: 'st-1',
        serviceType: { name: 'Hetzner' },
        provisioningStatus: ProvisioningStatus.ACTIVE,
        providerReference: 'srv-1',
        hostname: 'host1',
        displayName: 'Production',
        configSnapshot: { service: 'agenstra-controller' },
        serverInfoSnapshot: {
          name: 'server-1',
          publicIp: '1.2.3.4',
          status: 'running',
        },
      };

      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(item);

      const detail = await service.getItemDetailAsAdmin('sub-1', 'item-1');

      expect(subscriptionsRepository.findByIdOrThrow).toHaveBeenCalledWith('sub-1');
      expect(subscriptionService.getSubscription).not.toHaveBeenCalled();
      expect(detail.displayName).toBe('Production');
      expect(detail.serverInfo?.publicIp).toBe('1.2.3.4');
    });
  });

  describe('updateDisplayName', () => {
    const item = {
      id: 'item-1',
      subscriptionId: 'sub-1',
      serviceTypeId: 'st-1',
      serviceType: { name: 'Hetzner' },
      provisioningStatus: ProvisioningStatus.ACTIVE,
      providerReference: 'srv-1',
      configSnapshot: { service: 'agenstra-controller' },
    };

    it('trims and persists display name', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValueOnce(item).mockResolvedValueOnce({
        ...item,
        displayName: 'My Service',
      });
      subscriptionItemsRepository.updateDisplayName.mockResolvedValue(undefined);

      const result = await service.updateDisplayName('sub-1', 'item-1', 'user-1', '  My Service  ');

      expect(subscriptionItemsRepository.updateDisplayName).toHaveBeenCalledWith('item-1', 'My Service');
      expect(result.displayName).toBe('My Service');
      expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
        'subscription.service.renamed',
        {
          subscriptionId: 'sub-1',
          itemId: 'item-1',
          displayName: 'My Service',
        },
        'user-1',
      );
    });

    it('clears display name for empty strings', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValueOnce(item).mockResolvedValueOnce({
        ...item,
        displayName: null,
      });
      subscriptionItemsRepository.updateDisplayName.mockResolvedValue(undefined);

      const result = await service.updateDisplayName('sub-1', 'item-1', 'user-1', '   ');

      expect(subscriptionItemsRepository.updateDisplayName).toHaveBeenCalledWith('item-1', null);
      expect(result.displayName).toBeNull();
    });

    it('rejects display names longer than 255 characters', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(item);

      await expect(service.updateDisplayName('sub-1', 'item-1', 'user-1', 'x'.repeat(256))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(subscriptionItemsRepository.updateDisplayName).not.toHaveBeenCalled();
    });

    it('rejects missing items', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(null);

      await expect(service.updateDisplayName('sub-1', 'item-1', 'user-1', 'Name')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects removed items without provider reference', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
        ...item,
        providerReference: undefined,
      });

      await expect(service.updateDisplayName('sub-1', 'item-1', 'user-1', 'Name')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(subscriptionItemsRepository.updateDisplayName).not.toHaveBeenCalled();
    });

    it('rejects non-active items', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
        ...item,
        provisioningStatus: ProvisioningStatus.FAILED,
      });

      await expect(service.updateDisplayName('sub-1', 'item-1', 'user-1', 'Name')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(subscriptionItemsRepository.updateDisplayName).not.toHaveBeenCalled();
    });
  });

  describe('getSshAccessKey', () => {
    const provisionedItem = {
      id: 'item-1',
      subscriptionId: 'sub-1',
      providerReference: 'srv-1',
      provisioningStatus: ProvisioningStatus.ACTIVE,
      hostname: 'host1',
      sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
    };

    it('returns private key once and publishes notifications', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(provisionedItem);
      subscriptionItemsRepository.claimSshAccessGranted.mockResolvedValue(true);

      const result = await service.getSshAccessKey('sub-1', 'item-1', 'user-1');

      expect(result.privateKey).toContain('BEGIN OPENSSH PRIVATE KEY');
      expect(subscriptionItemsRepository.claimSshAccessGranted).toHaveBeenCalledWith('item-1');
      expect(billingNotificationPublisher.publishSshAccessGranted).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'item-1',
          hostname: 'host1',
        }),
      );
      expect(billingEmailPublisher.publishSshAccessGranted).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub-1' }),
        'Starter',
        expect.objectContaining({ itemId: 'item-1', hostname: 'host1' }),
      );
    });

    it('rejects when access was already granted', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(provisionedItem);
      subscriptionItemsRepository.claimSshAccessGranted.mockResolvedValue(false);

      await expect(service.getSshAccessKey('sub-1', 'item-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
      expect(billingNotificationPublisher.publishSshAccessGranted).not.toHaveBeenCalled();
      expect(billingEmailPublisher.publishSshAccessGranted).not.toHaveBeenCalled();
    });

    it('rejects when SSH key is missing', async () => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue({
        ...provisionedItem,
        sshPrivateKey: undefined,
      });

      await expect(service.getSshAccessKey('sub-1', 'item-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(subscriptionItemsRepository.claimSshAccessGranted).not.toHaveBeenCalled();
    });
  });

  describe('power actions', () => {
    const provisionedItem = {
      id: 'item-1',
      subscriptionId: 'sub-1',
      providerReference: 'srv-1',
      provisioningStatus: ProvisioningStatus.ACTIVE,
      serviceType: { provider: 'hetzner', providerDefaults: {} },
    };

    beforeEach(() => {
      subscriptionItemsRepository.findByIdAndSubscriptionId.mockResolvedValue(provisionedItem);
    });

    it('routes admin power-action webhooks to the subscription owner, not the acting admin', async () => {
      await service.startServerAsAdmin('sub-1', 'item-1', 'admin-1');
      await service.stopServerAsAdmin('sub-1', 'item-1', 'admin-1');
      await service.restartServerAsAdmin('sub-1', 'item-1', 'admin-1');

      for (const type of [
        'subscription.service.started',
        'subscription.service.stopped',
        'subscription.service.restarted',
      ]) {
        expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
          type,
          { subscriptionId: 'sub-1', itemId: 'item-1' },
          'user-1',
        );
      }

      expect(billingNotificationPublisher.publish).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'admin-1',
      );
    });

    it('publishes started notification after startServer', async () => {
      await service.startServer('sub-1', 'item-1', 'user-1');

      expect(provisioningService.startServer).toHaveBeenCalled();
      expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
        'subscription.service.started',
        { subscriptionId: 'sub-1', itemId: 'item-1' },
        'user-1',
      );
    });

    it('publishes stopped notification after stopServer', async () => {
      await service.stopServer('sub-1', 'item-1', 'user-1');

      expect(provisioningService.stopServer).toHaveBeenCalled();
      expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
        'subscription.service.stopped',
        { subscriptionId: 'sub-1', itemId: 'item-1' },
        'user-1',
      );
    });

    it('publishes restarted notification after restartServer', async () => {
      await service.restartServer('sub-1', 'item-1', 'user-1');

      expect(provisioningService.restartServer).toHaveBeenCalled();
      expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
        'subscription.service.restarted',
        { subscriptionId: 'sub-1', itemId: 'item-1' },
        'user-1',
      );
    });
  });
});
