import { BillingIntervalType } from '../entities/service-plan.entity';

import { SubscriptionBillingJobHandler } from './subscription-billing.job-handler';

describe('SubscriptionBillingJobHandler', () => {
  const subscriptionsRepository = {
    findDueForBilling: jest.fn(),
    findByIdOrThrow: jest.fn(),
  } as any;
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
  } as any;
  const openPositionsRepository = {
    hasUnbilledForSubscription: jest.fn(),
  } as any;
  const subscriptionPeriodChargeService = {
    processDueBilling: jest.fn(),
  } as any;
  const handler = new SubscriptionBillingJobHandler(
    subscriptionsRepository,
    servicePlansRepository,
    openPositionsRepository,
    subscriptionPeriodChargeService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('findDueSubscriptionIds returns ids from repository', async () => {
    subscriptionsRepository.findDueForBilling.mockResolvedValue([{ id: 'sub-1' }]);

    await expect(handler.findDueSubscriptionIds()).resolves.toEqual(['sub-1']);
  });

  it('processSubscription skips when an unbilled open position already exists', async () => {
    openPositionsRepository.hasUnbilledForSubscription.mockResolvedValue(true);

    await handler.processSubscription('sub-1');

    expect(subscriptionPeriodChargeService.processDueBilling).not.toHaveBeenCalled();
  });

  it('processSubscription delegates to period charge service', async () => {
    openPositionsRepository.hasUnbilledForSubscription.mockResolvedValue(false);
    const subscription = {
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      number: '123456',
      nextBillingAt: new Date('2026-06-01'),
    };
    const plan = {
      id: 'plan-1',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      billInAdvance: false,
    };

    subscriptionsRepository.findByIdOrThrow.mockResolvedValue(subscription);
    servicePlansRepository.findByIdOrThrow.mockResolvedValue(plan);

    await handler.processSubscription('sub-1');

    expect(subscriptionPeriodChargeService.processDueBilling).toHaveBeenCalledWith(subscription, plan);
  });
});
