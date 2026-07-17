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
  const withdrawalRefundService = {
    applyProvisionedWithdrawalRefund: jest.fn(),
    estimateRefundGross: jest.fn(),
  };
  const billingNotificationPublisher = {
    publishSubscription: jest.fn(),
  };

  const service = new SubscriptionTeardownService(
    subscriptionsRepository as never,
    subscriptionItemsRepository as never,
    provisioningService as never,
    openPositionsRepository as never,
    hostnameReservationService as never,
    cloudflareDnsService as never,
    withdrawalRefundService as never,
    billingNotificationPublisher as never,
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
    subscriptionsRepository.update.mockResolvedValue({ id: 'sub-1', status: SubscriptionStatus.CANCELED });
  });

  it('deprovisions items, records open position, and cancels subscription', async () => {
    await service.teardownImmediate('sub-1');

    expect(cloudflareDnsService.deleteRecord).toHaveBeenCalledWith('awesome-armadillo-abc12');
    expect(hostnameReservationService.releaseHostname).toHaveBeenCalledWith('item-1');
    expect(provisioningService.deprovision).toHaveBeenCalledWith('hetzner', 'srv-1', {});
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
    expect(billingNotificationPublisher.publishSubscription).toHaveBeenCalledWith(
      'subscription.canceled',
      expect.objectContaining({ id: 'sub-1' }),
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

  describe('processWithdrawal', () => {
    it('applies refund and tears down when phase is withdrawal_period', async () => {
      const withdrawnAt = new Date('2024-06-01T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
        withdrawnAt,
        withdrawPhase: 'withdrawal_period',
      });

      await service.processWithdrawal('sub-1');

      expect(withdrawalRefundService.applyProvisionedWithdrawalRefund).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub-1' }),
        withdrawnAt,
      );
      expect(openPositionsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Subscription SUB-001 (withdrawn)', billUntil: withdrawnAt }),
      );
      expect(subscriptionsRepository.update).toHaveBeenCalledWith('sub-1', {
        status: SubscriptionStatus.CANCELED,
        withdrawnAt,
      });
    });

    it('skips refund and open position when phase is unprovisioned', async () => {
      const withdrawnAt = new Date('2024-06-02T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
        withdrawnAt,
        withdrawPhase: 'unprovisioned',
      });

      await service.processWithdrawal('sub-1');

      expect(withdrawalRefundService.applyProvisionedWithdrawalRefund).not.toHaveBeenCalled();
      expect(openPositionsRepository.create).not.toHaveBeenCalled();
      expect(subscriptionsRepository.update).toHaveBeenCalledWith('sub-1', {
        status: SubscriptionStatus.CANCELED,
        withdrawnAt,
      });
    });
  });
});
