/**
 * Maps billing-manager API status strings to localized, human-readable labels.
 * Values align with SubscriptionStatus and BackorderStatus in feature-billing-manager.
 */

import type { BillingIntervalType, ProviderDetail } from '@forepath/decabill/frontend/data-access-billing-console';

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

export function getProfileCompleteTextClass(isComplete: boolean): string {
  return isComplete ? 'text-success' : 'text-warning';
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
