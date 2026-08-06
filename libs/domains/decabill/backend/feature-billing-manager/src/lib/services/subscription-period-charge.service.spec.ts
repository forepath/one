import { BillingIntervalType } from '../entities/service-plan.entity';

import { BillingScheduleService } from './billing-schedule.service';
import { SubscriptionPeriodChargeService } from './subscription-period-charge.service';

describe('SubscriptionPeriodChargeService', () => {
  const openPositionsRepository = {
    create: jest.fn(),
  };
  const subscriptionsRepository = {
    update: jest.fn(),
  };
  const billingScheduleService = new BillingScheduleService();
  const billingNotificationPublisher = {
    publishPeriodCharged: jest.fn(),
    publishSubscription: jest.fn(),
  };
  const meterBillingService = {
    buildMeterChargeLines: jest.fn().mockResolvedValue([]),
  };
  const service = new SubscriptionPeriodChargeService(
    openPositionsRepository as never,
    subscriptionsRepository as never,
    billingScheduleService,
    billingNotificationPublisher as never,
    meterBillingService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records an open position and publishes period_charged', async () => {
    const subscription = {
      id: 'sub-1',
      userId: 'user-1',
      number: '100',
      planId: 'plan-1',
    } as never;
    const plan = { billInAdvance: true, billingIntervalType: BillingIntervalType.YEAR };
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2027-01-01T00:00:00Z');

    await service.recordOpenPositionForPeriod(subscription, plan, end, start, end);

    expect(openPositionsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        billUntil: end,
        skipIfNoBillableAmount: true,
      }),
    );
    expect(billingNotificationPublisher.publishPeriodCharged).toHaveBeenCalled();
  });

  it('arrear due billing uses previous nextBillingAt as billUntil', async () => {
    const nextBillingAt = new Date('2026-02-01T00:00:00Z');
    const subscription = {
      id: 'sub-1',
      userId: 'user-1',
      number: '100',
      planId: 'plan-1',
      nextBillingAt,
      currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    } as never;
    const plan = {
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      billingDayOfMonth: 1,
      billInAdvance: false,
      autoRecalculatePriceDaily: false,
    } as never;

    subscriptionsRepository.update.mockResolvedValue({ id: 'sub-1' });

    await service.processDueBilling(subscription, plan);

    expect(openPositionsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ billUntil: nextBillingAt }));
    expect(subscriptionsRepository.update).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({
        currentPeriodStart: nextBillingAt,
      }),
    );
    expect(billingNotificationPublisher.publishSubscription).toHaveBeenCalledWith(
      'subscription.updated',
      expect.anything(),
      plan,
    );
  });

  it('arrear late billing advances from nextBillingAt not wall-clock now', async () => {
    const nextBillingAt = new Date('2026-02-01T00:00:00Z');
    const subscription = {
      id: 'sub-1',
      userId: 'user-1',
      number: '100',
      planId: 'plan-1',
      nextBillingAt,
      currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    } as never;
    const plan = {
      billingIntervalType: BillingIntervalType.HOUR,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      billInAdvance: false,
      autoRecalculatePriceDaily: false,
    } as never;

    subscriptionsRepository.update.mockResolvedValue({ id: 'sub-1' });
    const calculateScheduleSpy = jest.spyOn(billingScheduleService, 'calculateSchedule');

    await service.processDueBilling(subscription, plan);

    expect(calculateScheduleSpy).toHaveBeenCalledWith(BillingIntervalType.HOUR, 1, undefined, nextBillingAt);
    expect(subscriptionsRepository.update).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({
        currentPeriodStart: nextBillingAt,
        currentPeriodEnd: new Date('2026-02-01T01:00:00Z'),
        nextBillingAt: new Date('2026-02-01T01:00:00Z'),
      }),
    );

    calculateScheduleSpy.mockRestore();
  });

  it('advance due billing uses new period end as billUntil', async () => {
    const subscription = {
      id: 'sub-1',
      userId: 'user-1',
      number: '100',
      planId: 'plan-1',
      nextBillingAt: new Date('2026-01-01T00:00:00Z'),
      currentPeriodStart: new Date('2025-01-01T00:00:00Z'),
      createdAt: new Date('2025-01-01T00:00:00Z'),
    } as never;
    const plan = {
      billingIntervalType: BillingIntervalType.YEAR,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
      billInAdvance: true,
      autoRecalculatePriceDaily: false,
    } as never;

    subscriptionsRepository.update.mockResolvedValue({ id: 'sub-1' });

    await service.processDueBilling(subscription, plan);

    const created = openPositionsRepository.create.mock.calls[0][0];

    expect(created.billUntil).toBeInstanceOf(Date);
    expect(created.billUntil.getUTCFullYear()).toBeGreaterThanOrEqual(2026);
  });
});
