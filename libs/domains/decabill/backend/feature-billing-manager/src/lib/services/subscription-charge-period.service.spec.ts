import { BillingScheduleService } from './billing-schedule.service';
import { SubscriptionChargePeriodService } from './subscription-charge-period.service';

describe('SubscriptionChargePeriodService', () => {
  const billingScheduleService = new BillingScheduleService();

  it('returns null when bill until is not after subscription start', async () => {
    const service = new SubscriptionChargePeriodService(
      { findLatestBySubscription: jest.fn().mockResolvedValue(null) } as never,
      { findBySubscription: jest.fn() } as never,
      billingScheduleService,
    );
    const subscription = {
      id: 'sub-1',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      currentPeriodStart: new Date('2026-02-01T00:00:00Z'),
    } as never;
    const plan = { billingIntervalType: 'day', billInAdvance: false, billingIntervalValue: 1 } as never;

    const result = await service.resolveChargePeriod(subscription, plan, 30, new Date('2026-02-01T00:00:00Z'));

    expect(result).toBeNull();
  });

  it('bills closed arrear period after schedule was rolled forward', async () => {
    const service = new SubscriptionChargePeriodService(
      { findLatestBySubscription: jest.fn().mockResolvedValue(null) } as never,
      { findBySubscription: jest.fn().mockResolvedValue([]) } as never,
      billingScheduleService,
    );
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const billUntil = new Date('2026-02-01T00:00:00Z');
    const subscription = {
      id: 'sub-1',
      createdAt,
      // Schedule already advanced by the billing job before invoice creation.
      currentPeriodStart: new Date('2026-02-01T00:00:05Z'),
      currentPeriodEnd: new Date('2026-03-01T00:00:00Z'),
    } as never;
    const plan = {
      billingIntervalType: 'day',
      billInAdvance: false,
      autoRecalculatePriceDaily: false,
      billingIntervalValue: 1,
    } as never;

    const result = await service.resolveChargePeriod(subscription, plan, 31, billUntil);

    expect(result).toEqual(
      expect.objectContaining({
        periodStart: createdAt,
        periodEnd: billUntil,
        meterPeriodStart: createdAt,
      }),
    );
    expect(result?.baseAmount).toBeGreaterThan(0);
  });

  it('uses schedule-aligned meterPeriodStart when prior invoice lags the period boundary', async () => {
    const lastInvoiceAt = new Date('2026-02-01T00:05:00Z');
    const billUntil = new Date('2026-03-01T00:00:00Z');
    const service = new SubscriptionChargePeriodService(
      { findLatestBySubscription: jest.fn().mockResolvedValue({ createdAt: lastInvoiceAt }) } as never,
      { findBySubscription: jest.fn().mockResolvedValue([]) } as never,
      billingScheduleService,
    );
    const subscription = {
      id: 'sub-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      currentPeriodStart: billUntil,
      currentPeriodEnd: new Date('2026-04-01T00:00:00Z'),
    } as never;
    const plan = {
      billingIntervalType: 'month',
      billInAdvance: false,
      autoRecalculatePriceDaily: false,
      billingIntervalValue: 1,
      billingDayOfMonth: 1,
    } as never;

    const result = await service.resolveChargePeriod(subscription, plan, 30, billUntil);

    expect(result?.periodStart).toEqual(lastInvoiceAt);
    expect(result?.periodEnd).toEqual(billUntil);
    expect(result?.meterPeriodStart).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('uses currentPeriodStart for meters when createInvoice lags after schedule start', async () => {
    const lastInvoiceAt = new Date('2026-02-01T00:05:00Z');
    const currentPeriodStart = new Date('2026-02-01T00:00:00Z');
    const billUntil = new Date('2026-02-15T00:00:00Z');
    const service = new SubscriptionChargePeriodService(
      { findLatestBySubscription: jest.fn().mockResolvedValue({ createdAt: lastInvoiceAt }) } as never,
      { findBySubscription: jest.fn().mockResolvedValue([]) } as never,
      billingScheduleService,
    );
    const subscription = {
      id: 'sub-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      currentPeriodStart,
      currentPeriodEnd: new Date('2026-03-01T00:00:00Z'),
    } as never;
    const plan = {
      billingIntervalType: 'month',
      billInAdvance: false,
      autoRecalculatePriceDaily: false,
      billingIntervalValue: 1,
      billingDayOfMonth: 1,
    } as never;

    const result = await service.resolveChargePeriod(subscription, plan, 30, billUntil);

    expect(result?.periodStart).toEqual(lastInvoiceAt);
    expect(result?.meterPeriodStart).toEqual(currentPeriodStart);
  });

  it('returns full period when no prior invoice exists', async () => {
    const service = new SubscriptionChargePeriodService(
      { findLatestBySubscription: jest.fn().mockResolvedValue(null) } as never,
      { findBySubscription: jest.fn().mockResolvedValue([]) } as never,
      billingScheduleService,
    );
    const periodStart = new Date('2026-01-01T00:00:00Z');
    const billUntil = new Date('2026-02-01T00:00:00Z');
    const subscription = {
      id: 'sub-1',
      createdAt: periodStart,
      currentPeriodStart: periodStart,
    } as never;
    const plan = { billingIntervalType: 'day', billInAdvance: false, billingIntervalValue: 1 } as never;

    const result = await service.resolveChargePeriod(subscription, plan, 31, billUntil);

    expect(result).toEqual(
      expect.objectContaining({
        periodStart,
        periodEnd: billUntil,
        meterPeriodStart: periodStart,
      }),
    );
    expect(result?.baseAmount).toBeGreaterThan(0);
  });

  it('returns null for unprovisioned withdrawn subscription', async () => {
    const service = new SubscriptionChargePeriodService(
      { findLatestBySubscription: jest.fn().mockResolvedValue(null) } as never,
      {
        findBySubscription: jest
          .fn()
          .mockResolvedValue([{ provisioningStatus: 'pending', createdAt: new Date('2026-01-01T00:00:00Z') }]),
      } as never,
      billingScheduleService,
    );
    const subscription = {
      id: 'sub-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
      withdrawnAt: new Date('2026-01-05T00:00:00Z'),
    } as never;
    const plan = { billingIntervalType: 'day', billInAdvance: false, billingIntervalValue: 1 } as never;

    const result = await service.resolveChargePeriod(subscription, plan, 30, new Date('2026-01-05T00:00:00Z'));

    expect(result).toBeNull();
  });

  it('caps effective until at cancel effective date', async () => {
    const lastInvoiceAt = new Date('2026-01-01T00:00:00Z');
    const service = new SubscriptionChargePeriodService(
      { findLatestBySubscription: jest.fn().mockResolvedValue({ createdAt: lastInvoiceAt }) } as never,
      { findBySubscription: jest.fn().mockResolvedValue([]) } as never,
      billingScheduleService,
    );
    const subscription = {
      id: 'sub-1',
      createdAt: new Date('2025-12-01T00:00:00Z'),
      currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
      cancelEffectiveAt: new Date('2026-01-10T00:00:00Z'),
    } as never;
    const plan = { billingIntervalType: 'day', billInAdvance: false, billingIntervalValue: 1 } as never;

    const result = await service.resolveChargePeriod(subscription, plan, 10, new Date('2026-01-20T00:00:00Z'));

    expect(result?.periodEnd).toEqual(new Date('2026-01-10T00:00:00Z'));
    expect(result?.baseAmount).toBe(90);
  });
});
