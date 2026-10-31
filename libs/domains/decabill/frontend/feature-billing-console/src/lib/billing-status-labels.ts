import type {
  BillingIntervalType,
  MeterAggregator,
  PromotionRedemptionContext,
  PromotionRedemptionStatus,
  ProviderDetail,
} from '@forepath/decabill/frontend/data-access-billing-console';

import { getCountryDisplayName } from './billing-country-options';
import { formatBillingMoney } from './billing-format';
import { getUnavailableLabel } from './named-label.util';
import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';

export { getUnavailableLabel, resolveNamedLabel } from './named-label.util';

/**
 * Maps billing-manager API status strings to localized, human-readable labels.
 * Values align with SubscriptionStatus and BackorderStatus in feature-billing-manager.
 */

export function getMeterAggregatorLabel(aggregator: MeterAggregator | string | null | undefined): string {
  if (aggregator == null || aggregator === '') {
    return getUnavailableLabel();
  }

  switch (aggregator) {
    case 'max':
      return $localize`:@@featureMeters-aggregatorMax:Max`;
    case 'min':
      return $localize`:@@featureMeters-aggregatorMin:Min`;
    case 'avg':
      return $localize`:@@featureMeters-aggregatorAvg:Average`;
    case 'first':
      return $localize`:@@featureMeters-aggregatorFirst:First`;
    case 'last':
      return $localize`:@@featureMeters-aggregatorLast:Last`;
    case 'sum':
      return $localize`:@@featureMeters-aggregatorSum:Sum`;
    case 'sum_positive_deltas':
      return $localize`:@@featureMeters-aggregatorSumPositiveDeltas:Sum of positive deltas`;
    default:
      return String(aggregator);
  }
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
    case 'pending_instant_cancel':
      return $localize`:@@featureBilling-subscriptionStatusPendingInstantCancel:Pending instant cancel`;
    case 'pending_config_change':
      return $localize`:@@featureBilling-subscriptionStatusPendingConfigChange:Applying configuration change`;
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
    case 'removing':
      return $localize`:@@featureBilling-provisioningStatusRemoving:Removing`;
    case 'removed':
      return $localize`:@@featureBilling-provisioningStatusRemoved:Removed`;
    default:
      return $localize`:@@featureBilling-provisioningStatusUnknown:Unknown (${status})`;
  }
}

/** Status chip modifier paired with `fpc-badge variant="info"`. */
export function getProvisioningStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
  switch (status) {
    case 'pending':
      return 'info';
    case 'active':
      return 'success';
    case 'failed':
      return 'danger';
    case 'removing':
      return 'info';
    case 'removed':
      return 'neutral';
    default:
      return 'neutral';
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

/** Status chip modifier paired with `fpc-badge variant="info"`. */
export function getSubscriptionStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'pending_cancel':
      return 'info';
    case 'pending_withdrawal':
      return 'info';
    case 'pending_instant_cancel':
      return 'danger';
    case 'pending_config_change':
      return 'primary';
    case 'pending_backorder':
      return 'primary';
    case 'canceled':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function getBackorderStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
  switch (status) {
    case 'pending':
      return 'primary';
    case 'retrying':
      return 'info';
    case 'fulfilled':
      return 'success';
    case 'cancelled':
      return 'neutral';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function getInvoiceStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
  switch (status) {
    case 'draft':
      return 'neutral';
    case 'issued':
      return 'primary';
    case 'partially_paid':
      return 'info';
    case 'paid':
      return 'success';
    case 'overdue':
      return 'danger';
    case 'void':
      return 'neutral';
    default:
      return 'neutral';
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

/** Project hourly rate (DB-03): the one money format + "/ h" (`€110.00 / h`). */
export function formatProjectHourlyRate(amount: number, currency: string): string {
  return `${formatBillingMoney(Number.isFinite(amount) ? amount : 0, currency)} / h`;
}

/** Project open billable amount (DB-03): the one money format (`€1,210.00`). */
export function formatProjectOpenBillableAmount(amount: number, currency: string): string {
  return formatBillingMoney(Number.isFinite(amount) ? amount : 0, currency);
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

export function getDatevExportStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
  switch (status) {
    case 'pending':
      return 'neutral';
    case 'running':
      return 'info';
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
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

  if (value === 1 && type === 'year') {
    return $localize`:@@featureBilling-intervalYearly:Yearly`;
  }

  if (type === 'hour') {
    return $localize`:@@featureBilling-intervalEveryHours:Every ${value} hours`;
  }

  if (type === 'day') {
    return $localize`:@@featureBilling-intervalEveryDays:Every ${value} days`;
  }

  if (type === 'year') {
    return $localize`:@@featureBilling-intervalEveryYears:Every ${value} years`;
  }

  return $localize`:@@featureBilling-intervalEveryMonths:Every ${value} months`;
}

/** Unit label for the plan's "Interval type" select (DB-08 b): never the raw enum. */
export function getBillingIntervalTypeLabel(type: BillingIntervalType | string | null | undefined): string {
  switch (type) {
    case 'hour':
      return $localize`:@@featureBilling-intervalTypeHour:Hours`;
    case 'day':
      return $localize`:@@featureBilling-intervalTypeDay:Days`;
    case 'month':
      return $localize`:@@featureBilling-intervalTypeMonth:Months`;
    case 'year':
      return $localize`:@@featureBilling-intervalTypeYear:Years`;
    default:
      return type ?? '';
  }
}

/** A duration with a real plural form: "1 month", "3 months" (DB-04 / DB-27; replaces "1 month(s)"). */
export function getBillingIntervalDurationLabel(value: number, type: BillingIntervalType | string): string {
  const one = value === 1;

  switch (type) {
    case 'hour':
      return one
        ? $localize`:@@featureBilling-durationHourOne:1 hour`
        : $localize`:@@featureBilling-durationHours:${value}:count: hours`;
    case 'day':
      return one
        ? $localize`:@@featureBilling-durationDayOne:1 day`
        : $localize`:@@featureBilling-durationDays:${value}:count: days`;
    case 'year':
      return one
        ? $localize`:@@featureBilling-durationYearOne:1 year`
        : $localize`:@@featureBilling-durationYears:${value}:count: years`;
    default:
      return one
        ? $localize`:@@featureBilling-durationMonthOne:1 month`
        : $localize`:@@featureBilling-durationMonths:${value}:count: months`;
  }
}

/** "14 days free", "1 billing period free" (DB-27): plural forms instead of "day(s)". */
export function getPromotionFreeDaysLabel(days: number): string {
  return days === 1
    ? $localize`:@@featureBilling-promotionFreeDayOne:1 day free`
    : $localize`:@@featureBilling-promotionFreeDays:${days}:count: days free`;
}

/** Fixed-amount promotion credit (DB-03): the one money format, `€5.00 credit`. */
export function getPromotionCreditLabel(amountNet: number, currency?: string | null): string {
  const amount = formatBillingMoney(amountNet, currency);

  return $localize`:@@featureBilling-promotionCredit:${amount}:amount: credit`;
}

export function getPromotionFreePeriodsLabel(periods: number): string {
  return periods === 1
    ? $localize`:@@featureBilling-promotionFreePeriodOne:1 billing period free`
    : $localize`:@@featureBilling-promotionFreePeriods:${periods}:count: billing periods free`;
}

/**
 * Localized advantage text for a promotion check / redemption; falls back to the server summary
 * when the numbers are not part of the response.
 */
export function getPromotionAdvantageText(promotion: {
  advantageType?: string | null;
  advantageSummary?: string | null;
  amountNet?: number | null;
  currency?: string | null;
  days?: number | null;
  periods?: number | null;
}): string {
  if (promotion.advantageType === 'fixed_amount_net' && promotion.amountNet != null) {
    return getPromotionCreditLabel(Number(promotion.amountNet), promotion.currency);
  }

  if (promotion.advantageType === 'free_days' && promotion.days != null) {
    return getPromotionFreeDaysLabel(Number(promotion.days));
  }

  if (promotion.advantageType === 'free_billing_periods' && promotion.periods != null) {
    return getPromotionFreePeriodsLabel(Number(promotion.periods));
  }

  return promotion.advantageSummary ?? '';
}

/**
 * The one subscription price cell (DB-19), customer and admin: `€5.95 / Monthly`; postpaid rows without a period
 * price but with usage meters read "Usage-based"; otherwise `-`. `formatAmount` formats the money part.
 */
export function formatSubscriptionPriceCell(
  totalPrice: number | null | undefined,
  interval: { value?: number | null; type?: BillingIntervalType | string | null } | null,
  hasUsageMeters: boolean,
  formatAmount: (amount: number) => string,
): string {
  if (totalPrice == null || !Number.isFinite(totalPrice)) {
    return hasUsageMeters ? $localize`:@@featureBilling-priceUsageBased:Usage-based` : '-';
  }

  const price = formatAmount(totalPrice);

  if (!interval?.type || interval.value == null) {
    return price;
  }

  return `${price} / ${getBillingIntervalLabel(interval.value, interval.type as BillingIntervalType)}`;
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

export function getOfferStatusLabel(status: string | null | undefined): string {
  if (status == null || status === '') {
    return $localize`:@@featureBilling-offerStatusEmpty:Unknown`;
  }

  switch (status) {
    case 'draft':
      return $localize`:@@featureOffers-statusDraft:Draft`;
    case 'archived':
      return $localize`:@@featureOffers-statusArchived:Pending response`;
    case 'accepted':
      return $localize`:@@featureOffers-statusAccepted:Accepted`;
    case 'declined':
      return $localize`:@@featureOffers-statusDeclined:Declined`;
    case 'expired':
      return $localize`:@@featureOffers-statusExpired:Expired`;
    case 'revoked':
      return $localize`:@@featureOffers-statusRevoked:Revoked`;
    default:
      return $localize`:@@featureBilling-offerStatusUnknown:Unknown (${status})`;
  }
}

/** Status chip modifier paired with `fpc-badge variant="info"`. */
export function getOfferStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
  switch (status) {
    case 'draft':
      return 'neutral';
    case 'archived':
      return 'primary';
    case 'accepted':
      return 'success';
    case 'declined':
      return 'neutral';
    case 'expired':
      return 'danger';
    case 'revoked':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function canCustomerRespondToOffer(status: string | null | undefined): boolean {
  return status === 'archived';
}

export { getCountryDisplayName };
