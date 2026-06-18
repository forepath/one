import type { SubscriptionResponse } from '@forepath/agenstra/frontend/data-access-billing-console';

export function getBillingAdminSubscriptionPrimaryLabel(subscription: SubscriptionResponse): string {
  const number = subscription.number?.trim();

  if (number) {
    return number;
  }

  return subscription.planId;
}

export function filterBillingAdminSubscriptions(
  subscriptions: SubscriptionResponse[],
  query: string,
  limit = 20,
): SubscriptionResponse[] {
  const term = query.trim().toLowerCase();
  const filtered = term
    ? subscriptions.filter((subscription) => {
        const haystack = [subscription.id, subscription.number, subscription.planId, subscription.status]
          .join(' ')
          .toLowerCase();

        return haystack.includes(term);
      })
    : subscriptions;

  return filtered.slice(0, limit);
}
