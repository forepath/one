/**
 * Maps billing-manager API status strings to localized, human-readable labels.
 * Values align with SubscriptionStatus and BackorderStatus in feature-billing-manager.
 */

import type {
  BillingIntervalType,
  PromotionRedemptionContext,
  PromotionRedemptionStatus,
  ProviderDetail,
} from '@forepath/decabill/frontend/data-access-billing-console';

import { getCountryDisplayName } from './billing-country-options';

export function getUnavailableLabel(): string {
  return $localize`:@@featureBilling-notAvailable:N/A`;
}

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
    case 'pending_withdrawal':
      return $localize`:@@featureBilling-subscriptionStatusPendingWithdrawal:Pending withdrawal`;
    case 'canceled':
      return $localize`:@@featureBilling-subscriptionStatusCanceled:Canceled`;
    default:
      return $localize`:@@featureBilling-subscriptionStatusUnknown:Unknown (${status})`;
  }
}

export function getProvisioningStatusLabel(status: string | null | undefined): string {
  if (status == null || status === '') {
    return $localize`:@@featureBilling-provisioningStatusEmpty:Unknown`;
  }

  switch (status) {
    case 'pending':
      return $localize`:@@featureBilling-provisioningStatusPending:Provisioning`;
    case 'active':
      return $localize`:@@featureBilling-provisioningStatusActive:Provisioned`;
    case 'failed':
      return $localize`:@@featureBilling-provisioningStatusFailed:Provisioning failed`;
    default:
      return $localize`:@@featureBilling-provisioningStatusUnknown:Unknown (${status})`;
  }
}

/** Status chip modifier paired with global `.info-badge` base classes. */
export function getProvisioningStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return 'billing-admin__chip--status-partially-paid';
    case 'active':
      return 'billing-admin__chip--status-paid';
    case 'failed':
      return 'billing-admin__chip--status-overdue';
    default:
      return 'billing-admin__chip--status-unknown';
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

export function getInvoiceStatusLabel(status: string | null | undefined): string {
  if (status == null || status === '') {
    return $localize`:@@featureBilling-invoiceStatusEmpty:Unknown`;
  }

  switch (status) {
    case 'draft':
      return $localize`:@@featureInvoices-statusDraft:Draft`;
    case 'issued':
      return $localize`:@@featureInvoices-statusIssued:Issued`;
    case 'partially_paid':
      return $localize`:@@featureInvoices-statusPartiallyPaid:Partially paid`;
    case 'paid':
      return $localize`:@@featureInvoices-statusPaid:Paid`;
    case 'overdue':
      return $localize`:@@featureInvoices-statusOverdue:Overdue`;
    case 'void':
      return $localize`:@@featureInvoices-statusVoid:Void`;
    default:
      return $localize`:@@featureBilling-invoiceStatusUnknown:Unknown (${status})`;
  }
}

/** Status chip modifier paired with global `.info-badge` base classes. */
export function getSubscriptionStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return 'billing-admin__chip--status-paid';
    case 'pending_cancel':
      return 'billing-admin__chip--status-partially-paid';
    case 'pending_withdrawal':
      return 'billing-admin__chip--status-partially-paid';
    case 'pending_backorder':
      return 'billing-admin__chip--status-issued';
    case 'canceled':
      return 'billing-admin__chip--status-void';
    default:
      return 'billing-admin__chip--status-unknown';
  }
}

export function getBackorderStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return 'billing-admin__chip--status-issued';
    case 'retrying':
      return 'billing-admin__chip--status-partially-paid';
    case 'fulfilled':
      return 'billing-admin__chip--status-paid';
    case 'cancelled':
      return 'billing-admin__chip--status-void';
    case 'failed':
      return 'billing-admin__chip--status-overdue';
    default:
      return 'billing-admin__chip--status-unknown';
  }
}

export function getInvoiceStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'draft':
      return 'billing-admin__chip--status-draft';
    case 'issued':
      return 'billing-admin__chip--status-issued';
    case 'partially_paid':
      return 'billing-admin__chip--status-partially-paid';
    case 'paid':
      return 'billing-admin__chip--status-paid';
    case 'overdue':
      return 'billing-admin__chip--status-overdue';
    case 'void':
      return 'billing-admin__chip--status-void';
    default:
      return 'billing-admin__chip--status-unknown';
  }
}

export function getActiveStatusLabel(isActive: boolean): string {
  return isActive
    ? $localize`:@@featureBilling-activeStatusActive:Active`
    : $localize`:@@featureBilling-activeStatusInactive:Inactive`;
}

export function getActiveStatusTextClass(isActive: boolean): string {
  return isActive ? 'text-success' : 'text-secondary';
}

export function getCustomerTrustLevelLabel(level: string | null | undefined): string {
  switch (level) {
    case 'green':
      return $localize`:@@featureBilling-customerTrustGreen:High trust`;
    case 'yellow':
      return $localize`:@@featureBilling-customerTrustYellow:Needs attention`;
    case 'red':
      return $localize`:@@featureBilling-customerTrustRed:High risk`;
    default:
      return $localize`:@@featureBilling-customerTrustUnknown:Not scored`;
  }
}

export function getCustomerTrustLevelTextClass(level: string | null | undefined): string {
  switch (level) {
    case 'green':
      return 'text-success';
    case 'yellow':
      return 'text-warning';
    case 'red':
      return 'text-danger';
    default:
      return 'text-secondary';
  }
}

export function getCustomerTrustLevelIconClass(level: string | null | undefined): string {
  switch (level) {
    case 'green':
      return 'bi-shield-check';
    case 'yellow':
      return 'bi-shield-exclamation';
    case 'red':
      return 'bi-shield-fill-exclamation';
    default:
      return 'bi-shield';
  }
}

export function isProjectTimeEntryBilled(entry: { billedAt?: string | null; invoiceId?: string | null }): boolean {
  return !!(entry.billedAt || entry.invoiceId);
}

export function getProjectTimeEntryBillingStatusLabel(isBilled: boolean): string {
  return isBilled
    ? $localize`:@@featureBilling-timeEntryStatusBilled:Billed`
    : $localize`:@@featureBilling-timeEntryStatusUnbilled:Unbilled`;
}

export function getProjectTimeEntryBillingStatusTextClass(isBilled: boolean): string {
  return isBilled ? 'text-success' : 'text-secondary';
}

export function getProjectTimeEntryBillingStatusIconClass(isBilled: boolean): string {
  return isBilled ? 'bi-receipt' : 'bi-receipt-cutoff';
}

export function getProjectStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return $localize`:@@featureBilling-projectStatusActive:Active`;
    case 'archived':
      return $localize`:@@featureBilling-projectStatusArchived:Archived`;
    default:
      return status ?? getUnavailableLabel();
  }
}

export function getProjectStatusTextClass(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return 'text-success';
    case 'archived':
      return 'text-secondary';
    default:
      return 'text-secondary';
  }
}

export function getProjectStatusIconClass(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return 'bi-check-circle';
    case 'archived':
      return 'bi-archive';
    default:
      return 'bi-question-circle';
  }
}

export function formatProjectHourlyRate(amount: number, currency: string): string {
  const formatted = Number.isFinite(amount) ? amount.toFixed(2) : '0.00';

  if (currency === 'EUR') {
    return `${formatted}€ / h`;
  }

  return `${formatted} ${currency} / h`;
}

export function formatProjectOpenBillableAmount(amount: number, currency: string): string {
  const formatted = Number.isFinite(amount) ? amount.toFixed(2) : '0.00';

  if (currency === 'EUR') {
    return `${formatted}€`;
  }

  return `${formatted} ${currency}`;
}

export function formatProjectMinutes(minutes: number): string {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;

  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

export function getDatevExportStatusLabel(status: string | null | undefined): string {
  if (status == null || status === '') {
    return $localize`:@@featureBilling-datevExportStatusEmpty:Unknown`;
  }

  switch (status) {
    case 'pending':
      return $localize`:@@featureAdminDatevExports-statusPending:Pending`;
    case 'running':
      return $localize`:@@featureAdminDatevExports-statusRunning:Running`;
    case 'completed':
      return $localize`:@@featureAdminDatevExports-statusCompleted:Completed`;
    case 'failed':
      return $localize`:@@featureAdminDatevExports-statusFailed:Failed`;
    default:
      return $localize`:@@featureBilling-datevExportStatusUnknown:Unknown (${status})`;
  }
}

export function getDatevExportStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return 'billing-admin__chip--status-draft';
    case 'running':
      return 'billing-admin__chip--status-partially-paid';
    case 'completed':
      return 'billing-admin__chip--status-paid';
    case 'failed':
      return 'billing-admin__chip--status-overdue';
    default:
      return 'billing-admin__chip--status-unknown';
  }
}

export function getDatevExportStatusTextClass(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return 'text-warning';
    case 'running':
      return 'text-primary';
    case 'completed':
      return 'text-success';
    case 'failed':
      return 'text-danger';
    default:
      return 'text-secondary';
  }
}

export function getDatevExportStatusIconClass(status: string | null | undefined): string {
  switch (status) {
    case 'pending':
      return 'bi-clock';
    case 'running':
      return 'bi-arrow-repeat';
    case 'completed':
      return 'bi-check-circle';
    case 'failed':
      return 'bi-x-circle';
    default:
      return 'bi-question-circle';
  }
}

export function getDatevExportScopeLabel(scope: string | null | undefined): string {
  switch (scope) {
    case 'unified':
      return $localize`:@@featureAdminDatevExports-scopeUnified:Unified`;
    case 'tenant':
      return $localize`:@@featureAdminDatevExports-scopeTenant:This tenant`;
    default:
      return scope ?? getUnavailableLabel();
  }
}

export function getProfileCompleteLabel(isComplete: boolean): string {
  return isComplete
    ? $localize`:@@featureBilling-profileComplete:Complete`
    : $localize`:@@featureBilling-profileIncomplete:Incomplete`;
}

export function getCustomerTypeLabel(customerType: string | null | undefined): string {
  switch (customerType) {
    case 'business':
      return $localize`:@@featureBilling-customerTypeBusiness:Business`;
    case 'consumer':
      return $localize`:@@featureBilling-customerTypeConsumer:Consumer`;
    default:
      return getUnavailableLabel();
  }
}

export function getVatIdValidationStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'none':
      return $localize`:@@featureBilling-vatIdValidationNone:Not validated`;
    case 'pending':
      return $localize`:@@featureBilling-vatIdValidationPending:Pending`;
    case 'valid':
      return $localize`:@@featureBilling-vatIdValidationValid:Valid`;
    case 'invalid':
      return $localize`:@@featureBilling-vatIdValidationInvalid:Invalid`;
    case 'unavailable':
      return $localize`:@@featureBilling-vatIdValidationUnavailable:Unavailable`;
    default:
      return getUnavailableLabel();
  }
}

export function getProfileCompleteTextClass(isComplete: boolean): string {
  return isComplete ? 'text-success' : 'text-warning';
}

export function getPromotionRedemptionContextLabel(
  context: PromotionRedemptionContext | string | null | undefined,
): string {
  if (context == null || context === '') {
    return getUnavailableLabel();
  }

  switch (context) {
    case 'new':
      return $localize`:@@featureBilling-promotionRedemptionContextNew:New subscription`;
    case 'existing':
      return $localize`:@@featureBilling-promotionRedemptionContextExisting:Existing subscription`;
    default:
      return $localize`:@@featureBilling-promotionRedemptionContextUnknown:Unknown (${context})`;
  }
}

export function getPromotionRedemptionStatusLabel(
  status: PromotionRedemptionStatus | string | null | undefined,
): string {
  if (status == null || status === '') {
    return getUnavailableLabel();
  }

  switch (status) {
    case 'active':
      return $localize`:@@featureBilling-promotionRedemptionStatusActive:Active`;
    case 'exhausted':
      return $localize`:@@featureBilling-promotionRedemptionStatusExhausted:Fully used`;
    case 'expired':
      return $localize`:@@featureBilling-promotionRedemptionStatusExpired:Expired`;
    case 'cancelled':
      return $localize`:@@featureBilling-promotionRedemptionStatusCancelled:Cancelled`;
    default:
      return $localize`:@@featureBilling-promotionRedemptionStatusUnknown:Unknown (${status})`;
  }
}

export function getPromotionRedemptionStatusTextClass(
  status: PromotionRedemptionStatus | string | null | undefined,
): string {
  switch (status) {
    case 'active':
      return 'text-success';
    case 'exhausted':
      return 'text-secondary';
    case 'expired':
      return 'text-warning';
    case 'cancelled':
      return 'text-secondary';
    default:
      return 'text-secondary';
  }
}

export function getPromotionRedemptionStatusIconClass(
  status: PromotionRedemptionStatus | string | null | undefined,
): string {
  switch (status) {
    case 'active':
      return 'bi-check-circle';
    case 'exhausted':
      return 'bi-check-all';
    case 'expired':
      return 'bi-clock-history';
    case 'cancelled':
      return 'bi-x-circle';
    default:
      return 'bi-question-circle';
  }
}

export function getBillingIntervalLabel(value: number, type: BillingIntervalType): string {
  if (value === 1 && type === 'month') {
    return $localize`:@@featureBilling-intervalMonthly:Monthly`;
  }

  if (value === 1 && type === 'day') {
    return $localize`:@@featureBilling-intervalDaily:Daily`;
  }

  if (value === 1 && type === 'hour') {
    return $localize`:@@featureBilling-intervalHourly:Hourly`;
  }

  if (type === 'hour') {
    return $localize`:@@featureBilling-intervalEveryHours:Every ${value} hours`;
  }

  if (type === 'day') {
    return $localize`:@@featureBilling-intervalEveryDays:Every ${value} days`;
  }

  return $localize`:@@featureBilling-intervalEveryMonths:Every ${value} months`;
}

export function getProviderDisplayName(
  providerId: string | null | undefined,
  providers: ProviderDetail[] | null | undefined,
): string {
  if (!providerId?.trim()) {
    return getUnavailableLabel();
  }

  const provider = providers?.find((item) => item.id === providerId);

  return provider?.displayName?.trim() || getUnavailableLabel();
}

export { getCountryDisplayName };
