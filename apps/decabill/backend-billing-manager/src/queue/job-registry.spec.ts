import { BillingJobName, getBillingRepeatableJobs } from './job-registry';

describe('billing job-registry', () => {
  it('defines coordinator job names', () => {
    expect(BillingJobName.SUBSCRIPTION_BILLING_COORDINATOR).toBe('subscription-billing.coordinator');
    expect(BillingJobName.BACKORDER_RETRY_UNIT).toBe('backorder-retry.unit');
  });

  it('getBillingRepeatableJobs includes core coordinators and optional DATEV export', () => {
    const jobs = getBillingRepeatableJobs();

    expect(jobs.length).toBeGreaterThanOrEqual(7);
    expect(jobs.map((job) => job.name)).toContain(BillingJobName.WEBHOOK_DELIVERY_RETENTION_COORDINATOR);
    expect(jobs.map((job) => job.name)).toContain(BillingJobName.INVOICE_AUTO_PAYMENT_COORDINATOR);

    delete process.env.BILLING_DATEV_EXPORT_ENABLED;
    const withDatev = getBillingRepeatableJobs();
    expect(withDatev.map((job) => job.name)).toContain(BillingJobName.DATEV_EXPORT_COORDINATOR);

    process.env.BILLING_DATEV_EXPORT_ENABLED = 'false';
    const withoutDatev = getBillingRepeatableJobs();
    expect(withoutDatev.map((job) => job.name)).not.toContain(BillingJobName.DATEV_EXPORT_COORDINATOR);
    delete process.env.BILLING_DATEV_EXPORT_ENABLED;
  });

  it('coordinator job ids are valid for BullMQ (no colons)', () => {
    for (const job of getBillingRepeatableJobs()) {
      expect(job.coordinatorJobId).not.toContain(':');
      expect(job.coordinatorJobId.startsWith('coordinator.')).toBe(true);
      expect(job.everyMs != null || job.pattern != null).toBe(true);
    }
  });
});
