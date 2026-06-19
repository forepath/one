import type { SubscriptionResponse } from '@forepath/agenstra/frontend/data-access-billing-console';

import {
  filterBillingAdminSubscriptions,
  getBillingAdminSubscriptionPrimaryLabel,
} from './billing-subscription-select';

describe('billing-subscription-select', () => {
  const subscriptions: SubscriptionResponse[] = [
    {
      id: 'sub-1',
      number: 'SUB-001',
      planId: 'plan-basic',
      userId: 'user-1',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'sub-2',
      number: '',
      planId: 'plan-pro',
      userId: 'user-1',
      status: 'canceled',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  it('uses subscription number as primary label when available', () => {
    expect(getBillingAdminSubscriptionPrimaryLabel(subscriptions[0])).toBe('SUB-001');
    expect(getBillingAdminSubscriptionPrimaryLabel(subscriptions[1])).toBe('plan-pro');
  });

  it('returns all subscriptions up to the limit when query is empty', () => {
    expect(filterBillingAdminSubscriptions(subscriptions, '', 1)).toEqual([subscriptions[0]]);
  });

  it('filters subscriptions by number, plan, id, or status', () => {
    expect(filterBillingAdminSubscriptions(subscriptions, 'sub-001')).toEqual([subscriptions[0]]);
    expect(filterBillingAdminSubscriptions(subscriptions, 'plan-pro')).toEqual([subscriptions[1]]);
    expect(filterBillingAdminSubscriptions(subscriptions, 'sub-2')).toEqual([subscriptions[1]]);
  });
});
