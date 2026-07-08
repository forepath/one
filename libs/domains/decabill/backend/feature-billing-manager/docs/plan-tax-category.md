# Per-plan tax category

Service plans store a `taxCategory` (`standard` or `reduced`) that drives VAT on all **automated subscription** flows.

## Semantics

- **Timing:** Calculations use the plan's **current** `taxCategory` at invoice, preview, refund, and export time. There is no subscription snapshot.
- **Default:** Existing and new plans default to `standard` when omitted.
- **Manual invoices:** Per-line tax on admin-created invoices is unchanged and independent of plan settings.
- **Project billing:** Time-based default lines remain `standard` unless admins add custom lines.

## Affected flows

| Flow                                           | Tax source                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Subscription invoices                          | `resolvePlanTaxCategory(plan)`                                   |
| Pricing preview (`POST /pricing/preview`)      | Plan tax category                                                |
| `periodTotalPrice` on subscriptions/backorders | Plan tax category                                                |
| Withdrawal partial refunds                     | Plan tax category at withdrawal                                  |
| Partial credit PDFs                            | Plan tax category                                                |
| Public offerings (`totalGross`, `taxRate`)     | Plan tax category                                                |
| DATEV Buchungsstapel (invoice lines)           | Persisted line `taxCategory` from invoice creation               |
| DATEV Buchungsstapel (partial credits)         | Snapshotted `tax_category` on `billing_invoice_credit_documents` |

## Admin configuration

On the service plans page, choose **Standard (19%)** or **Reduced (7%)** when creating or editing a plan. Estimated prices in the modal show net + VAT + gross.

## DATEV export

Invoice booking rows already map `line.taxCategory` to revenue accounts (`8400`/`8300` SKR03 defaults). Partial withdrawal credits are exported as separate `H` rows using the snapshotted credit document `taxCategory`.

Operators using reduced plans should confirm `BILLING_DATEV_REVENUE_ACCOUNT_REDUCED` and `BILLING_DATEV_BU_KEY_REDUCED` match their chart of accounts.

## Plan tax change mid-subscription

If an admin changes a plan's tax category, the next invoice, preview, or withdrawal refund uses the updated category. Previously issued invoice lines and void reversals keep their original stored tax.
