/**
 * Decabill action center item types. The billing console presents each type (texts, icon, deep link); keep both in
 * sync (`libs/domains/decabill/frontend/feature-billing-console/src/lib/action-center`).
 */
export const DECABILL_ACTION_TYPES = {
  // setup / onboarding (highlighted)
  setupIssuer: 'decabill.setup.issuer',
  setupIssuerDetails: 'decabill.setup.issuer_details',
  setupAccounting: 'decabill.setup.accounting',
  setupDatev: 'decabill.setup.datev',
  setupFirstCustomer: 'decabill.setup.first_customer',
  // receivables
  invoicesUnsent: 'decabill.invoices.unsent',
  creditNotesUnsent: 'decabill.invoices.credit_note_unsent',
  invoicesDraft: 'decabill.invoices.draft',
  invoicesOverdue: 'decabill.invoices.overdue',
  invoicesAutoPaymentExhausted: 'decabill.invoices.auto_payment_exhausted',
  // offers
  offersDraft: 'decabill.offers.draft',
  offersUnsent: 'decabill.offers.unsent',
  offersExpiring: 'decabill.offers.expiring',
  offersFulfillmentFailed: 'decabill.offers.fulfillment_failed',
  // payables
  supplierInvoicesDraft: 'decabill.payables.draft',
  supplierInvoicesDue: 'decabill.payables.due',
  supplierInvoicesMissingDocument: 'decabill.payables.missing_document',
  // customers / suppliers
  customersIncomplete: 'decabill.customers.incomplete',
  customersVatInvalid: 'decabill.customers.vat_invalid',
  suppliersIncomplete: 'decabill.suppliers.incomplete',
  // subscriptions / provisioning
  provisioningFailed: 'decabill.subscriptions.provisioning_failed',
  addonsFailed: 'decabill.subscriptions.addon_failed',
  configChangesFailed: 'decabill.subscriptions.config_change_failed',
  backordersFailed: 'decabill.subscriptions.backorder_failed',
  // inventory
  withdrawalRequestsPending: 'decabill.inventory.withdrawal_pending',
  lendingsOverdue: 'decabill.inventory.lending_overdue',
  articlesLowStock: 'decabill.inventory.low_stock',
  // accounting (only with BILLING_ACCOUNTING_ENABLED)
  accountingUnbooked: 'decabill.accounting.unbooked_documents',
  accountingPostingIssues: 'decabill.accounting.posting_issues',
  accountingBankUnmatched: 'decabill.accounting.bank_unmatched',
  accountingBankSuggested: 'decabill.accounting.bank_suggested',
  accountingBankImportFailed: 'decabill.accounting.bank_import_failed',
  accountingVatReturnsDue: 'decabill.accounting.vat_return_due',
  // delivery (spooler, postal letters)
  spoolJobsFailed: 'decabill.spooler.failed',
  lettersAttention: 'decabill.letters.attention',
  // DATEV (only with BILLING_DATEV_EXPORT_ENABLED)
  datevExportFailed: 'decabill.datev.export_failed',
} as const;

export type DecabillActionType = (typeof DECABILL_ACTION_TYPES)[keyof typeof DECABILL_ACTION_TYPES];

/** Display name of a customer / supplier profile (company, else first + last name). */
export const PROFILE_DISPLAY_NAME_SQL = (alias: string) =>
  `COALESCE(NULLIF(TRIM(${alias}.company), ''), NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)), ''))`;

/** Profile fields required for invoicing (see `CustomerProfilesService.isProfileComplete`). */
export const PROFILE_INCOMPLETE_SQL = (alias: string) =>
  ['first_name', 'last_name', 'email', 'address_line_1', 'postal_code', 'city', 'country']
    .map((column) => `COALESCE(TRIM(${alias}.${column}), '') = ''`)
    .join(' OR ');
