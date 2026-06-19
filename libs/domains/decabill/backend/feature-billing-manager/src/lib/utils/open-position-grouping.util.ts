import type { OpenPositionEntity } from '../entities/open-position.entity';

export interface OpenPositionBillingGroup {
  subscriptionId: string;
  positions: OpenPositionEntity[];
  representative: OpenPositionEntity;
}

/** Groups unbilled positions per subscription; bills each subscription once using the latest billUntil. */
export function groupOpenPositionsBySubscription(positions: OpenPositionEntity[]): OpenPositionBillingGroup[] {
  const bySubscription = new Map<string, OpenPositionEntity[]>();

  for (const position of positions) {
    const list = bySubscription.get(position.subscriptionId) ?? [];

    list.push(position);
    bySubscription.set(position.subscriptionId, list);
  }

  return Array.from(bySubscription.entries()).map(([subscriptionId, subscriptionPositions]) => ({
    subscriptionId,
    positions: subscriptionPositions,
    representative: subscriptionPositions.reduce((latest, current) =>
      current.billUntil >= latest.billUntil ? current : latest,
    ),
  }));
}
