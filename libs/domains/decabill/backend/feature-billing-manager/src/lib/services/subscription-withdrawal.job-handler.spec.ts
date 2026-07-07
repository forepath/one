import { SubscriptionWithdrawalJobHandler } from './subscription-withdrawal.job-handler';

describe('SubscriptionWithdrawalJobHandler', () => {
  const subscriptionsRepository = {
    findDueForWithdrawal: jest.fn(),
  };
  const subscriptionTeardownService = {
    processWithdrawal: jest.fn(),
  };

  const handler = new SubscriptionWithdrawalJobHandler(
    subscriptionsRepository as never,
    subscriptionTeardownService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ids of subscriptions pending withdrawal', async () => {
    subscriptionsRepository.findDueForWithdrawal.mockResolvedValue([{ id: 'sub-1' }, { id: 'sub-2' }]);

    const ids = await handler.findPendingWithdrawalIds();

    expect(ids).toEqual(['sub-1', 'sub-2']);
    expect(subscriptionsRepository.findDueForWithdrawal).toHaveBeenCalledWith(expect.any(Date), expect.any(Number));
  });

  it('delegates unit processing to the teardown service', async () => {
    await handler.processSubscriptionWithdrawal('sub-1');

    expect(subscriptionTeardownService.processWithdrawal).toHaveBeenCalledWith('sub-1');
  });
});
