export function resolvePurchaseOrderReference(
  subscriptionNumber: string | null | undefined,
  subscriptionId?: string,
): string {
  const number = subscriptionNumber?.trim();

  if (number && number.length > 0) {
    return number;
  }

  return subscriptionId ?? '';
}
