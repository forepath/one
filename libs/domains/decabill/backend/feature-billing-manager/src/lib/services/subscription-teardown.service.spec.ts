import { SubscriptionStatus } from '../entities/subscription.entity';

import { SubscriptionTeardownService } from './subscription-teardown.service';

describe('SubscriptionTeardownService', () => {
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  };
  const subscriptionItemsRepository = {
    findBySubscription: jest.fn(),
    clearProviderReference: jest.fn(),
  };
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const provisioningService = {
    deprovision: jest.fn(),
  };
  const openPositionsRepository = {
    create: jest.fn(),
    updateUnbilledBillUntil: jest.fn(),
    findUnbilledBySubscription: jest.fn(),
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
    publish: jest.fn(),
  };
  const billingEmailPublisher = {
    publishSubscriptionCanceled: jest.fn(),
    publishSubscriptionWithdrawn: jest.fn(),
  };
  const addonLifecycleService = {
    teardownForSubscription: jest.fn().mockResolvedValue(undefined),
  };

  const service = new SubscriptionTeardownService(
    subscriptionsRepository as never,
    subscriptionItemsRepository as never,
    servicePlansRepository as never,
    provisioningService as never,
    openPositionsRepository as never,
    hostnameReservationService as never,
    cloudflareDnsService as never,
    withdrawalRefundService as never,
    billingNotificationPublisher as never,
    billingEmailPublisher as never,
    addonLifecycleService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    openPositionsRepository.findUnbilledBySubscription.mockResolvedValue([]);
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      number: 'SUB-001',
      userId: 'user-1',
      planId: 'plan-1',
      status: SubscriptionStatus.ACTIVE,
    });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({
      id: 'plan-1',
      name: 'Plan',
      billInAdvance: false,
      autoRecalculatePriceDaily: false,
      billingIntervalType: 'month',
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
    subscriptionItemsRepository.clearProviderReference.mockResolvedValue(undefined);
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
    expect(subscriptionItemsRepository.clearProviderReference).toHaveBeenCalledWith('item-1');
    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'subscription.service.removed',
      { subscriptionId: 'sub-1', itemId: 'item-1' },
      'user-1',
    );
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
      expect.objectContaining({ id: 'plan-1' }),
    );
    expect(billingEmailPublisher.publishSubscriptionCanceled).toHaveBeenCalled();
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
    expect(billingEmailPublisher.publishSubscriptionCanceled).not.toHaveBeenCalled();
    expect(billingEmailPublisher.publishSubscriptionWithdrawn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1' }),
      'Plan',
    );
  });

  it('skips open position when skipOpenPosition is true', async () => {
    await service.teardownImmediate('sub-1', { skipOpenPosition: true });

    expect(openPositionsRepository.create).not.toHaveBeenCalled();
  });

  describe('Loadweaver teardown grace (M4)', () => {
    it('does not destroy the server before teardownNotBefore on withdrawal or instant cancel', async () => {
      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
        withdrawPhase: 'withdrawal_period',
        withdrawnAt: new Date(),
        teardownNotBefore: new Date(Date.now() + 60_000),
      });

      await service.processWithdrawal('sub-1');
      await service.processInstantCancel('sub-1');

      expect(provisioningService.deprovision).not.toHaveBeenCalled();
      expect(subscriptionsRepository.update).not.toHaveBeenCalled();
    });

    it('tears down once the grace period has passed', async () => {
      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_INSTANT_CANCEL,
        teardownNotBefore: new Date(Date.now() - 1000),
      });

      await service.processInstantCancel('sub-1');

      expect(provisioningService.deprovision).toHaveBeenCalled();
    });
  });

  describe('processWithdrawal', () => {
    it('applies refund and tears down when phase is withdrawal_period', async () => {
      const withdrawnAt = new Date('2024-06-01T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
        withdrawnAt,
        withdrawPhase: 'withdrawal_period',
      });
      withdrawalRefundService.applyProvisionedWithdrawalRefund.mockResolvedValue({
        paymentRefundStatus: 'not_applicable',
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

    it('shrinks unbilled advance debt and skips teardown open position', async () => {
      const withdrawnAt = new Date('2024-06-01T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
        withdrawnAt,
        withdrawPhase: 'withdrawal_period',
      });
      servicePlansRepository.findByIdOrThrow.mockResolvedValue({
        id: 'plan-1',
        name: 'Advance Plan',
        billInAdvance: true,
        autoRecalculatePriceDaily: false,
        billingIntervalType: 'year',
      });
      openPositionsRepository.findUnbilledBySubscription.mockResolvedValue([{ id: 'pos-1' }]);

      await service.processWithdrawal('sub-1');

      expect(withdrawalRefundService.applyProvisionedWithdrawalRefund).not.toHaveBeenCalled();
      expect(openPositionsRepository.updateUnbilledBillUntil).toHaveBeenCalledWith('sub-1', withdrawnAt);
      expect(openPositionsRepository.create).not.toHaveBeenCalled();
    });

    it('credits billable invoice for advance when no unbilled open position remains', async () => {
      const withdrawnAt = new Date('2024-06-01T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
        withdrawnAt,
        withdrawPhase: 'withdrawal_period',
      });
      servicePlansRepository.findByIdOrThrow.mockResolvedValue({
        id: 'plan-1',
        name: 'Advance Plan',
        billInAdvance: true,
        autoRecalculatePriceDaily: false,
        billingIntervalType: 'year',
      });
      openPositionsRepository.findUnbilledBySubscription.mockResolvedValue([]);

      await service.processWithdrawal('sub-1');

      expect(withdrawalRefundService.applyProvisionedWithdrawalRefund).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub-1' }),
        withdrawnAt,
      );
      expect(openPositionsRepository.updateUnbilledBillUntil).not.toHaveBeenCalled();
      expect(openPositionsRepository.create).not.toHaveBeenCalled();
    });

    it('skips refund and open position when phase is unprovisioned', async () => {
      const withdrawnAt = new Date('2024-06-02T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        planId: 'plan-1',
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

    it('shrinks unbilled advance debt even when phase is unprovisioned', async () => {
      const withdrawnAt = new Date('2024-06-02T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_WITHDRAWAL,
        withdrawnAt,
        withdrawPhase: 'unprovisioned',
      });
      servicePlansRepository.findByIdOrThrow.mockResolvedValue({
        id: 'plan-1',
        name: 'Advance Plan',
        billInAdvance: true,
        autoRecalculatePriceDaily: false,
        billingIntervalType: 'year',
      });
      openPositionsRepository.findUnbilledBySubscription.mockResolvedValue([{ id: 'pos-1' }]);

      await service.processWithdrawal('sub-1');

      expect(openPositionsRepository.updateUnbilledBillUntil).toHaveBeenCalledWith('sub-1', withdrawnAt);
      expect(withdrawalRefundService.applyProvisionedWithdrawalRefund).not.toHaveBeenCalled();
      expect(openPositionsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('processInstantCancel', () => {
    it('bills used time via open position for arrear plans', async () => {
      const instantCanceledAt = new Date('2024-07-01T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_INSTANT_CANCEL,
        instantRemoval: true,
        instantCanceledAt,
      });

      await service.processInstantCancel('sub-1');

      expect(withdrawalRefundService.applyProvisionedWithdrawalRefund).not.toHaveBeenCalled();
      expect(openPositionsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Subscription SUB-001',
          billUntil: instantCanceledAt,
        }),
      );
      expect(billingEmailPublisher.publishSubscriptionCanceled).toHaveBeenCalled();
      expect(billingEmailPublisher.publishSubscriptionWithdrawn).not.toHaveBeenCalled();
    });

    it('shrinks unbilled advance debt and skips teardown open position', async () => {
      const instantCanceledAt = new Date('2024-07-01T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_INSTANT_CANCEL,
        instantRemoval: true,
        instantCanceledAt,
      });
      servicePlansRepository.findByIdOrThrow.mockResolvedValue({
        id: 'plan-1',
        name: 'Advance Plan',
        billInAdvance: true,
        autoRecalculatePriceDaily: false,
        billingIntervalType: 'year',
      });
      openPositionsRepository.findUnbilledBySubscription.mockResolvedValue([{ id: 'pos-1' }]);

      await service.processInstantCancel('sub-1');

      expect(openPositionsRepository.updateUnbilledBillUntil).toHaveBeenCalledWith('sub-1', instantCanceledAt);
      expect(withdrawalRefundService.applyProvisionedWithdrawalRefund).not.toHaveBeenCalled();
      expect(openPositionsRepository.create).not.toHaveBeenCalled();
      expect(billingEmailPublisher.publishSubscriptionCanceled).toHaveBeenCalled();
    });

    it('refunds prepaid invoice like withdrawal when no unbilled open position remains', async () => {
      const instantCanceledAt = new Date('2024-07-01T12:00:00Z');

      subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'sub-1',
        number: 'SUB-001',
        userId: 'user-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_INSTANT_CANCEL,
        instantRemoval: true,
        instantCanceledAt,
      });
      servicePlansRepository.findByIdOrThrow.mockResolvedValue({
        id: 'plan-1',
        name: 'Advance Plan',
        billInAdvance: true,
        autoRecalculatePriceDaily: false,
        billingIntervalType: 'year',
      });
      openPositionsRepository.findUnbilledBySubscription.mockResolvedValue([]);
      withdrawalRefundService.applyProvisionedWithdrawalRefund.mockResolvedValue({
        paymentRefundStatus: 'succeeded',
      });

      await service.processInstantCancel('sub-1');

      expect(withdrawalRefundService.applyProvisionedWithdrawalRefund).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub-1' }),
        instantCanceledAt,
      );
      expect(openPositionsRepository.create).not.toHaveBeenCalled();
      expect(billingEmailPublisher.publishSubscriptionCanceled).toHaveBeenCalled();
      expect(billingEmailPublisher.publishSubscriptionWithdrawn).not.toHaveBeenCalled();
    });
  });
});
