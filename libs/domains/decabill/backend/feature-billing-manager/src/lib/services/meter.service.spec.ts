import { BadRequestException } from '@nestjs/common';

import { MeterService } from './meter.service';

describe('MeterService', () => {
  const metersRepository = {
    create: jest.fn(),
    update: jest.fn(),
    findByIdOrThrow: jest.fn(),
    findByKey: jest.fn(),
    delete: jest.fn(),
  };
  const servicePlanMetersRepository = {
    countByMeterId: jest.fn(),
    findByPlanId: jest.fn(),
    findByPlanAndMeter: jest.fn(),
    findByPlanAndMeterOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteByPlanAndMeter: jest.fn(),
  };
  const addonMetersRepository = {
    countByMeterId: jest.fn(),
    findByAddonId: jest.fn(),
    findByAddonAndMeter: jest.fn(),
    findByAddonAndMeterOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteByAddonAndMeter: jest.fn(),
  };
  const serviceTypeMetersRepository = {
    countByMeterId: jest.fn(),
    findByServiceTypeId: jest.fn(),
    findByServiceTypeAndMeter: jest.fn(),
    findByServiceTypeAndMeterOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteByServiceTypeAndMeter: jest.fn(),
  };
  const usageRecordsRepository = {
    countByMeterId: jest.fn(),
  };
  const billingNotificationPublisher = {
    publish: jest.fn(),
  };
  const addonModuleRegistry = {
    get: jest.fn(),
  };
  const providerRegistry = {
    getProvider: jest.fn(),
  };

  const service = new MeterService(
    metersRepository as never,
    servicePlanMetersRepository as never,
    addonMetersRepository as never,
    serviceTypeMetersRepository as never,
    usageRecordsRepository as never,
    billingNotificationPublisher as never,
    addonModuleRegistry as never,
    providerRegistry as never,
  );

  const catalogMeter = {
    id: 'meter-1',
    key: 'traffic',
    name: 'Traffic',
    description: null,
    unitLabel: 'GB',
    aggregator: 'max' as const,
    defaultUnitPriceNet: '0.01',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks delete when meter is still referenced', async () => {
    metersRepository.findByIdOrThrow.mockResolvedValue({ id: 'meter-1', key: 'traffic' });
    servicePlanMetersRepository.countByMeterId.mockResolvedValue(1);
    addonMetersRepository.countByMeterId.mockResolvedValue(0);
    serviceTypeMetersRepository.countByMeterId.mockResolvedValue(0);
    usageRecordsRepository.countByMeterId.mockResolvedValue(0);

    await expect(service.deleteMeter('meter-1')).rejects.toThrow(BadRequestException);
    expect(metersRepository.delete).not.toHaveBeenCalled();
  });

  it('publishes meter.created on create', async () => {
    metersRepository.findByKey.mockResolvedValue(null);
    metersRepository.create.mockResolvedValue(catalogMeter);

    await service.createMeter({
      key: 'traffic',
      name: 'Traffic',
      aggregator: 'max',
      defaultUnitPriceNet: 0.01,
    });

    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'meter.created',
      expect.objectContaining({ meterId: 'meter-1', key: 'traffic' }),
    );
  });

  it('ensureCatalogMeter returns existing meter without clobbering defaults', async () => {
    metersRepository.findByKey.mockResolvedValue(catalogMeter);

    const result = await service.ensureCatalogMeter({
      key: 'traffic',
      name: 'New name',
      aggregator: 'avg',
      defaultUnitPriceNet: 9.99,
    });

    expect(result).toBe(catalogMeter);
    expect(metersRepository.create).not.toHaveBeenCalled();
  });

  it('ensureCatalogMeter creates missing catalog meters', async () => {
    metersRepository.findByKey.mockResolvedValue(null);
    metersRepository.create.mockResolvedValue(catalogMeter);

    await service.ensureCatalogMeter({
      key: 'traffic',
      name: 'Traffic',
      aggregator: 'max',
      defaultUnitPriceNet: 0.01,
    });

    expect(metersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'traffic',
        name: 'Traffic',
        aggregator: 'max',
        defaultUnitPriceNet: '0.01',
        isActive: true,
      }),
    );
  });

  it('syncAddonModuleMeters sideloads required module meters', async () => {
    addonModuleRegistry.get.mockReturnValue({
      key: 'backup',
      displayName: 'Backup',
      meters: [{ key: 'traffic', name: 'Traffic', aggregator: 'max', defaultUnitPriceNet: 0.01 }],
    });
    metersRepository.findByKey.mockResolvedValue(catalogMeter);
    addonMetersRepository.findByAddonId.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'link-1',
        addonId: 'addon-1',
        meterId: 'meter-1',
        unitPriceNet: null,
        source: 'module',
        required: true,
        meter: catalogMeter,
      },
    ]);
    addonMetersRepository.create.mockResolvedValue({
      id: 'link-1',
      addonId: 'addon-1',
      meterId: 'meter-1',
      unitPriceNet: null,
      source: 'module',
      required: true,
    });

    const result = await service.syncAddonModuleMeters({
      id: 'addon-1',
      implementationType: 'module',
      moduleKey: 'backup',
    } as never);

    expect(addonMetersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        addonId: 'addon-1',
        meterId: 'meter-1',
        source: 'module',
        required: true,
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].required).toBe(true);
    expect(result[0].source).toBe('module');
  });

  it('syncServiceTypeProviderMeters sideloads required provider meters', async () => {
    providerRegistry.getProvider.mockReturnValue({
      id: 'hetzner',
      displayName: 'Hetzner',
      meters: [{ key: 'traffic', name: 'Traffic', aggregator: 'max', defaultUnitPriceNet: 0.01 }],
    });
    metersRepository.findByKey.mockResolvedValue(catalogMeter);
    serviceTypeMetersRepository.findByServiceTypeId.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'link-1',
        serviceTypeId: 'st-1',
        meterId: 'meter-1',
        unitPriceNet: null,
        source: 'provider',
        required: true,
        meter: catalogMeter,
      },
    ]);
    serviceTypeMetersRepository.create.mockResolvedValue({
      id: 'link-1',
      serviceTypeId: 'st-1',
      meterId: 'meter-1',
      unitPriceNet: null,
      source: 'provider',
      required: true,
    });

    const result = await service.syncServiceTypeProviderMeters({
      id: 'st-1',
      provider: 'hetzner',
    } as never);

    expect(serviceTypeMetersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceTypeId: 'st-1',
        meterId: 'meter-1',
        source: 'provider',
        required: true,
      }),
    );
    expect(result[0].source).toBe('provider');
    expect(result[0].required).toBe(true);
  });

  it('rejects detach of required service type meters', async () => {
    serviceTypeMetersRepository.findByServiceTypeAndMeterOrThrow.mockResolvedValue({
      id: 'link-1',
      required: true,
      source: 'provider',
    });

    await expect(service.detachServiceTypeMeter('st-1', 'meter-1')).rejects.toThrow(BadRequestException);
    expect(serviceTypeMetersRepository.deleteByServiceTypeAndMeter).not.toHaveBeenCalled();
  });

  it('rejects detach of required addon meters', async () => {
    addonMetersRepository.findByAddonAndMeterOrThrow.mockResolvedValue({
      id: 'link-1',
      required: true,
      source: 'module',
    });

    await expect(service.detachAddonMeter('addon-1', 'meter-1')).rejects.toThrow(BadRequestException);
    expect(addonMetersRepository.deleteByAddonAndMeter).not.toHaveBeenCalled();
  });

  it('listEffectivePlanMeters unions plan and service-type meters', async () => {
    servicePlanMetersRepository.findByPlanId.mockResolvedValue([
      {
        id: 'plan-link',
        meterId: 'meter-plan',
        unitPriceNet: null,
        source: 'manual',
        required: false,
        meter: { ...catalogMeter, id: 'meter-plan', key: 'plan-only' },
      },
    ]);
    serviceTypeMetersRepository.findByServiceTypeId.mockResolvedValue([
      {
        id: 'type-link',
        meterId: 'meter-1',
        unitPriceNet: null,
        source: 'provider',
        required: true,
        meter: catalogMeter,
      },
    ]);

    const result = await service.listEffectivePlanMeters('plan-1', 'st-1');

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.meterId === 'meter-1')?.inherited).toBe(true);
    expect(result.find((item) => item.meterId === 'meter-plan')?.inherited).toBeUndefined();
  });

  it('isPlanMeterAttached accepts inherited service-type meters', async () => {
    servicePlanMetersRepository.findByPlanAndMeter.mockResolvedValue(null);
    serviceTypeMetersRepository.findByServiceTypeAndMeter.mockResolvedValue({ id: 'type-link' });

    await expect(service.isPlanMeterAttached('plan-1', 'st-1', 'meter-1')).resolves.toBe(true);
  });
});
