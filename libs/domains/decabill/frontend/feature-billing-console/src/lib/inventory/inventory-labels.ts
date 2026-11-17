import type {
  InventoryBorrowerKind,
  InventoryLabelKind,
  InventoryLending,
  InventoryMovementReason,
  InventoryMovementType,
  InventorySerialUnitStatus,
  InventoryWithdrawalRequestSource,
  InventoryWithdrawalRequestStatus,
} from '@forepath/decabill/frontend/data-access-billing-console';
import type { FpcTableState } from '@forepath/shared/frontend/ui-components';

import { billingLocale, formatBillingMoney } from '../billing-format';

export const INVENTORY_UNIT_LABELS: Record<string, string> = {
  piece: $localize`:@@featureInventory-unitPiece:pcs`,
  pack: $localize`:@@featureInventory-unitPack:pack`,
  box: $localize`:@@featureInventory-unitBox:box`,
  pallet: $localize`:@@featureInventory-unitPallet:pallet`,
  set: $localize`:@@featureInventory-unitSet:set`,
  kg: 'kg',
  g: 'g',
  l: 'l',
  ml: 'ml',
  m: 'm',
  m2: 'm²',
  m3: 'm³',
};

export const INVENTORY_MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  putaway: $localize`:@@featureInventory-typePutaway:Putaway`,
  transfer: $localize`:@@featureInventory-typeTransfer:Transfer`,
  withdrawal: $localize`:@@featureInventory-typeWithdrawal:Withdrawal`,
  lending: $localize`:@@featureInventory-typeLending:Lending`,
  lending_return: $localize`:@@featureInventory-typeLendingReturn:Lending return`,
};

export const INVENTORY_SERIAL_STATUS_LABELS: Record<InventorySerialUnitStatus, string> = {
  in_stock: $localize`:@@featureInventory-serialInStock:In stock`,
  lent: $localize`:@@featureInventory-serialLent:On loan`,
  withdrawn: $localize`:@@featureInventory-serialWithdrawn:Withdrawn`,
};

export const INVENTORY_BORROWER_KIND_LABELS: Record<InventoryBorrowerKind, string> = {
  customer: $localize`:@@featureInventory-borrowerCustomer:Customer`,
  staff: $localize`:@@featureInventory-borrowerStaff:Staff`,
};

export const INVENTORY_LABEL_KIND_LABELS: Record<InventoryLabelKind, string> = {
  article_number: $localize`:@@featureInventory-labelArticleNumber:Article number`,
  ean: 'EAN',
  property: $localize`:@@featureInventory-labelProperty:Property sticker`,
};

export const INVENTORY_REASON_LABELS: Record<InventoryMovementReason, string> = {
  receipt: $localize`:@@featureInventory-reasonReceipt:Goods receipt`,
  return: $localize`:@@featureInventory-reasonReturn:Return`,
  fulfillment: $localize`:@@featureInventory-reasonFulfillment:Fulfilment`,
  consumption: $localize`:@@featureInventory-reasonConsumption:Consumption`,
  damage: $localize`:@@featureInventory-reasonDamage:Damage`,
  loss: $localize`:@@featureInventory-reasonLoss:Loss`,
  correction: $localize`:@@featureInventory-reasonCorrection:Stock correction`,
  other: $localize`:@@featureInventory-reasonOther:Other`,
};

export const INVENTORY_REQUEST_STATUS_LABELS: Record<InventoryWithdrawalRequestStatus, string> = {
  pending: $localize`:@@featureInventory-requestPending:Pending`,
  accepted: $localize`:@@featureInventory-requestAccepted:Accepted`,
  rejected: $localize`:@@featureInventory-requestRejected:Rejected`,
};

export const INVENTORY_REQUEST_SOURCE_LABELS: Record<InventoryWithdrawalRequestSource, string> = {
  offer: $localize`:@@featureInventory-sourceOffer:Offer`,
  invoice: $localize`:@@featureInventory-sourceInvoice:Invoice`,
  subscription: $localize`:@@featureInventory-sourceSubscription:Subscription`,
};

export function inventoryUnitLabel(unit: string | null | undefined): string {
  return INVENTORY_UNIT_LABELS[unit ?? ''] ?? unit ?? '';
}

/** Quantity with up to three decimals in the app locale plus the unit (`1,250.5 kg`). */
export function formatInventoryQuantity(value: number | null | undefined, unit?: string | null): string {
  const number = new Intl.NumberFormat(billingLocale(), { maximumFractionDigits: 3 }).format(Number(value ?? 0));

  return unit ? `${number} ${inventoryUnitLabel(unit)}` : number;
}

export function formatInventoryPrice(value: number | null | undefined, currency: string): string {
  return value === null || value === undefined ? '—' : formatBillingMoney(value, currency);
}

export function inventoryActiveState(isActive: boolean): FpcTableState {
  return isActive
    ? { label: $localize`:@@featureInventory-active:Active`, tone: 'success', icon: 'check-circle-fill' }
    : { label: $localize`:@@featureInventory-inactive:Inactive`, tone: 'neutral', icon: 'pause-circle' };
}

/** Article stock state: empty / low (at or below reorder point) / in stock. */
export function inventoryStockState(quantity: number, reorderPoint: number | null | undefined): FpcTableState {
  if (quantity <= 0) {
    return { label: $localize`:@@featureInventory-stockEmpty:No stock`, tone: 'neutral', icon: 'circle' };
  }

  if (reorderPoint !== null && reorderPoint !== undefined && quantity <= reorderPoint) {
    return {
      label: $localize`:@@featureInventory-stockLow:Low stock`,
      tone: 'warning',
      icon: 'exclamation-triangle-fill',
    };
  }

  return { label: $localize`:@@featureInventory-stockOk:In stock`, tone: 'success', icon: 'check-circle-fill' };
}

export function inventoryRequestState(status: InventoryWithdrawalRequestStatus): FpcTableState {
  switch (status) {
    case 'pending':
      return { label: INVENTORY_REQUEST_STATUS_LABELS.pending, tone: 'warning', icon: 'hourglass-split' };
    case 'accepted':
      return { label: INVENTORY_REQUEST_STATUS_LABELS.accepted, tone: 'success', icon: 'check-circle-fill' };
    default:
      return { label: INVENTORY_REQUEST_STATUS_LABELS.rejected, tone: 'neutral', icon: 'x-circle' };
  }
}

export function inventoryMovementState(type: InventoryMovementType): FpcTableState {
  switch (type) {
    case 'putaway':
      return { label: INVENTORY_MOVEMENT_TYPE_LABELS.putaway, tone: 'success', icon: 'box-arrow-in-down' };
    case 'transfer':
      return { label: INVENTORY_MOVEMENT_TYPE_LABELS.transfer, tone: 'info', icon: 'arrow-left-right' };
    case 'lending':
      return { label: INVENTORY_MOVEMENT_TYPE_LABELS.lending, tone: 'warning', icon: 'person-up' };
    case 'lending_return':
      return { label: INVENTORY_MOVEMENT_TYPE_LABELS.lending_return, tone: 'success', icon: 'person-down' };
    default:
      return { label: INVENTORY_MOVEMENT_TYPE_LABELS.withdrawal, tone: 'neutral', icon: 'box-arrow-up' };
  }
}

export function inventorySerialState(status: InventorySerialUnitStatus): FpcTableState {
  switch (status) {
    case 'in_stock':
      return { label: INVENTORY_SERIAL_STATUS_LABELS.in_stock, tone: 'success', icon: 'check-circle-fill' };
    case 'lent':
      return { label: INVENTORY_SERIAL_STATUS_LABELS.lent, tone: 'warning', icon: 'person-up' };
    default:
      return { label: INVENTORY_SERIAL_STATUS_LABELS.withdrawn, tone: 'neutral', icon: 'box-arrow-up' };
  }
}

export function inventoryLendingState(lending: Pick<InventoryLending, 'status' | 'overdue'>): FpcTableState {
  if (lending.status === 'returned') {
    return { label: $localize`:@@featureInventory-lendingReturned:Returned`, tone: 'neutral', icon: 'check-circle' };
  }

  return lending.overdue
    ? { label: $localize`:@@featureInventory-lendingOverdue:Overdue`, tone: 'danger', icon: 'exclamation-octagon-fill' }
    : { label: $localize`:@@featureInventory-lendingOpen:On loan`, tone: 'warning', icon: 'person-up' };
}

/** Browser download of a fetched blob (movement documents). */
export function saveInventoryBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
