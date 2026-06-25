import { buildJobId, defaultRemoveOnComplete, defaultRemoveOnFail } from '@forepath/shared/backend';

import { DatevExportScope } from '../constants/datev-export.constants';
import { DatevExportJobName } from './billing-queue.constants';
import { DatevExportEnqueueAdapter } from './datev-export-enqueue.adapter';

describe('DatevExportEnqueueAdapter', () => {
  const billingQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const adapter = new DatevExportEnqueueAdapter(billingQueue as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enqueues tenant-scoped unit jobs', async () => {
    await adapter.enqueueUnit({
      tenantId: 'default',
      scope: DatevExportScope.TENANT,
      year: 2026,
      month: 1,
      triggeredBy: 'admin',
    });

    expect(billingQueue.add).toHaveBeenCalledWith(
      DatevExportJobName.UNIT,
      {
        tenantId: 'default',
        scope: DatevExportScope.TENANT,
        year: 2026,
        month: 1,
        triggeredBy: 'admin',
      },
      expect.objectContaining({
        jobId: buildJobId('datev-export:tenant', 'default', '2026-01'),
        removeOnComplete: defaultRemoveOnComplete,
        removeOnFail: defaultRemoveOnFail,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
  });

  it('enqueues unified unit jobs without tenant id in job id', async () => {
    await adapter.enqueueUnit({
      tenantId: 'default',
      scope: DatevExportScope.UNIFIED,
      year: 2026,
      month: 2,
      triggeredBy: 'system',
      force: true,
    });

    expect(billingQueue.add).toHaveBeenCalledWith(
      DatevExportJobName.UNIT,
      expect.objectContaining({ scope: DatevExportScope.UNIFIED, force: true }),
      expect.objectContaining({
        jobId: buildJobId('datev-export:unified', '2026-02'),
      }),
    );
  });
});
