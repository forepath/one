import type { ServicePlansRepository } from '../repositories/service-plans.repository';
import type { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import type { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { SubscriptionExpirationJobHandler } from './subscription-expiration.job-handler';
import type { SubscriptionTeardownService } from './subscription-teardown.service';

describe('SubscriptionExpirationJobHandler', () => {
  const subscriptions = { findByIdOrThrow: jest.fn(), findDueForCancellation: jest.fn() };
  const plans = { findByIdOrThrow: jest.fn() };
  const teardown = { teardownImmediate: jest.fn() };
  const items = { findBySubscription: jest.fn() };
  const cancelEffectiveAt = new Date('2026-11-01T00:00:00Z');
  let handler: SubscriptionExpirationJobHandler;

  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.LOADWEAVER_TEARDOWN_GRACE_DAYS;
    handler = new SubscriptionExpirationJobHandler(
      subscriptions as unknown as SubscriptionsRepository,
      plans as unknown as ServicePlansRepository,
      teardown as unknown as SubscriptionTeardownService,
      items as unknown as SubscriptionItemsRepository,
    );
    subscriptions.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', planId: 'plan-1', cancelEffectiveAt });
    plans.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', billInAdvance: true });
  });

  it('tears down other stacks at the effective date', async () => {
    items.findBySubscription.mockResolvedValue([{ configSnapshot: { service: 'decabill-billing' } }]);

    await handler.processSubscriptionCancellation('sub-1', new Date('2026-11-01T00:05:00Z'));

    expect(teardown.teardownImmediate).toHaveBeenCalledWith('sub-1', {
      billUntil: cancelEffectiveAt,
      skipOpenPosition: true,
    });
  });

  it('keeps a Loadweaver cluster for the grace period, then tears down billed until the effective date', async () => {
    items.findBySubscription.mockResolvedValue([{ configSnapshot: { service: 'loadweaver' } }]);

    await handler.processSubscriptionCancellation('sub-1', new Date('2026-11-07T23:59:00Z'));
    expect(teardown.teardownImmediate).not.toHaveBeenCalled();

    await handler.processSubscriptionCancellation('sub-1', new Date('2026-11-08T00:00:00Z'));
    expect(teardown.teardownImmediate).toHaveBeenCalledWith('sub-1', {
      billUntil: cancelEffectiveAt,
      skipOpenPosition: true,
    });
  });

  it('honours LOADWEAVER_TEARDOWN_GRACE_DAYS=0', async () => {
    process.env.LOADWEAVER_TEARDOWN_GRACE_DAYS = '0';
    items.findBySubscription.mockResolvedValue([{ configSnapshot: { service: 'loadweaver' } }]);

    await handler.processSubscriptionCancellation('sub-1', new Date('2026-11-01T00:00:00Z'));

    expect(teardown.teardownImmediate).toHaveBeenCalled();
    delete process.env.LOADWEAVER_TEARDOWN_GRACE_DAYS;
  });

  it('uses the teardown time stored at cancellation', async () => {
    subscriptions.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      planId: 'plan-1',
      cancelEffectiveAt,
      teardownNotBefore: new Date('2026-11-03T00:00:00Z'),
    });
    items.findBySubscription.mockResolvedValue([{ configSnapshot: { service: 'loadweaver' } }]);

    await handler.processSubscriptionCancellation('sub-1', new Date('2026-11-02T23:59:00Z'));
    expect(teardown.teardownImmediate).not.toHaveBeenCalled();

    await handler.processSubscriptionCancellation('sub-1', new Date('2026-11-03T00:00:00Z'));
    expect(teardown.teardownImmediate).toHaveBeenCalledWith('sub-1', {
      billUntil: cancelEffectiveAt,
      skipOpenPosition: true,
    });
  });

  it('passes the batch size to the due query (which filters out grace periods)', async () => {
    subscriptions.findDueForCancellation.mockResolvedValue([{ id: 'due-1' }]);

    await expect(handler.findExpiredSubscriptionIds()).resolves.toEqual(['due-1']);
    expect(subscriptions.findDueForCancellation).toHaveBeenCalledWith(expect.any(Date), 100);
  });
});
