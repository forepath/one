import { ProvisioningStatus } from '../entities/subscription-item.entity';
import { SubscriptionItemServerService } from './subscription-item-server.service';

describe('SubscriptionItemServerService', () => {
  const subscriptionService = {
    getSubscription: jest.fn().mockResolvedValue({ id: 'sub-1' }),
  };
  const subscriptionItemsRepository = {
    findBySubscription: jest.fn(),
  };
  const service = new SubscriptionItemServerService(
    subscriptionService as never,
    subscriptionItemsRepository as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listItems', () => {
    it('maps custom service from config snapshot', async () => {
      subscriptionItemsRepository.findBySubscription.mockResolvedValue([
        {
          id: 'item-1',
          subscriptionId: 'sub-1',
          serviceTypeId: 'st-1',
          provisioningStatus: ProvisioningStatus.ACTIVE,
          hostname: 'host1',
          configSnapshot: { service: 'custom', cloudInitConfigId: 'cfg-1' },
        },
      ]);

      const items = await service.listItems('sub-1', 'user-1');

      expect(items[0]?.service).toBe('custom');
    });
  });
});
