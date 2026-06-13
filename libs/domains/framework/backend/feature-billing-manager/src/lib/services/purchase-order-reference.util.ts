export function resolvePurchaseOrderReference(
  subscriptionNumber: string | null | undefined,
  subscriptionId: string,
): string {
  const number = subscriptionNumber?.trim();

  return number && number.length > 0 ? number : subscriptionId;
}
