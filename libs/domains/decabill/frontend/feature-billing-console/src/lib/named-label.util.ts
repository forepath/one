/**
 * Human-facing display labels that never fall back to raw UUIDs/ids.
 */

export function getUnavailableLabel(): string {
  return $localize`:@@featureBilling-notAvailable:N/A`;
}

/**
 * Resolve a human-facing label from optional name candidates.
 * Prefer denormalized API names first; use catalog names when available; otherwise N/A.
 */
export function resolveNamedLabel(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  return getUnavailableLabel();
}

/** Row of an admin list with a customer: billing-profile name and login email (DB-18). */
export interface CustomerLabelSource {
  customerName?: string | null;
  userEmail?: string | null;
}

/** Customer column text: the billing-profile name, else the login email, else "Unavailable". */
export function getCustomerLabel(row: CustomerLabelSource | null | undefined): string {
  return row?.customerName?.trim() || row?.userEmail?.trim() || getUnavailableLabel();
}

/** Login email as secondary information (tooltip) when the name is shown; `null` when the email is the label. */
export function getCustomerSecondaryLabel(row: CustomerLabelSource | null | undefined): string | null {
  const email = row?.userEmail?.trim();

  return row?.customerName?.trim() && email ? email : null;
}

/** Title of an offer without a number yet (DB-18): no status word, which the state column already shows. */
export function getUnnumberedOfferLabel(): string {
  return $localize`:@@featureBilling-unnumberedOffer:Draft offer`;
}

/** Title of an invoice without a number yet (DB-18). */
export function getUnnumberedInvoiceLabel(): string {
  return $localize`:@@featureBilling-unnumberedInvoice:Draft invoice`;
}
