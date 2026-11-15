import type { SubscriptionResponse } from '@forepath/decabill/frontend/data-access-billing-console';

import {
  filterBillingAdminSubscriptions,
  getBillingAdminSubscriptionPlanLabel,
  getBillingAdminSubscriptionPrimaryLabel,
} from './billing-subscription-select';
import { getUnavailableLabel } from './named-label.util';

describe('billing-subscription-select', () => {
  const subscriptions: SubscriptionResponse[] = [
    {
      id: 'sub-1',
      number: 'SUB-001',
      planId: 'plan-basic',
      planName: 'Basic',
      userId: 'user-1',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'sub-2',
      number: '',
      planId: 'plan-pro',
      planName: 'Pro Plan',
      userId: 'user-1',
      status: 'canceled',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'sub-3',
      number: '',
      planId: 'plan-missing',
      userId: 'user-1',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  it('uses subscription number as primary label when available', () => {
    expect(getBillingAdminSubscriptionPrimaryLabel(subscriptions[0])).toBe('SUB-001');
  });

  it('uses planName as primary label when number is empty', () => {
    expect(getBillingAdminSubscriptionPrimaryLabel(subscriptions[1])).toBe('Pro Plan');
  });

  it('does not fall back to planId when planName is missing', () => {
    expect(getBillingAdminSubscriptionPrimaryLabel(subscriptions[2])).toBe(getUnavailableLabel());
    expect(getBillingAdminSubscriptionPlanLabel(subscriptions[2])).toBe(getUnavailableLabel());
  });

  it('returns all subscriptions up to the limit when query is empty', () => {
    expect(filterBillingAdminSubscriptions(subscriptions, '', 1)).toEqual([subscriptions[0]]);
  });

  it('filters subscriptions by number, plan name, id, or status', () => {
    expect(filterBillingAdminSubscriptions(subscriptions, 'sub-001')).toEqual([subscriptions[0]]);
    expect(filterBillingAdminSubscriptions(subscriptions, 'pro plan')).toEqual([subscriptions[1]]);
    expect(filterBillingAdminSubscriptions(subscriptions, 'sub-2')).toEqual([subscriptions[1]]);
  });
});
