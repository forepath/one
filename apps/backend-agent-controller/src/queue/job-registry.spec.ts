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
    expect(names).toContain(ControllerJobName.AUTONOMOUS_TICKET_COORDINATOR);
  });

  it('coordinator job ids are valid for BullMQ (no colons)', () => {
    for (const job of getControllerRepeatableJobs()) {
      expect(job.coordinatorJobId).not.toContain(':');
      expect(job.coordinatorJobId.startsWith('coordinator.')).toBe(true);
    }
  });
});
