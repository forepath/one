import { ControllerJobName, RETIRED_CONTROLLER_REPEATABLE_JOBS, getControllerRepeatableJobs } from './job-registry';

describe('controller job-registry', () => {
  it('defines coordinator and unit job names', () => {
    expect(ControllerJobName.AUTONOMOUS_TICKET_UNIT).toBe('autonomous-ticket.unit');
    expect(ControllerJobName.EGRESS_EVENTS_INGEST_UNIT).toBe('egress-events-ingest.unit');
  });

  it('getControllerRepeatableJobs includes core coordinators', () => {
    const jobs = getControllerRepeatableJobs();
    const names = jobs.map((job) => job.name);

    expect(names).toContain(ControllerJobName.EGRESS_EVENTS_INGEST_COORDINATOR);
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

  it('getControllerRepeatableJobs includes opencode mcp servers refresh', () => {
    const jobs = getControllerRepeatableJobs();
    const mcpJob = jobs.find((job) => job.name === ControllerJobName.OPENCODE_MCP_SERVERS_REFRESH);

    expect(mcpJob).toBeDefined();
    expect(mcpJob?.everyMs).toBe(86_400_000);
  });

  it('getControllerRepeatableJobs includes opencode config and layer-file sync', () => {
    const jobs = getControllerRepeatableJobs();
    const names = jobs.map((job) => job.name);

    expect(names).toContain(ControllerJobName.OPENCODE_CONFIG_SYNC_COORDINATOR);
    expect(names).toContain(ControllerJobName.OPENCODE_LAYER_FILES_SYNC_COORDINATOR);
  });

  it('getControllerRepeatableJobs skips egress ingestion when disabled', () => {
    process.env.EGRESS_EVENTS_INGEST_INTERVAL_MS = '0';
    const names = getControllerRepeatableJobs().map((job) => job.name);

    expect(names).not.toContain(ControllerJobName.EGRESS_EVENTS_INGEST_COORDINATOR);
    delete process.env.EGRESS_EVENTS_INGEST_INTERVAL_MS;
  });

  it('schedules the isolation capabilities coordinator every 15 minutes by default', () => {
    const job = getControllerRepeatableJobs().find(
      (entry) => entry.name === ControllerJobName.ISOLATION_CAPABILITIES_COORDINATOR,
    );

    expect(ControllerJobName.ISOLATION_CAPABILITIES_UNIT).toBe('isolation-capabilities.unit');
    expect(job?.everyMs).toBe(900_000);
  });

  it('getControllerRepeatableJobs skips isolation capability checks when disabled', () => {
    process.env.ISOLATION_CAPABILITIES_INTERVAL_MS = '0';
    const names = getControllerRepeatableJobs().map((job) => job.name);

    expect(names).not.toContain(ControllerJobName.ISOLATION_CAPABILITIES_COORDINATOR);
    delete process.env.ISOLATION_CAPABILITIES_INTERVAL_MS;
  });

  it('coordinator job ids are valid for BullMQ (no colons)', () => {
    for (const job of getControllerRepeatableJobs()) {
      expect(job.coordinatorJobId).not.toContain(':');
      expect(job.coordinatorJobId.startsWith('coordinator.')).toBe(true);
    }
  });

  it('lists retired repeatables that no active job reuses', () => {
    const active = getControllerRepeatableJobs();

    expect(RETIRED_CONTROLLER_REPEATABLE_JOBS.map((job) => job.name)).toEqual([
      'filter-rules-sync.coordinator',
      'filter-rules-sync.reconcile',
    ]);

    for (const retired of RETIRED_CONTROLLER_REPEATABLE_JOBS) {
      expect(active.some((job) => job.name === retired.name || job.coordinatorJobId === retired.coordinatorJobId)).toBe(
        false,
      );
    }
  });
});
