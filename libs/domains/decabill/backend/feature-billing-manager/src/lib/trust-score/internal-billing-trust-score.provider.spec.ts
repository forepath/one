import { SubscriptionStatus } from '../entities/subscription.entity';

import { InternalBillingTrustScoreProvider } from './internal-billing-trust-score.provider';

describe('InternalBillingTrustScoreProvider', () => {
  const customerProfilesRepository = {
    findByUserId: jest.fn(),
  };
  const customerProfilesService = {
    isProfileComplete: jest.fn(),
  };
  const invoicesRepository = {
    findOpenOverdueByUserId: jest.fn(),
    countBilledSubscriptionInvoicesByUserId: jest.fn(),
    hasAutoPaymentExhaustedByUserId: jest.fn(),
  };
  const paymentAttemptsRepository = {
    countSucceededOnTimeByUserId: jest.fn(),
    countFailedByUserId: jest.fn(),
  };
  const subscriptionsRepository = {
    findAllForUserInTenant: jest.fn(),
  };
  const backordersRepository = {
    countFailedByUserId: jest.fn(),
  };

  const provider = new InternalBillingTrustScoreProvider(
    customerProfilesRepository as never,
    customerProfilesService as never,
    invoicesRepository as never,
    paymentAttemptsRepository as never,
    subscriptionsRepository as never,
    backordersRepository as never,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    customerProfilesRepository.findByUserId.mockResolvedValue({
      id: 'profile-1',
      autoBillingEnabled: true,
      defaultPaymentMethodExternalId: 'pm_1',
      stripeCustomerId: 'cus_1',
    });
    customerProfilesService.isProfileComplete.mockReturnValue(true);
    invoicesRepository.findOpenOverdueByUserId.mockResolvedValue([{ id: 'inv-1' }, { id: 'inv-2' }]);
    invoicesRepository.countBilledSubscriptionInvoicesByUserId.mockResolvedValue(2);
    invoicesRepository.hasAutoPaymentExhaustedByUserId.mockResolvedValue(true);
    paymentAttemptsRepository.countSucceededOnTimeByUserId.mockResolvedValue(3);
    paymentAttemptsRepository.countFailedByUserId.mockResolvedValue(2);
    subscriptionsRepository.findAllForUserInTenant.mockResolvedValue([
      { id: 'sub-1', status: SubscriptionStatus.ACTIVE, withdrawnAt: null },
    ]);
    backordersRepository.countFailedByUserId.mockResolvedValue(2);
  });

  it('builds positive and negative trust factors from billing data', async () => {
    const factors = await provider.evaluate('user-1');

    expect(factors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'profile_complete', points: 10 }),
        expect.objectContaining({ id: 'active_or_past_subscription', points: 15 }),
        expect.objectContaining({ id: 'multi_period_tenure', points: 20 }),
        expect.objectContaining({ id: 'on_time_payments', points: 15 }),
        expect.objectContaining({ id: 'auto_billing_ready', points: 10 }),
        expect.objectContaining({ id: 'no_withdrawal', points: 10 }),
        expect.objectContaining({ id: 'overdue_invoices', points: -30 }),
        expect.objectContaining({ id: 'failed_payments', points: -20 }),
        expect.objectContaining({ id: 'auto_payment_exhausted', points: -20 }),
        expect.objectContaining({ id: 'backorder_failures', points: -10 }),
      ]),
    );
  });

  it('caps repeated factors and emits withdrawal penalty when applicable', async () => {
    paymentAttemptsRepository.countSucceededOnTimeByUserId.mockResolvedValue(9);
    paymentAttemptsRepository.countFailedByUserId.mockResolvedValue(12);
    invoicesRepository.findOpenOverdueByUserId.mockResolvedValue(new Array(9).fill({ id: 'inv' }));
    backordersRepository.countFailedByUserId.mockResolvedValue(9);
    subscriptionsRepository.findAllForUserInTenant.mockResolvedValue([
      { id: 'sub-1', status: SubscriptionStatus.PENDING_WITHDRAWAL, withdrawnAt: new Date() },
    ]);

    const factors = await provider.evaluate('user-1');

    expect(factors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'on_time_payments', points: 25 }),
        expect.objectContaining({ id: 'failed_payments', points: -50 }),
        expect.objectContaining({ id: 'overdue_invoices', points: -75 }),
        expect.objectContaining({ id: 'backorder_failures', points: -15 }),
        expect.objectContaining({ id: 'product_withdrawal', points: -25 }),
      ]),
    );
    expect(factors.some((factor) => factor.id === 'no_withdrawal')).toBe(false);
  });
});
