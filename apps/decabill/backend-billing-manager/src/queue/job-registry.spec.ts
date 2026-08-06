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
    expect(jobs.map((job) => job.name)).toContain(BillingJobName.SUBSCRIPTION_INSTANT_CANCEL_COORDINATOR);

    delete process.env.BILLING_DATEV_EXPORT_ENABLED;
    const withDatev = getBillingRepeatableJobs();
    expect(withDatev.map((job) => job.name)).toContain(BillingJobName.DATEV_EXPORT_COORDINATOR);

    process.env.BILLING_DATEV_EXPORT_ENABLED = 'false';
    const withoutDatev = getBillingRepeatableJobs();
    expect(withoutDatev.map((job) => job.name)).not.toContain(BillingJobName.DATEV_EXPORT_COORDINATOR);
    delete process.env.BILLING_DATEV_EXPORT_ENABLED;
  });

  it('getBillingRepeatableJobs includes optional price recalc coordinator', () => {
    delete process.env.BILLING_PRICE_RECALC_ENABLED;
    const withPriceRecalc = getBillingRepeatableJobs();
    expect(withPriceRecalc.map((job) => job.name)).toContain(BillingJobName.PRICE_RECALC_COORDINATOR);

    const priceRecalcJob = withPriceRecalc.find((job) => job.name === BillingJobName.PRICE_RECALC_COORDINATOR);
    expect(priceRecalcJob?.pattern).toBe('0 0 * * *');
    expect(priceRecalcJob?.tz).toBe('Europe/Berlin');

    process.env.BILLING_PRICE_RECALC_ENABLED = 'false';
    const withoutPriceRecalc = getBillingRepeatableJobs();
    expect(withoutPriceRecalc.map((job) => job.name)).not.toContain(BillingJobName.PRICE_RECALC_COORDINATOR);
    delete process.env.BILLING_PRICE_RECALC_ENABLED;
  });

  it('getBillingRepeatableJobs includes optional meter-collect coordinator every 60s', () => {
    delete process.env.BILLING_METER_COLLECT_ENABLED;
    delete process.env.BILLING_METER_COLLECT_INTERVAL;
    const withMeterCollect = getBillingRepeatableJobs();
    expect(withMeterCollect.map((job) => job.name)).toContain(BillingJobName.METER_COLLECT_COORDINATOR);

    const meterCollectJob = withMeterCollect.find((job) => job.name === BillingJobName.METER_COLLECT_COORDINATOR);
    expect(meterCollectJob?.everyMs).toBe(60_000);

    process.env.BILLING_METER_COLLECT_INTERVAL = '120000';
    const customInterval = getBillingRepeatableJobs().find(
      (job) => job.name === BillingJobName.METER_COLLECT_COORDINATOR,
    );
    expect(customInterval?.everyMs).toBe(120_000);
    delete process.env.BILLING_METER_COLLECT_INTERVAL;

    process.env.BILLING_METER_COLLECT_ENABLED = 'false';
    const withoutMeterCollect = getBillingRepeatableJobs();
    expect(withoutMeterCollect.map((job) => job.name)).not.toContain(BillingJobName.METER_COLLECT_COORDINATOR);
    delete process.env.BILLING_METER_COLLECT_ENABLED;
  });

  it('getBillingRepeatableJobs includes update check coordinator', () => {
    const jobs = getBillingRepeatableJobs();
    const updateCheckJob = jobs.find((job) => job.name === BillingJobName.UPDATE_CHECK);

    expect(updateCheckJob).toBeDefined();
    expect(updateCheckJob?.pattern).toBe('0 0 * * *');
    expect(updateCheckJob?.tz).toBe('Europe/Berlin');
  });

  it('getBillingRepeatableJobs falls back when *_CRON env vars are empty', () => {
    process.env.UPDATE_CHECK_CRON = '';
    process.env.BILLING_DATEV_EXPORT_CRON = '  ';
    process.env.BILLING_PRICE_RECALC_CRON = '';
    delete process.env.BILLING_DATEV_EXPORT_ENABLED;
    delete process.env.BILLING_PRICE_RECALC_ENABLED;

    const jobs = getBillingRepeatableJobs();
    const updateCheckJob = jobs.find((job) => job.name === BillingJobName.UPDATE_CHECK);
    const datevJob = jobs.find((job) => job.name === BillingJobName.DATEV_EXPORT_COORDINATOR);
    const priceRecalcJob = jobs.find((job) => job.name === BillingJobName.PRICE_RECALC_COORDINATOR);

    expect(updateCheckJob?.pattern).toBe('0 0 * * *');
    expect(datevJob?.pattern).toBe('0 0 1 * *');
    expect(priceRecalcJob?.pattern).toBe('0 0 * * *');

    delete process.env.UPDATE_CHECK_CRON;
    delete process.env.BILLING_DATEV_EXPORT_CRON;
    delete process.env.BILLING_PRICE_RECALC_CRON;
  });

  it('coordinator job ids are valid for BullMQ (no colons)', () => {
    for (const job of getBillingRepeatableJobs()) {
      expect(job.coordinatorJobId).not.toContain(':');
      expect(job.coordinatorJobId.startsWith('coordinator.')).toBe(true);
      expect(job.everyMs != null || job.pattern != null).toBe(true);
    }
  });
});
