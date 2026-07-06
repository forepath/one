import { ProvisioningStatus } from '../entities/subscription-item.entity';
import type { SubscriptionItemEntity } from '../entities/subscription-item.entity';

export function getEarliestProvisionedAt(
  items: Pick<SubscriptionItemEntity, 'provisionedAt' | 'createdAt' | 'provisioningStatus'>[],
): Date | undefined {
  const timestamps = items
    .filter((item) => item.provisioningStatus === ProvisioningStatus.ACTIVE || item.provisionedAt != null)
    .map((item) => item.provisionedAt ?? item.createdAt);

  if (timestamps.length === 0) {
    return undefined;
  }

  return timestamps.reduce((earliest, current) => (current < earliest ? current : earliest));
}
