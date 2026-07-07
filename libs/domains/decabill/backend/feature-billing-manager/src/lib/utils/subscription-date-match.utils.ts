import type { SubscriptionItemEntity } from '../entities/subscription-item.entity';
import { ProvisioningStatus } from '../entities/subscription-item.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';

export function toUtcCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function isSubscriptionDeployed(
  items: Pick<SubscriptionItemEntity, 'provisioningStatus' | 'provisionedAt' | 'createdAt'>[],
): boolean {
  return items.some((item) => item.provisioningStatus === ProvisioningStatus.ACTIVE);
}

export function getDeployedOnDate(
  items: Pick<SubscriptionItemEntity, 'provisioningStatus' | 'provisionedAt' | 'createdAt'>[],
): Date | null {
  const activeItems = items.filter((item) => item.provisioningStatus === ProvisioningStatus.ACTIVE);

  if (activeItems.length === 0) {
    return null;
  }

  return activeItems.reduce<Date>((earliest, item) => {
    const reference = item.provisionedAt ?? item.createdAt;

    return reference < earliest ? reference : earliest;
  }, activeItems[0].provisionedAt ?? activeItems[0].createdAt);
}

export function matchesSubscriptionDates(
  subscription: Pick<SubscriptionEntity, 'createdAt'>,
  items: Pick<SubscriptionItemEntity, 'provisioningStatus' | 'provisionedAt' | 'createdAt'>[],
  input: { orderedOn: string; receivedOn?: string },
): boolean {
  if (toUtcCalendarDate(subscription.createdAt) !== input.orderedOn) {
    return false;
  }

  if (!isSubscriptionDeployed(items)) {
    return true;
  }

  const receivedOn = input.receivedOn?.trim();

  if (!receivedOn) {
    return true;
  }

  const deployedOn = getDeployedOnDate(items);

  if (!deployedOn) {
    return true;
  }

  return toUtcCalendarDate(deployedOn) === receivedOn;
}
