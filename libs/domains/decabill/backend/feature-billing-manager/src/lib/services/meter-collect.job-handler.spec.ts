import { METER_COLLECT_USAGE_SOURCE } from '../dto/meter-collect.types';
import { MeterCollectJobHandler } from './meter-collect.job-handler';

describe('MeterCollectJobHandler', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');

  const subscriptionsRepository = {
    findActiveArrearForMeterCollect: jest.fn(),
    findByIdOrThrow: jest.fn(),
  };
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const subscriptionItemsRepository = {
    findBySubscription: jest.fn(),
  };
  const subscriptionAddonsRepository = {
    findActiveBySubscriptionId: jest.fn(),
  };
  const addonsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const addonMetersRepository = {
    findByAddonId: jest.fn(),
  };
  const usageRecordsRepository = {
    findLatestCollectorForMeter: jest.fn(),
  };
  const meterService = {
    listEffectivePlanMeters: jest.fn(),
  };
  const usageService = {
    createUsage: jest.fn(),
  };
  const providerModuleRegistry = {
    get: jest.fn(),
  };
  const providerRegistry = {
    getProvider: jest.fn(),
  };
  const addonModuleRegistry = {
    get: jest.fn(),
  };

  const handler = new MeterCollectJobHandler(
    subscriptionsRepository as never,
    servicePlansRepository as never,
    subscriptionItemsRepository as never,
    subscriptionAddonsRepository as never,
    addonsRepository as never,
    addonMetersRepository as never,
    usageRecordsRepository as never,
    meterService as never,
    usageService as never,
    providerModuleRegistry as never,
    providerRegistry as never,
    addonModuleRegistry as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionsRepository.findActiveArrearForMeterCollect.mockReset();
    subscriptionItemsRepository.findBySubscription.mockReset();
    usageRecordsRepository.findLatestCollectorForMeter.mockReset();
    providerModuleRegistry.get.mockReset();
    providerRegistry.getProvider.mockReset();
    usageService.createUsage.mockReset();
    meterService.listEffectivePlanMeters.mockReset();
    servicePlansRepository.findByIdOrThrow.mockReset();
    subscriptionAddonsRepository.findActiveBySubscriptionId.mockReset();
    subscriptionAddonsRepository.findActiveBySubscriptionId.mockResolvedValue([]);
  });

  const activeSub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    planId: 'plan-1',
    nextBillingAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  });

  it('writes collector usage for due plan meters', async () => {
    subscriptionsRepository.findActiveArrearForMeterCollect.mockResolvedValue([activeSub()]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        providerReference: 'srv-1',
        hostname: 'host',
        serviceTypeId: 'st-1',
        serviceType: { provider: 'acme' },
      },
    ]);
    providerRegistry.getProvider.mockReturnValue({
      id: 'acme',
      meters: [
        {
          key: 'cpu',
          name: 'CPU',
          aggregator: 'max',
          defaultUnitPriceNet: 1,
          collectionIntervalMs: 60_000,
        },
      ],
    });
    providerModuleRegistry.get.mockReturnValue({
      id: 'acme',
      collectMeters: jest.fn().mockResolvedValue([{ meterKey: 'cpu', value: 42 }]),
    });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', serviceTypeId: 'st-1' });
    meterService.listEffectivePlanMeters.mockResolvedValue([{ meterId: 'meter-1', key: 'cpu', name: 'CPU' }]);
    usageRecordsRepository.findLatestCollectorForMeter.mockResolvedValue(null);
    usageService.createUsage.mockResolvedValue({ id: 'usage-1' });

    await handler.processTenant('default', now);

    expect(providerModuleRegistry.get('acme').collectMeters).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        meterKeys: ['cpu'],
        providerReference: 'srv-1',
        periodEnd: now,
      }),
    );
    expect(usageService.createUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        meterId: 'meter-1',
        value: 42,
        usageSource: METER_COLLECT_USAGE_SOURCE,
        attachmentType: 'plan',
      }),
    );
  });

  it('skips collect when interval has not elapsed', async () => {
    subscriptionsRepository.findActiveArrearForMeterCollect.mockResolvedValue([activeSub()]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        providerReference: 'srv-1',
        serviceType: { provider: 'acme' },
      },
    ]);
    providerRegistry.getProvider.mockReturnValue({
      id: 'acme',
      meters: [
        {
          key: 'cpu',
          name: 'CPU',
          aggregator: 'max',
          defaultUnitPriceNet: 1,
          collectionIntervalMs: 60_000,
        },
      ],
    });
    providerModuleRegistry.get.mockReturnValue({
      id: 'acme',
      collectMeters: jest.fn(),
    });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', serviceTypeId: 'st-1' });
    meterService.listEffectivePlanMeters.mockResolvedValue([{ meterId: 'meter-1', key: 'cpu', name: 'CPU' }]);
    usageRecordsRepository.findLatestCollectorForMeter.mockResolvedValue({
      periodEnd: new Date(now.getTime() - 10_000),
    });

    await handler.processTenant('default', now);

    expect(providerModuleRegistry.get('acme').collectMeters).not.toHaveBeenCalled();
    expect(usageService.createUsage).not.toHaveBeenCalled();
  });

  it('writes addon collector usage when module collectMeters is due', async () => {
    subscriptionsRepository.findActiveArrearForMeterCollect.mockResolvedValue([activeSub()]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        providerReference: 'srv-1',
        serviceType: { provider: 'acme' },
      },
    ]);
    providerRegistry.getProvider.mockReturnValue({ id: 'acme', meters: [] });
    providerModuleRegistry.get.mockReturnValue({ id: 'acme', collectMeters: jest.fn().mockResolvedValue([]) });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', serviceTypeId: 'st-1' });
    meterService.listEffectivePlanMeters.mockResolvedValue([]);

    subscriptionAddonsRepository.findActiveBySubscriptionId.mockResolvedValue([
      { id: 'sa-1', addonId: 'addon-1', addon: null, configSnapshot: { a: 1 } },
    ]);
    addonsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'addon-1',
      key: 'backup',
      implementationType: 'module',
      moduleKey: 'backup-mod',
    });
    addonModuleRegistry.get.mockReturnValue({
      key: 'backup-mod',
      displayName: 'Backup',
      meters: [
        {
          key: 'storage',
          name: 'Storage',
          aggregator: 'max',
          defaultUnitPriceNet: 2,
          collectionIntervalMs: 60_000,
        },
      ],
      provision: jest.fn(),
      teardown: jest.fn(),
      collectMeters: jest.fn().mockResolvedValue([{ meterKey: 'storage', value: 9 }]),
    });
    addonMetersRepository.findByAddonId.mockResolvedValue([
      { meterId: 'meter-2', meter: { id: 'meter-2', key: 'storage' } },
    ]);
    usageRecordsRepository.findLatestCollectorForMeter.mockResolvedValue(null);
    usageService.createUsage.mockResolvedValue({ id: 'usage-2' });

    await handler.processTenant('default', now);

    expect(usageService.createUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        meterId: 'meter-2',
        value: 9,
        usageSource: METER_COLLECT_USAGE_SOURCE,
        attachmentType: 'addon',
        addonId: 'addon-1',
      }),
    );
  });

  it('isolates per-subscription errors', async () => {
    subscriptionsRepository.findActiveArrearForMeterCollect.mockResolvedValue([
      activeSub({ id: 'sub-bad' }),
      activeSub({ id: 'sub-good' }),
    ]);
    subscriptionItemsRepository.findBySubscription.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([
      {
        id: 'item-1',
        providerReference: 'srv-1',
        serviceType: { provider: 'acme' },
      },
    ]);
    providerRegistry.getProvider.mockReturnValue({
      id: 'acme',
      meters: [
        {
          key: 'cpu',
          name: 'CPU',
          aggregator: 'max',
          defaultUnitPriceNet: 1,
          collectionIntervalMs: 60_000,
        },
      ],
    });
    providerModuleRegistry.get.mockReturnValue({
      id: 'acme',
      collectMeters: jest.fn().mockResolvedValue([{ meterKey: 'cpu', value: 1 }]),
    });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', serviceTypeId: 'st-1' });
    meterService.listEffectivePlanMeters.mockResolvedValue([{ meterId: 'meter-1', key: 'cpu', name: 'CPU' }]);
    usageRecordsRepository.findLatestCollectorForMeter.mockResolvedValue(null);
    usageService.createUsage.mockResolvedValue({ id: 'usage-1' });

    await expect(handler.processTenant('default', now)).resolves.toBeUndefined();
    expect(usageService.createUsage).toHaveBeenCalled();
  });

  it('skips when collectMeters is missing for collectable meters', async () => {
    subscriptionsRepository.findActiveArrearForMeterCollect.mockResolvedValue([activeSub()]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        providerReference: 'srv-1',
        serviceType: { provider: 'acme' },
      },
    ]);
    providerRegistry.getProvider.mockReturnValue({
      id: 'acme',
      meters: [
        {
          key: 'cpu',
          name: 'CPU',
          aggregator: 'max',
          defaultUnitPriceNet: 1,
          collectionIntervalMs: 60_000,
        },
      ],
    });
    providerModuleRegistry.get.mockReturnValue(undefined);
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', serviceTypeId: 'st-1' });
    meterService.listEffectivePlanMeters.mockResolvedValue([{ meterId: 'meter-1', key: 'cpu', name: 'CPU' }]);
    usageRecordsRepository.findLatestCollectorForMeter.mockResolvedValue(null);

    await handler.processTenant('default', now);

    expect(usageService.createUsage).not.toHaveBeenCalled();
  });

  it('pages through subscription batches until exhausted', async () => {
    const firstPage = Array.from({ length: 2 }, (_, index) => activeSub({ id: `sub-${index}` }));
    const originalBatchSize = (handler as unknown as { batchSize: number }).batchSize;
    Object.defineProperty(handler, 'batchSize', { value: 2, configurable: true });
    subscriptionsRepository.findActiveArrearForMeterCollect
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([activeSub({ id: 'sub-2' })])
      .mockResolvedValueOnce([]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([]);

    try {
      await handler.processTenant('default', now);

      expect(subscriptionsRepository.findActiveArrearForMeterCollect).toHaveBeenNthCalledWith(1, 2, 0);
      expect(subscriptionsRepository.findActiveArrearForMeterCollect).toHaveBeenNthCalledWith(2, 2, 2);
      expect(subscriptionsRepository.findActiveArrearForMeterCollect).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(handler, 'batchSize', { value: originalBatchSize, configurable: true });
    }
  });

  it('clamps collector periodEnd to nextBillingAt when collect runs after period end', async () => {
    const nextBillingAt = new Date('2026-08-06T11:00:00.000Z');
    subscriptionsRepository.findActiveArrearForMeterCollect.mockResolvedValue([activeSub({ nextBillingAt })]);
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        providerReference: 'srv-1',
        serviceType: { provider: 'acme' },
      },
    ]);
    providerRegistry.getProvider.mockReturnValue({
      id: 'acme',
      meters: [
        {
          key: 'cpu',
          name: 'CPU',
          aggregator: 'max',
          defaultUnitPriceNet: 1,
          collectionIntervalMs: 60_000,
        },
      ],
    });
    providerModuleRegistry.get.mockReturnValue({
      id: 'acme',
      collectMeters: jest.fn().mockResolvedValue([{ meterKey: 'cpu', value: 7 }]),
    });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', serviceTypeId: 'st-1' });
    meterService.listEffectivePlanMeters.mockResolvedValue([{ meterId: 'meter-1', key: 'cpu', name: 'CPU' }]);
    usageRecordsRepository.findLatestCollectorForMeter.mockResolvedValue({
      periodEnd: new Date('2026-08-06T10:00:00.000Z'),
    });
    usageService.createUsage.mockResolvedValue({ id: 'usage-1' });

    await handler.processTenant('default', now);

    expect(usageService.createUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        periodEnd: nextBillingAt,
        value: 7,
      }),
    );
  });
});
