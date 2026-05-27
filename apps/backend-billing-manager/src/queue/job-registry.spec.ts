import { BillingJobName, getBillingRepeatableJobs } from './job-registry';

describe('billing job-registry', () => {
  it('defines coordinator job names', () => {
    expect(BillingJobName.SUBSCRIPTION_BILLING_COORDINATOR).toBe('subscription-billing.coordinator');
    expect(BillingJobName.BACKORDER_RETRY_UNIT).toBe('backorder-retry.unit');
  });

  it('getBillingRepeatableJobs includes seven coordinators', () => {
    const jobs = getBillingRepeatableJobs();

    expect(jobs).toHaveLength(7);
    expect(jobs.map((job) => job.name)).toContain(BillingJobName.INVOICE_SYNC_COORDINATOR);
  });

  it('coordinator job ids are valid for BullMQ (no colons)', () => {
    for (const job of getBillingRepeatableJobs()) {
      expect(job.coordinatorJobId).not.toContain(':');
      expect(job.coordinatorJobId.startsWith('coordinator.')).toBe(true);
    }
  });
});
