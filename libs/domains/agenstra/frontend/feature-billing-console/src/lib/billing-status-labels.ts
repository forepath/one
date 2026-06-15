/**
 * Maps billing-manager API status strings to localized, human-readable labels.
 * Values align with SubscriptionStatus and BackorderStatus in feature-billing-manager.
 */

export function getSubscriptionStatusLabel(status: string | null | undefined): string {
  if (status == null || status === '') {
    return $localize`:@@featureBilling-subscriptionStatusEmpty:Unknown`;
  }

  switch (status) {
    case 'active':
      return $localize`:@@featureBilling-subscriptionStatusActive:Active`;
    case 'pending_backorder':
      return $localize`:@@featureBilling-subscriptionStatusPendingBackorder:Pending backorder`;
    case 'pending_cancel':
      return $localize`:@@featureBilling-subscriptionStatusPendingCancel:Pending cancellation`;
    case 'canceled':
      return $localize`:@@featureBilling-subscriptionStatusCanceled:Canceled`;
    default:
      return $localize`:@@featureBilling-subscriptionStatusUnknown:Unknown (${status})`;
  }
}

export function getBackorderStatusLabel(status: string | null | undefined): string {
  if (status == null || status === '') {
    return $localize`:@@featureBilling-backorderStatusEmpty:Unknown`;
  }

  switch (status) {
    case 'pending':
      return $localize`:@@featureBilling-backorderStatusPending:Pending`;
    case 'retrying':
      return $localize`:@@featureBilling-backorderStatusRetrying:Retrying`;
    case 'fulfilled':
      return $localize`:@@featureBilling-backorderStatusFulfilled:Fulfilled`;
    case 'cancelled':
      return $localize`:@@featureBilling-backorderStatusCancelled:Cancelled`;
    case 'failed':
      return $localize`:@@featureBilling-backorderStatusFailed:Failed`;
    default:
      return $localize`:@@featureBilling-backorderStatusUnknown:Unknown (${status})`;
  }
}
