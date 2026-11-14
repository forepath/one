import { runWithTenantId } from '@forepath/shared/backend';

import type { RegisteredContributorJob } from '../utils/contributor-job.types';

import { ContributorCollectJobHandler } from './contributor-collect.job-handler';

describe('ContributorCollectJobHandler', () => {
  const run = jest.fn().mockResolvedValue(undefined);
  const jobRunsRepository = {
    findByIdentity: jest.fn(),
    upsertRun: jest.fn().mockResolvedValue({}),
  };
  const jobRegistry = {
    list: jest.fn(),
  };
  const registered = (overrides: Partial<RegisteredContributorJob['definition']> = {}): RegisteredContributorJob => ({
    source: 'addon',
    sourceKey: 'container-manager',
    definition: {
      key: 'collect-stats',
      intervalMs: 60_000,
      run,
      ...overrides,
    },
  });
  const handler = new ContributorCollectJobHandler(jobRegistry as never, jobRunsRepository as never);

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BILLING_CONTRIBUTOR_COLLECT_ENABLED;
    jobRegistry.list.mockReturnValue([registered()]);
    jobRunsRepository.findByIdentity.mockResolvedValue(null);
  });

  it('runs a due job and persists timestamps', async () => {
    await runWithTenantId('default', () => handler.processTenant('default', new Date('2026-08-17T12:00:00.000Z')));

    expect(run).toHaveBeenCalledWith({
      tenantId: 'default',
      now: new Date('2026-08-17T12:00:00.000Z'),
      source: 'addon',
      sourceKey: 'container-manager',
    });
    expect(jobRunsRepository.upsertRun).toHaveBeenCalledTimes(2);
    expect(jobRunsRepository.upsertRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'addon',
        sourceKey: 'container-manager',
        jobKey: 'collect-stats',
        lastError: null,
        lastFinishedAt: expect.any(Date),
      }),
    );
  });

  it('skips a job that is not due yet', async () => {
    jobRunsRepository.findByIdentity.mockResolvedValue({
      lastFinishedAt: new Date('2026-08-17T11:59:30.000Z'),
    });

    await runWithTenantId('default', () => handler.processTenant('default', new Date('2026-08-17T12:00:00.000Z')));

    expect(run).not.toHaveBeenCalled();
    expect(jobRunsRepository.upsertRun).not.toHaveBeenCalled();
  });

  it('isolates a failing job and continues', async () => {
    const otherRun = jest.fn().mockResolvedValue(undefined);

    jobRegistry.list.mockReturnValue([
      registered({ run: jest.fn().mockRejectedValue(new Error('ssh boom')) }),
      {
        source: 'addon',
        sourceKey: 'other',
        definition: { key: 'ping', intervalMs: 15_000, run: otherRun },
      },
    ]);

    await runWithTenantId('default', () => handler.processTenant('default', new Date('2026-08-17T12:00:00.000Z')));

    expect(otherRun).toHaveBeenCalled();
    expect(jobRunsRepository.upsertRun).toHaveBeenCalledWith(expect.objectContaining({ lastError: 'Job failed' }));
  });

  it('skips all jobs when contributor collect is disabled', async () => {
    process.env.BILLING_CONTRIBUTOR_COLLECT_ENABLED = 'false';

    await runWithTenantId('default', () => handler.processTenant('default', new Date()));

    expect(run).not.toHaveBeenCalled();
    expect(jobRegistry.list).not.toHaveBeenCalled();
  });
});
