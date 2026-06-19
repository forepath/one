import { BillingIntervalType } from '../entities/service-plan.entity';

import { resolveInvoicingPeriod } from './invoicing-period.util';

describe('resolveInvoicingPeriod', () => {
  const invoice = {
    issuedAt: new Date('2026-06-01T12:00:00Z'),
    createdAt: new Date('2026-06-01T10:00:00Z'),
  };

  it('uses subscription billing period when available', () => {
    const period = resolveInvoicingPeriod(invoice, {
      currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(period.periodStart).toEqual(new Date('2026-05-01T00:00:00Z'));
    expect(period.periodEnd).toEqual(new Date('2026-06-01T00:00:00Z'));
  });

  it('derives period from plan billing interval when subscription period is missing', () => {
    const period = resolveInvoicingPeriod(
      invoice,
      { createdAt: new Date('2026-01-01T00:00:00Z') },
      {
        billingIntervalType: BillingIntervalType.MONTH,
        billingIntervalValue: 1,
        billingDayOfMonth: 1,
      },
    );

    expect(period.periodEnd).toEqual(invoice.issuedAt);
    expect(period.periodStart.getUTCMonth()).toBe(4);
    expect(period.periodStart.getUTCDate()).toBe(1);
  });

  it('falls back to subscription creation date when no plan is available', () => {
    const period = resolveInvoicingPeriod(invoice, {
      createdAt: new Date('2026-03-15T00:00:00Z'),
    });

    expect(period.periodStart).toEqual(new Date('2026-03-15T00:00:00Z'));
    expect(period.periodEnd).toEqual(invoice.issuedAt);
  });
});
