import { ControllerJobName, getControllerRepeatableJobs } from './job-registry';

describe('controller job-registry', () => {
  it('defines coordinator and unit job names', () => {
    expect(ControllerJobName.AUTONOMOUS_TICKET_UNIT).toBe('autonomous-ticket.unit');
    expect(ControllerJobName.FILTER_RULES_RECONCILE).toBe('filter-rules-sync.reconcile');
  });

  it('getControllerRepeatableJobs includes core coordinators', () => {
    const jobs = getControllerRepeatableJobs();
    const names = jobs.map((job) => job.name);

    expect(names).toContain(ControllerJobName.FILTER_RULES_SYNC_COORDINATOR);
    expect(names).toContain(ControllerJobName.WEBHOOK_DELIVERY_RETENTION_COORDINATOR);
  });

  it('getControllerRepeatableJobs includes search reindex coordinator', () => {
    const jobs = getControllerRepeatableJobs();
    const searchJob = jobs.find((job) => job.name === ControllerJobName.SEARCH_REINDEX_COORDINATOR);

    expect(searchJob).toBeDefined();
    expect(searchJob?.everyMs).toBe(900_000);
  });

  it('getControllerRepeatableJobs includes update check coordinator', () => {
    const jobs = getControllerRepeatableJobs();
    const updateCheckJob = jobs.find((job) => job.name === ControllerJobName.UPDATE_CHECK);

    expect(updateCheckJob).toBeDefined();
    expect(updateCheckJob?.pattern).toBe('0 0 * * *');
    expect(updateCheckJob?.tz).toBe('Europe/Berlin');
  });

  it('getControllerRepeatableJobs falls back when UPDATE_CHECK_CRON is empty', () => {
    process.env.UPDATE_CHECK_CRON = '';
    const jobs = getControllerRepeatableJobs();
    const updateCheckJob = jobs.find((job) => job.name === ControllerJobName.UPDATE_CHECK);

    expect(updateCheckJob?.pattern).toBe('0 0 * * *');
    delete process.env.UPDATE_CHECK_CRON;
  });

  it('getControllerRepeatableJobs includes opencode providers refresh', () => {
    const jobs = getControllerRepeatableJobs();
    const providersJob = jobs.find((job) => job.name === ControllerJobName.OPENCODE_PROVIDERS_REFRESH);

    expect(providersJob).toBeDefined();
    expect(providersJob?.everyMs).toBe(86_400_000);
  });

  it('getControllerRepeatableJobs includes opencode config and layer-file sync', () => {
    const jobs = getControllerRepeatableJobs();
    const names = jobs.map((job) => job.name);

    expect(names).toContain(ControllerJobName.OPENCODE_CONFIG_SYNC_COORDINATOR);
    expect(names).toContain(ControllerJobName.OPENCODE_LAYER_FILES_SYNC_COORDINATOR);
  });

  it('coordinator job ids are valid for BullMQ (no colons)', () => {
    for (const job of getControllerRepeatableJobs()) {
      expect(job.coordinatorJobId).not.toContain(':');
      expect(job.coordinatorJobId.startsWith('coordinator.')).toBe(true);
    }
  });
});
