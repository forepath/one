import { BILLING_QUEUE_NAME, VatIdValidationJobName } from './billing-queue.constants';
import { VatIdValidationEnqueueAdapter } from './vat-id-validation-enqueue.adapter';

describe('VatIdValidationEnqueueAdapter', () => {
  const billingQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const adapter = new VatIdValidationEnqueueAdapter(billingQueue as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enqueues unit jobs with stable job id and retry policy', async () => {
    await adapter.enqueueUnit({
      profileId: 'profile-1',
      userId: 'user-1',
      vatId: 'DE123456789',
    });

    expect(billingQueue.add).toHaveBeenCalledWith(
      VatIdValidationJobName.UNIT,
      {
        profileId: 'profile-1',
        userId: 'user-1',
        vatId: 'DE123456789',
      },
      expect.objectContaining({
        jobId: 'vat-id-validation:profile-1:DE123456789',
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      }),
    );
  });

  it('exposes billing queue constant for injection wiring', () => {
    expect(BILLING_QUEUE_NAME).toBe('billing');
    expect(VatIdValidationJobName.UNIT).toBe('vat-id-validation.unit');
  });
});
