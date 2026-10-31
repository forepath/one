import type { FpcTableState } from '@forepath/shared/frontend/ui-components';

import {
  getActiveStatusLabel,
  getBackorderStatusBadgeTone,
  getBackorderStatusLabel,
  getCustomerTrustLevelLabel,
  getInvoiceStatusBadgeTone,
  getInvoiceStatusLabel,
  getOfferStatusBadgeTone,
  getOfferStatusLabel,
  getProfileCompleteLabel,
  getPromotionRedemptionStatusLabel,
  getProjectStatusLabel,
  getProjectTimeEntryBillingStatusLabel,
  getProvisioningStatusBadgeTone,
  getProvisioningStatusLabel,
  getSubscriptionStatusBadgeTone,
  getSubscriptionStatusLabel,
} from '../billing-status-labels';

/** State-column values (icon + tone + readable label) of the Decabill tables. */
export function subscriptionState(status: string | null | undefined): FpcTableState {
  const icons: Record<string, string> = {
    active: 'check-circle-fill',
    pending_backorder: 'hourglass-split',
    pending_cancel: 'calendar-x',
    pending_withdrawal: 'arrow-counterclockwise',
    pending_instant_cancel: 'x-octagon-fill',
    pending_config_change: 'arrow-repeat',
    canceled: 'slash-circle',
  };

  return {
    label: getSubscriptionStatusLabel(status),
    tone: getSubscriptionStatusBadgeTone(status),
    icon: icons[status ?? ''],
  };
}

export function invoiceState(status: string | null | undefined): FpcTableState {
  const icons: Record<string, string> = {
    draft: 'pencil-square',
    issued: 'send',
    partially_paid: 'pie-chart',
    paid: 'check-circle-fill',
    overdue: 'exclamation-octagon-fill',
    void: 'slash-circle',
  };

  return { label: getInvoiceStatusLabel(status), tone: getInvoiceStatusBadgeTone(status), icon: icons[status ?? ''] };
}

export function projectState(status: string | null | undefined): FpcTableState {
  return status === 'active'
    ? { label: getProjectStatusLabel(status), tone: 'success', icon: 'check-circle-fill' }
    : status === 'archived'
      ? { label: getProjectStatusLabel(status), tone: 'neutral', icon: 'archive' }
      : { label: getProjectStatusLabel(status), tone: 'neutral' };
}

export function timeEntryBillingState(isBilled: boolean): FpcTableState {
  return isBilled
    ? { label: getProjectTimeEntryBillingStatusLabel(true), tone: 'success', icon: 'receipt' }
    : { label: getProjectTimeEntryBillingStatusLabel(false), tone: 'neutral', icon: 'receipt-cutoff' };
}

export function provisioningState(status: string | null | undefined): FpcTableState {
  return { label: getProvisioningStatusLabel(status), tone: getProvisioningStatusBadgeTone(status) };
}

export function backorderState(status: string | null | undefined): FpcTableState {
  return { label: getBackorderStatusLabel(status), tone: getBackorderStatusBadgeTone(status) };
}

/** Catalog entries (meters, add-ons, plans, service types, …) that can be switched on / off. */
export function activeState(isActive: boolean): FpcTableState {
  return isActive
    ? { label: getActiveStatusLabel(true), tone: 'success', icon: 'check-circle-fill' }
    : { label: getActiveStatusLabel(false), tone: 'neutral', icon: 'pause-circle' };
}

/** Customer trust traffic light (green / yellow / red; unscored = neutral). */
export function trustState(level: string | null | undefined): FpcTableState {
  const label = getCustomerTrustLevelLabel(level);

  switch (level) {
    case 'green':
      return { label, tone: 'success', icon: 'shield-check' };
    case 'yellow':
      return { label, tone: 'warning', icon: 'shield-exclamation' };
    case 'red':
      return { label, tone: 'danger', icon: 'shield-x' };
    default:
      return { label, tone: 'neutral', icon: 'shield' };
  }
}

/** Billing / supplier profile completeness. */
export function profileCompleteState(isComplete: boolean): FpcTableState {
  return isComplete
    ? { label: getProfileCompleteLabel(true), tone: 'success', icon: 'check-circle-fill' }
    : { label: getProfileCompleteLabel(false), tone: 'warning', icon: 'clock' };
}

/** Promotion redemption state (active / exhausted / expired / cancelled). */
export function redemptionState(status: string | null | undefined): FpcTableState {
  const label = getPromotionRedemptionStatusLabel(status);

  switch (status) {
    case 'active':
      return { label, tone: 'success', icon: 'check-circle-fill' };
    case 'exhausted':
      return { label, tone: 'neutral', icon: 'check-all' };
    case 'expired':
      return { label, tone: 'warning', icon: 'clock-history' };
    case 'cancelled':
      return { label, tone: 'neutral', icon: 'x-circle' };
    default:
      return { label, tone: 'neutral' };
  }
}

/** Offer state (draft / pending response / accepted / declined / expired / revoked). */
export function offerState(status: string | null | undefined): FpcTableState {
  const icons: Record<string, string> = {
    draft: 'pencil-square',
    archived: 'hourglass-split',
    accepted: 'check-circle-fill',
    declined: 'x-circle',
    expired: 'calendar-x',
    revoked: 'slash-circle',
  };

  return { label: getOfferStatusLabel(status), tone: getOfferStatusBadgeTone(status), icon: icons[status ?? ''] };
}
