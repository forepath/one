import { BillingIntervalType } from '../entities/service-plan.entity';

import { BillingScheduleService } from './billing-schedule.service';
import { SubscriptionBillingJobHandler } from './subscription-billing.job-handler';

describe('SubscriptionBillingJobHandler', () => {
  const subscriptionsRepository = {
    findDueForBilling: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  } as any;
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
  } as any;
  const billingScheduleService = new BillingScheduleService();
  const openPositionsRepository = {
    create: jest.fn(),
    hasUnbilledForSubscription: jest.fn(),
  } as any;
  const handler = new SubscriptionBillingJobHandler(
    subscriptionsRepository,
    servicePlansRepository,
    billingScheduleService,
    openPositionsRepository,
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

    expect(openPositionsRepository.create).not.toHaveBeenCalled();
    expect(subscriptionsRepository.update).not.toHaveBeenCalled();
  });

  it('processSubscription creates open position and updates schedule', async () => {
    openPositionsRepository.hasUnbilledForSubscription.mockResolvedValue(false);
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-1',
      number: '123456',
      nextBillingAt: new Date('2026-06-01'),
    });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({
      id: 'plan-1',
      billingIntervalType: BillingIntervalType.MONTH,
      billingIntervalValue: 1,
      billingDayOfMonth: undefined,
    });
    openPositionsRepository.create.mockResolvedValue({});
    subscriptionsRepository.update.mockResolvedValue({});

    await handler.processSubscription('sub-1');

    expect(openPositionsRepository.create).toHaveBeenCalled();
    expect(subscriptionsRepository.update).toHaveBeenCalled();
  });
});
