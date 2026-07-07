import { SubscriptionStatus } from '../entities/subscription.entity';

import { SubscriptionTeardownService } from './subscription-teardown.service';

describe('SubscriptionTeardownService', () => {
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  };
  const subscriptionItemsRepository = {
    findBySubscription: jest.fn(),
  };
  const provisioningService = {
    deprovision: jest.fn(),
  };
  const openPositionsRepository = {
    create: jest.fn(),
  };
  const hostnameReservationService = {
    releaseHostname: jest.fn(),
  };
  const cloudflareDnsService = {
    deleteRecord: jest.fn(),
  };

  const service = new SubscriptionTeardownService(
    subscriptionsRepository as never,
    subscriptionItemsRepository as never,
    provisioningService as never,
    openPositionsRepository as never,
    hostnameReservationService as never,
    cloudflareDnsService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      number: 'SUB-001',
      userId: 'user-1',
      status: SubscriptionStatus.ACTIVE,
    });
    subscriptionItemsRepository.findBySubscription.mockResolvedValue([
      {
        id: 'item-1',
        hostname: 'awesome-armadillo-abc12',
        providerReference: 'srv-1',
        serviceType: { provider: 'hetzner' },
      },
    ]);
    provisioningService.deprovision.mockResolvedValue(undefined);
    openPositionsRepository.create.mockResolvedValue(undefined);
    hostnameReservationService.releaseHostname.mockResolvedValue(undefined);
    cloudflareDnsService.deleteRecord.mockResolvedValue(undefined);
    subscriptionsRepository.update.mockResolvedValue(undefined);
  });

  it('deprovisions items, records open position, and cancels subscription', async () => {
    await service.teardownImmediate('sub-1');

    expect(cloudflareDnsService.deleteRecord).toHaveBeenCalledWith('awesome-armadillo-abc12');
    expect(hostnameReservationService.releaseHostname).toHaveBeenCalledWith('item-1');
    expect(provisioningService.deprovision).toHaveBeenCalledWith('hetzner', 'srv-1');
    expect(openPositionsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        userId: 'user-1',
        skipIfNoBillableAmount: true,
      }),
    );
    expect(subscriptionsRepository.update).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({ status: SubscriptionStatus.CANCELED }),
    );
  });

  it('marks withdrawnAt when withdrawn option is set', async () => {
    const billUntil = new Date('2024-06-01T12:00:00Z');

    await service.teardownImmediate('sub-1', { withdrawn: true, billUntil });

    expect(openPositionsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Subscription SUB-001 (withdrawn)',
        billUntil,
      }),
    );
    expect(subscriptionsRepository.update).toHaveBeenCalledWith('sub-1', {
      status: SubscriptionStatus.CANCELED,
      withdrawnAt: billUntil,
    });
  });

  it('skips open position when skipOpenPosition is true', async () => {
    await service.teardownImmediate('sub-1', { skipOpenPosition: true });

    expect(openPositionsRepository.create).not.toHaveBeenCalled();
  });
});
