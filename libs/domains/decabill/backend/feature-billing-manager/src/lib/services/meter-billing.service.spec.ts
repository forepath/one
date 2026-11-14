import { MeterBillingService } from './meter-billing.service';

describe('MeterBillingService buildSubscriptionMeterHistory', () => {
  const meterId = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';
  const subscriptionId = '33333333-3333-4333-8333-333333333333';
  const addonId = '44444444-4444-4444-8444-444444444444';
  const meter = {
    id: meterId,
    key: 'api_calls',
    name: 'API Calls',
    unitLabel: 'calls',
    aggregator: 'sum' as const,
    defaultUnitPriceNet: '0.01',
    defaultIncludedUsage: '0',
    isActive: true,
  };
  const servicePlansRepository = { findById: jest.fn() };
  const servicePlanMetersRepository = { findByPlanId: jest.fn() };
  const serviceTypeMetersRepository = { findByServiceTypeId: jest.fn() };
  const addonMetersRepository = { findByAddonIds: jest.fn() };
  const subscriptionAddonsRepository = { findBillableBySubscriptionId: jest.fn() };
  const usageRecordsRepository = { findMeteredForSubscriptionInRange: jest.fn() };
  const service = new MeterBillingService(
    servicePlansRepository as never,
    servicePlanMetersRepository as never,
    serviceTypeMetersRepository as never,
    addonMetersRepository as never,
    subscriptionAddonsRepository as never,
    usageRecordsRepository as never,
  );
  const subscription = {
    id: subscriptionId,
    planId,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    servicePlanMetersRepository.findByPlanId.mockResolvedValue([{ meterId, meter, unitPriceNet: null }]);
    serviceTypeMetersRepository.findByServiceTypeId.mockResolvedValue([]);
    subscriptionAddonsRepository.findBillableBySubscriptionId.mockResolvedValue([]);
    addonMetersRepository.findByAddonIds.mockResolvedValue([]);
  });

  it('returns empty meters when subscription has no attachments', async () => {
    servicePlanMetersRepository.findByPlanId.mockResolvedValue([]);
    usageRecordsRepository.findMeteredForSubscriptionInRange.mockResolvedValue([]);

    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T23:59:59.999Z');
    const result = await service.buildSubscriptionMeterHistory({
      subscription: subscription as never,
      from,
      to,
      groupBy: 'day',
    });

    expect(result.subscriptionId).toBe(subscriptionId);
    expect(result.from).toBe('2026-01-01');
    expect(result.to).toBe('2026-01-31');
    expect(result.groupBy).toBe('day');
    expect(result.meters).toEqual([]);
  });

  it('buckets entries by day using periodEnd and sums per bucket', async () => {
    usageRecordsRepository.findMeteredForSubscriptionInRange.mockResolvedValue([
      {
        id: 'entry-1',
        meterId,
        value: '10',
        attachmentType: 'plan',
        addonId: null,
        periodStart: new Date('2026-01-09T00:00:00Z'),
        periodEnd: new Date('2026-01-10T12:00:00Z'),
        createdAt: new Date('2026-01-10T12:00:00Z'),
      },
      {
        id: 'entry-2',
        meterId,
        value: '5',
        attachmentType: 'plan',
        addonId: null,
        periodStart: new Date('2026-01-10T12:00:00Z'),
        periodEnd: new Date('2026-01-11T00:00:00Z'),
        createdAt: new Date('2026-01-11T00:00:00Z'),
      },
      {
        id: 'entry-3',
        meterId,
        value: '7',
        attachmentType: 'plan',
        addonId: null,
        periodStart: new Date('2026-01-10T12:00:00Z'),
        periodEnd: new Date('2026-01-11T00:00:00Z'),
        createdAt: new Date('2026-01-11T01:00:00Z'),
      },
    ]);

    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T23:59:59.999Z');
    const result = await service.buildSubscriptionMeterHistory({
      subscription: subscription as never,
      from,
      to,
      groupBy: 'day',
    });

    expect(result.meters).toHaveLength(1);
    expect(result.meters[0]?.series).toHaveLength(31);
    expect(result.meters[0]?.series.find((point) => point.period === '2026-01-10')).toEqual({
      period: '2026-01-10',
      value: 10,
    });
    expect(result.meters[0]?.series.find((point) => point.period === '2026-01-11')).toEqual({
      period: '2026-01-11',
      value: 12,
    });
    expect(result.meters[0]?.series.find((point) => point.period === '2026-01-01')).toEqual({
      period: '2026-01-01',
      value: 0,
    });
    expect(result.meters[0]?.totalValue).toBe(22);
  });

  it('buckets entries by month using periodEnd', async () => {
    usageRecordsRepository.findMeteredForSubscriptionInRange.mockResolvedValue([
      {
        id: 'entry-jan',
        meterId,
        value: '4',
        attachmentType: 'plan',
        addonId: null,
        periodStart: new Date('2026-01-20T00:00:00Z'),
        periodEnd: new Date('2026-01-25T00:00:00Z'),
        createdAt: new Date('2026-01-25T00:00:00Z'),
      },
      {
        id: 'entry-feb',
        meterId,
        value: '6',
        attachmentType: 'plan',
        addonId: null,
        periodStart: new Date('2026-02-01T00:00:00Z'),
        periodEnd: new Date('2026-02-05T00:00:00Z'),
        createdAt: new Date('2026-02-05T00:00:00Z'),
      },
    ]);

    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-02-28T23:59:59.999Z');
    const result = await service.buildSubscriptionMeterHistory({
      subscription: subscription as never,
      from,
      to,
      groupBy: 'month',
    });

    expect(result.meters[0]?.series).toEqual([
      { period: '2026-01-01', value: 4 },
      { period: '2026-02-01', value: 6 },
    ]);
    expect(result.meters[0]?.totalValue).toBe(10);
  });

  it('assigns boundary periodEnd to the correct day bucket', async () => {
    usageRecordsRepository.findMeteredForSubscriptionInRange.mockResolvedValue([
      {
        id: 'boundary',
        meterId,
        value: '3',
        attachmentType: 'plan',
        addonId: null,
        periodStart: new Date('2026-01-14T00:00:00Z'),
        periodEnd: new Date('2026-01-15T23:59:59.999Z'),
        createdAt: new Date('2026-01-15T23:59:59.999Z'),
      },
    ]);

    const from = new Date('2026-01-15T00:00:00.000Z');
    const to = new Date('2026-01-15T23:59:59.999Z');
    const result = await service.buildSubscriptionMeterHistory({
      subscription: subscription as never,
      from,
      to,
      groupBy: 'day',
    });

    expect(result.meters[0]?.series).toEqual([{ period: '2026-01-15', value: 3 }]);
  });

  it('scopes addon attachments separately from plan attachments', async () => {
    servicePlanMetersRepository.findByPlanId.mockResolvedValue([]);
    subscriptionAddonsRepository.findBillableBySubscriptionId.mockResolvedValue([
      { addonId, addonNameSnapshot: 'Extra Storage' },
    ]);
    addonMetersRepository.findByAddonIds.mockResolvedValue([{ addonId, meterId, meter, unitPriceNet: null }]);
    usageRecordsRepository.findMeteredForSubscriptionInRange.mockResolvedValue([
      {
        id: 'plan-entry',
        meterId,
        value: '100',
        attachmentType: 'plan',
        addonId: null,
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-01-02T00:00:00Z'),
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        id: 'addon-entry',
        meterId,
        value: '8',
        attachmentType: 'addon',
        addonId,
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-01-02T00:00:00Z'),
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T23:59:59.999Z');
    const result = await service.buildSubscriptionMeterHistory({
      subscription: subscription as never,
      from,
      to,
      groupBy: 'day',
    });

    expect(result.meters).toHaveLength(1);
    expect(result.meters[0]?.attachmentType).toBe('addon');
    expect(result.meters[0]?.addonId).toBe(addonId);
    expect(result.meters[0]?.totalValue).toBe(8);
  });
});

describe('MeterBillingService charges and summaries', () => {
  const meterId = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';
  const subscriptionId = '33333333-3333-4333-8333-333333333333';
  const meter = {
    id: meterId,
    key: 'api_calls',
    name: 'API Calls',
    unitLabel: 'calls',
    aggregator: 'sum' as const,
    defaultUnitPriceNet: '1',
    defaultIncludedUsage: '100',
    isActive: true,
  };
  const servicePlansRepository = { findById: jest.fn() };
  const servicePlanMetersRepository = { findByPlanId: jest.fn() };
  const serviceTypeMetersRepository = { findByServiceTypeId: jest.fn() };
  const addonMetersRepository = { findByAddonIds: jest.fn() };
  const subscriptionAddonsRepository = { findBillableBySubscriptionId: jest.fn() };
  const usageRecordsRepository = {
    findMeteredForSubscription: jest.fn(),
    findMeteredForSubscriptionInRange: jest.fn(),
  };
  const service = new MeterBillingService(
    servicePlansRepository as never,
    servicePlanMetersRepository as never,
    serviceTypeMetersRepository as never,
    addonMetersRepository as never,
    subscriptionAddonsRepository as never,
    usageRecordsRepository as never,
  );
  const subscription = {
    id: subscriptionId,
    planId,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-01-31T00:00:00Z'),
  };
  const plan = {
    id: planId,
    serviceTypeId: null,
    billInAdvance: false,
  };
  const periodStart = new Date('2026-01-01T00:00:00Z');
  const periodEnd = new Date('2026-01-31T00:00:00Z');

  beforeEach(() => {
    jest.resetAllMocks();
    servicePlanMetersRepository.findByPlanId.mockResolvedValue([
      { meterId, meter, unitPriceNet: null, includedUsage: null },
    ]);
    serviceTypeMetersRepository.findByServiceTypeId.mockResolvedValue([]);
    subscriptionAddonsRepository.findBillableBySubscriptionId.mockResolvedValue([]);
    addonMetersRepository.findByAddonIds.mockResolvedValue([]);
  });

  it('buildMeterChargeLines subtracts included usage before pricing', async () => {
    usageRecordsRepository.findMeteredForSubscription.mockResolvedValue([
      {
        id: 'entry-1',
        meterId,
        value: '150',
        attachmentType: 'plan',
        addonId: null,
        periodStart,
        periodEnd: new Date('2026-01-15T00:00:00Z'),
        createdAt: new Date('2026-01-15T00:00:00Z'),
      },
    ]);

    const lines = await service.buildMeterChargeLines({
      subscription: subscription as never,
      plan: plan as never,
      periodStart,
      periodEnd,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual(
      expect.objectContaining({
        aggregatedValue: 150,
        billableValue: 50,
        effectiveIncludedUsage: 100,
        effectiveUnitPriceNet: 1,
        unitPriceNet: 50,
      }),
    );
  });

  it('buildMeterChargeLines omits lines when usage is fully included', async () => {
    usageRecordsRepository.findMeteredForSubscription.mockResolvedValue([
      {
        id: 'entry-1',
        meterId,
        value: '40',
        attachmentType: 'plan',
        addonId: null,
        periodStart,
        periodEnd: new Date('2026-01-15T00:00:00Z'),
        createdAt: new Date('2026-01-15T00:00:00Z'),
      },
    ]);

    const lines = await service.buildMeterChargeLines({
      subscription: subscription as never,
      plan: plan as never,
      periodStart,
      periodEnd,
    });

    expect(lines).toEqual([]);
  });

  it('buildMeterChargeLines bills full usage when included usage is zero', async () => {
    const zeroIncludedMeter = { ...meter, defaultIncludedUsage: '0' };

    servicePlanMetersRepository.findByPlanId.mockResolvedValue([
      { meterId, meter: zeroIncludedMeter, unitPriceNet: null, includedUsage: null },
    ]);
    usageRecordsRepository.findMeteredForSubscription.mockResolvedValue([
      {
        id: 'entry-1',
        meterId,
        value: '75',
        attachmentType: 'plan',
        addonId: null,
        periodStart,
        periodEnd: new Date('2026-01-15T00:00:00Z'),
        createdAt: new Date('2026-01-15T00:00:00Z'),
      },
    ]);

    const lines = await service.buildMeterChargeLines({
      subscription: subscription as never,
      plan: plan as never,
      periodStart,
      periodEnd,
    });

    expect(lines[0]).toEqual(
      expect.objectContaining({
        aggregatedValue: 75,
        billableValue: 75,
        effectiveIncludedUsage: 0,
        unitPriceNet: 75,
      }),
    );
  });

  it('buildMeterChargeLines uses attachment includedUsage override', async () => {
    servicePlanMetersRepository.findByPlanId.mockResolvedValue([
      { meterId, meter, unitPriceNet: null, includedUsage: '20' },
    ]);
    usageRecordsRepository.findMeteredForSubscription.mockResolvedValue([
      {
        id: 'entry-1',
        meterId,
        value: '50',
        attachmentType: 'plan',
        addonId: null,
        periodStart,
        periodEnd: new Date('2026-01-15T00:00:00Z'),
        createdAt: new Date('2026-01-15T00:00:00Z'),
      },
    ]);

    const lines = await service.buildMeterChargeLines({
      subscription: subscription as never,
      plan: plan as never,
      periodStart,
      periodEnd,
    });

    expect(lines[0]).toEqual(
      expect.objectContaining({
        aggregatedValue: 50,
        billableValue: 30,
        effectiveIncludedUsage: 20,
        unitPriceNet: 30,
      }),
    );
  });

  it('buildSubscriptionMeterSummaries expose billableValue and estimatedChargeNet', async () => {
    usageRecordsRepository.findMeteredForSubscription.mockResolvedValue([
      {
        id: 'entry-1',
        meterId,
        value: '120',
        attachmentType: 'plan',
        addonId: null,
        periodStart,
        periodEnd: new Date('2026-01-15T00:00:00Z'),
        createdAt: new Date('2026-01-15T00:00:00Z'),
      },
    ]);

    const summaries = await service.buildSubscriptionMeterSummaries({
      subscription: subscription as never,
    });

    expect(summaries[0]).toEqual(
      expect.objectContaining({
        aggregatedValue: 120,
        billableValue: 20,
        effectiveIncludedUsage: 100,
        estimatedChargeNet: 20,
      }),
    );
  });
});
