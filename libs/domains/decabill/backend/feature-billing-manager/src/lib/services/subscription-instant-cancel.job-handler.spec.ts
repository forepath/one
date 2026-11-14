import { SubscriptionInstantCancelJobHandler } from './subscription-instant-cancel.job-handler';

describe('SubscriptionInstantCancelJobHandler', () => {
  const subscriptionsRepository = {
    findDueForInstantCancel: jest.fn(),
  };
  const subscriptionTeardownService = {
    processInstantCancel: jest.fn(),
  };
  const handler = new SubscriptionInstantCancelJobHandler(
    subscriptionsRepository as never,
    subscriptionTeardownService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ids of subscriptions pending instant cancel', async () => {
    subscriptionsRepository.findDueForInstantCancel.mockResolvedValue([{ id: 'sub-1' }, { id: 'sub-2' }]);

    const ids = await handler.findPendingInstantCancelIds();

    expect(ids).toEqual(['sub-1', 'sub-2']);
    expect(subscriptionsRepository.findDueForInstantCancel).toHaveBeenCalledWith(expect.any(Date), expect.any(Number));
  });

  it('delegates unit processing to the teardown service', async () => {
    await handler.processSubscriptionInstantCancel('sub-1');

    expect(subscriptionTeardownService.processInstantCancel).toHaveBeenCalledWith('sub-1');
  });
});
