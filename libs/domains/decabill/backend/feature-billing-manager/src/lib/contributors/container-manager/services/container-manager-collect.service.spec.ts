import { ContainerManagerCollectService } from './container-manager-collect.service';

describe('ContainerManagerCollectService', () => {
  const subscriptionItemsRepository = {
    findLiveProvisionedWithSshKey: jest.fn(),
  };
  const subscriptionAddonsRepository = {
    findActiveBySubscriptionId: jest.fn(),
  };
  const samplesRepository = {
    insertSample: jest.fn().mockResolvedValue(undefined),
    trimToMaxPoints: jest.fn().mockResolvedValue(undefined),
  };
  const summariesRepository = {
    upsertSummary: jest.fn().mockResolvedValue(undefined),
  };
  const containerManagerService = {
    collectLiveContainersForItem: jest.fn(),
    notifyCollectionFailed: jest.fn().mockResolvedValue(undefined),
  };
  const eligibleItem = {
    id: 'item-1',
    subscriptionId: 'sub-1',
    providerReference: 'srv-1',
    sshPrivateKey: 'KEY',
    serverInfoSnapshot: { publicIp: '1.2.3.4' },
  };
  const activeAddon = {
    status: 'active',
    addon: { implementationType: 'module', moduleKey: 'container-manager' },
  };
  const service = new ContainerManagerCollectService(
    subscriptionItemsRepository as never,
    subscriptionAddonsRepository as never,
    samplesRepository as never,
    summariesRepository as never,
    containerManagerService as never,
  );
  const ctx = {
    tenantId: 'default',
    now: new Date('2026-08-17T12:00:00.000Z'),
    source: 'addon' as const,
    sourceKey: 'container-manager',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionItemsRepository.findLiveProvisionedWithSshKey.mockResolvedValue([eligibleItem]);
    subscriptionAddonsRepository.findActiveBySubscriptionId.mockResolvedValue([activeAddon]);
  });

  it('persists samples, trims to 60, and updates summary for eligible items', async () => {
    containerManagerService.collectLiveContainersForItem.mockResolvedValue({
      collectedAt: '2026-08-17T12:00:00.000Z',
      containers: [
        {
          id: 'abcdef123456',
          name: 'web',
          image: 'nginx',
          state: 'running',
          status: 'Up',
          createdAt: null,
          stats: {
            cpuPercent: 1.5,
            memoryPercent: 10,
            memoryUsageBytes: 10,
            memoryLimitBytes: 100,
            blockReadBytes: 1,
            blockWriteBytes: 2,
            networkRxBytes: 3,
            networkTxBytes: 4,
          },
        },
      ],
    });

    await service.collectTenant(ctx);

    expect(samplesRepository.insertSample).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        itemId: 'item-1',
        containerId: 'abcdef123456',
      }),
    );
    expect(samplesRepository.trimToMaxPoints).toHaveBeenCalledWith('item-1', 'abcdef123456', 60);
    expect(summariesRepository.upsertSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        containerCount: 1,
        healthyCount: 1,
      }),
    );
  });

  it('skips items without an active container-manager addon', async () => {
    subscriptionAddonsRepository.findActiveBySubscriptionId.mockResolvedValue([]);

    await service.collectTenant(ctx);

    expect(containerManagerService.collectLiveContainersForItem).not.toHaveBeenCalled();
  });

  it('skips items without a literal public IP', async () => {
    subscriptionItemsRepository.findLiveProvisionedWithSshKey.mockResolvedValue([
      { ...eligibleItem, serverInfoSnapshot: { publicIp: 'evil.example' } },
    ]);

    await service.collectTenant(ctx);

    expect(containerManagerService.collectLiveContainersForItem).not.toHaveBeenCalled();
  });

  it('skips canceled subscriptions because they are not returned by the live query', async () => {
    subscriptionItemsRepository.findLiveProvisionedWithSshKey.mockResolvedValue([]);

    await service.collectTenant(ctx);

    expect(containerManagerService.collectLiveContainersForItem).not.toHaveBeenCalled();
  });

  it('publishes a webhook and does not throw when SSH collection fails', async () => {
    containerManagerService.collectLiveContainersForItem.mockRejectedValue(new Error('ssh down'));

    await expect(service.collectTenant(ctx)).resolves.toBeUndefined();
    expect(containerManagerService.notifyCollectionFailed).toHaveBeenCalledWith('sub-1', 'item-1', expect.any(Error));
    expect(samplesRepository.insertSample).not.toHaveBeenCalled();
  });
});
