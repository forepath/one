import {
  removeRepeatableCoordinatorJob,
  registerRepeatableCoordinatorJob,
  shouldRegisterRepeatableJobs,
} from '@forepath/shared/backend';

import { BillingQueueRegistrarService } from './billing-queue-registrar.service';
import { BillingJobName, getBillingRepeatableJobs } from './job-registry';

jest.mock('@forepath/shared/backend', () => ({
  ...jest.requireActual('@forepath/shared/backend'),
  shouldRegisterRepeatableJobs: jest.fn(),
  registerRepeatableCoordinatorJob: jest.fn(),
  removeRepeatableCoordinatorJob: jest.fn(),
}));

describe('BillingQueueRegistrarService', () => {
  const queue = {} as never;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BILLING_DATEV_EXPORT_ENABLED;
    (shouldRegisterRepeatableJobs as jest.Mock).mockReturnValue(true);
  });

  it('removes stale DATEV repeatable when feature disabled', async () => {
    process.env.BILLING_DATEV_EXPORT_ENABLED = 'false';
    const service = new BillingQueueRegistrarService(queue);

    await service.onModuleInit();

    expect(removeRepeatableCoordinatorJob).toHaveBeenCalledWith(
      queue,
      BillingJobName.DATEV_EXPORT_COORDINATOR,
      expect.stringContaining('datev-export'),
    );
  });

  it('registers repeatable jobs including DATEV when enabled', async () => {
    process.env.BILLING_DATEV_EXPORT_ENABLED = 'true';
    const service = new BillingQueueRegistrarService(queue);

    await service.onModuleInit();

    const datevJob = getBillingRepeatableJobs().find((job) => job.name === BillingJobName.DATEV_EXPORT_COORDINATOR);
    expect(datevJob?.pattern).toBeDefined();
    expect(registerRepeatableCoordinatorJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: BillingJobName.DATEV_EXPORT_COORDINATOR, pattern: expect.any(String) }),
    );
  });

  it('does nothing when shouldRegisterRepeatableJobs is false', async () => {
    (shouldRegisterRepeatableJobs as jest.Mock).mockReturnValue(false);
    const service = new BillingQueueRegistrarService(queue);

    await service.onModuleInit();

    expect(registerRepeatableCoordinatorJob).not.toHaveBeenCalled();
  });
});
