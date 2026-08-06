import { BadRequestException } from '@nestjs/common';

import { UsageService } from './usage.service';

describe('UsageService', () => {
  const usageRecordsRepository = {
    findLatestForSubscription: jest.fn(),
    create: jest.fn(),
    findMeteredForSubscription: jest.fn(),
    findByIdForSubscriptionOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const servicePlanMetersRepository = {
    findByPlanAndMeter: jest.fn(),
  };
  const serviceTypeMetersRepository = {
    findByServiceTypeAndMeter: jest.fn(),
  };
  const addonMetersRepository = {
    findByAddonAndMeter: jest.fn(),
  };
  const subscriptionAddonsRepository = {
    findBillableBySubscriptionId: jest.fn().mockResolvedValue([]),
  };
  const meterBillingService = {
    hasAnyMeterAttachments: jest.fn().mockResolvedValue(false),
  };
  const billingNotificationPublisher = {
    publish: jest.fn(),
  };
  const service = new UsageService(
    usageRecordsRepository as never,
    subscriptionsRepository as never,
    servicePlansRepository as never,
    servicePlanMetersRepository as never,
    serviceTypeMetersRepository as never,
    addonMetersRepository as never,
    subscriptionAddonsRepository as never,
    meterBillingService as never,
    billingNotificationPublisher as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    meterBillingService.hasAnyMeterAttachments.mockResolvedValue(false);
  });

  it('rejects usage records for advance-billed subscriptions', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', planId: 'plan-1' });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', billInAdvance: true });

    await expect(
      service.createUsage({
        subscriptionId: 'sub-1',
        periodStart: new Date(),
        periodEnd: new Date(),
        usageSource: 'admin',
        usagePayload: { totalCost: 1 },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(usageRecordsRepository.create).not.toHaveBeenCalled();
  });

  it('creates legacy usage records for arrear-billed subscriptions without meters', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', planId: 'plan-1' });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', billInAdvance: false });
    usageRecordsRepository.create.mockResolvedValue({
      id: 'usage-1',
      subscriptionId: 'sub-1',
      meterId: null,
      attachmentType: null,
      addonId: null,
      value: null,
    });

    const dto = {
      subscriptionId: 'sub-1',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-02-01'),
      usageSource: 'admin',
      usagePayload: { totalCost: 1 },
    };

    await expect(service.createUsage(dto)).resolves.toEqual(expect.objectContaining({ id: 'usage-1' }));
    expect(usageRecordsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        usagePayload: { totalCost: 1 },
        meterId: null,
      }),
    );
    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'usage.recorded',
      expect.objectContaining({ usageRecordId: 'usage-1' }),
    );
  });

  it('requires meterId and value when subscription has meter attachments', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', planId: 'plan-1' });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', billInAdvance: false });
    meterBillingService.hasAnyMeterAttachments.mockResolvedValue(true);

    await expect(
      service.createUsage({
        subscriptionId: 'sub-1',
        periodStart: new Date(),
        periodEnd: new Date(),
        usageSource: 'admin',
        usagePayload: {},
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates plan-scoped metered usage when meter is attached to plan', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', planId: 'plan-1' });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', billInAdvance: false });
    meterBillingService.hasAnyMeterAttachments.mockResolvedValue(true);
    servicePlanMetersRepository.findByPlanAndMeter.mockResolvedValue({ id: 'link-1' });
    usageRecordsRepository.create.mockResolvedValue({
      id: 'usage-2',
      subscriptionId: 'sub-1',
      meterId: 'meter-1',
      attachmentType: 'plan',
      addonId: null,
      value: '12.5',
    });

    await expect(
      service.createUsage({
        subscriptionId: 'sub-1',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-02-01'),
        usageSource: 'admin',
        meterId: 'meter-1',
        value: 12.5,
        attachmentType: 'plan',
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'usage-2' }));

    expect(usageRecordsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        meterId: 'meter-1',
        value: '12.5',
        attachmentType: 'plan',
        addonId: null,
      }),
    );
  });

  it('rejects negative meter values on create', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', planId: 'plan-1' });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', billInAdvance: false });
    meterBillingService.hasAnyMeterAttachments.mockResolvedValue(true);
    servicePlanMetersRepository.findByPlanAndMeter.mockResolvedValue({ id: 'link-1' });

    await expect(
      service.createUsage({
        subscriptionId: 'sub-1',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-02-01'),
        usageSource: 'admin',
        meterId: 'meter-1',
        value: -1,
        attachmentType: 'plan',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(usageRecordsRepository.create).not.toHaveBeenCalled();
  });
});
