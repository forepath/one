# Per-plan tax category

Service plans store a `taxCategory` (`standard` or `reduced`) that drives the **rate class** on automated subscription lines.

Place-of-supply / reverse charge / OSS is determined separately by **tax mode** (see `docs/decabill/features/vat-and-tax-treatment.md`). Category chooses standard vs reduced **within** the tax country selected by tax mode.

## Semantics

- **Timing:** Calculations use the plan's **current** `taxCategory` at invoice, preview, refund, and export time. There is no subscription snapshot.
- **Default:** Existing and new plans default to `standard` when omitted.
- **Manual invoices:** Per-line tax on admin-created invoices is unchanged and independent of plan settings.
- **Project billing:** Time-based default lines remain `standard` unless admins add custom lines.
- **Country rates:** Resolved from `eu-vat-rates.constants.ts` for the tax country (not only DE 19/7 env vars).

## Affected flows

| Flow                                           | Tax source                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Subscription invoices                          | Plan category + customer/issuer tax mode                         |
| Pricing preview (`POST /pricing/preview`)      | Plan tax category (+ tax mode when customer context available)   |
| `periodTotalPrice` on subscriptions/backorders | Plan tax category                                                |
| Withdrawal partial refunds                     | Plan tax category at withdrawal                                  |
| Partial credit PDFs                            | Plan tax category                                                |
| Public offerings (`totalGross`, `taxRate`)     | Plan tax category                                                |
| DATEV Buchungsstapel (invoice lines)           | Persisted line + invoice `taxMode`                               |
| DATEV Buchungsstapel (partial credits)         | Snapshotted `tax_category` on `billing_invoice_credit_documents` |

## Admin configuration

On the service plans page, choose **Standard** or **Reduced** when creating or editing a plan. UI labels may still show example rates; actual percentages come from the country rate table / env overrides.

## DATEV export

Booking rows map by **`taxMode` + `taxCategory`** to revenue accounts (including reverse-charge / OSS / third-country accounts). See environment configuration for `BILLING_DATEV_REVENUE_ACCOUNT_*` keys.

## Plan tax change mid-subscription

If an admin changes a plan's tax category, the next invoice, preview, or withdrawal refund uses the updated category. Previously issued invoice lines and void reversals keep their original stored tax.
