import { SubscriptionProvisioningJobHandler } from './subscription-provisioning.job-handler';

describe('SubscriptionProvisioningJobHandler', () => {
  const subscriptionItemsRepository = {
    findPendingProvisioningIds: jest.fn(),
  };
  const subscriptionService = {
    provisionSubscriptionItem: jest.fn(),
  };

  const handler = new SubscriptionProvisioningJobHandler(
    subscriptionItemsRepository as never,
    subscriptionService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ids of subscription items pending provisioning', async () => {
    subscriptionItemsRepository.findPendingProvisioningIds.mockResolvedValue(['item-1', 'item-2']);

    const ids = await handler.findPendingProvisioningItemIds();

    expect(ids).toEqual(['item-1', 'item-2']);
    expect(subscriptionItemsRepository.findPendingProvisioningIds).toHaveBeenCalledWith(expect.any(Number));
  });

  it('delegates unit processing to the subscription service', async () => {
    await handler.processItemProvisioning('item-1');

    expect(subscriptionService.provisionSubscriptionItem).toHaveBeenCalledWith('item-1');
  });
});
