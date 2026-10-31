/** Labels of the shared `fpc-multi-select` in Decabill forms (DB-08 a). */
export const BILLING_MULTI_SELECT_LABELS = {
  search: $localize`:@@featureBillingMultiSelect-search:Search options`,
  /** `{label}` = the option label (filled by the component). */
  remove: $localize`:@@featureBillingMultiSelect-remove:Remove {label}`,
  empty: $localize`:@@featureBillingMultiSelect-empty:No matches`,
} as const;
