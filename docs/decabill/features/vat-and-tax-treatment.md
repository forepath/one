# VAT and tax treatment

Decabill determines invoice VAT using explicit **tax modes** plus per-country EU rate tables. Product **tax categories** (`standard` / `reduced`) remain the rate class on plans and lines; they are not place-of-supply logic.

## Tax modes

- `domestic_vat`
- `eu_reverse_charge`
- `eu_b2c_oss`
- `third_country_b2b_no_vat`
- `third_country_b2c_no_domestic_vat`
- `non_eu_issuer_eu_b2b`
- `non_eu_issuer_eu_b2c`

Decision order: issuer in EU → same country → customer in EU → business/consumer → VAT ID validity → mode → rates and invoice notes.

Authenticated pricing preview, subscription/backorder period totals, invoice drafts, and refunds resolve tax via the customer’s profile. Public catalogue offerings and admin catalogue estimates use issuer domestic VAT from the same treatment resolver until checkout. Admin manual-invoice and project bill-time UIs load rates from `POST /admin/billing/tax/preview` (per customer when known).

Reverse charge requires **all** of: business customer, non-empty VAT ID, `vatIdValidationStatus === valid`. A VAT ID alone never triggers reverse charge.

`non_eu_issuer_eu_b2b` is a separate mode from EU reverse charge (default no domestic VAT; optional charge via `BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT`).

## Customer tax fields

Stored on `billing_customer_profiles`:

- `customerType` (`business` | `consumer`)
- `vatId`
- `vatIdValidationStatus` (`none` | `pending` | `valid` | `invalid` | `unavailable`)
- `vatIdValidatedAt`
- `vatIdValidationSource`

## VIES validation

1. Sync VIES on profile save / revalidate when the public VIES REST API is reachable.
2. On transient failure while reachable: status `pending` and async BullMQ job.
3. If VIES is unreachable: format-only + admin `mark-validated` (`POST /admin/billing/customer-profiles/{id}/vat-id/mark-validated`).

Self-service revalidate: `POST /customer-profile/vat-id/revalidate`.

## OSS €10,000 threshold

Cross-border EU B2C (non–reverse-charge) net totals are tracked per tenant/year. Below threshold → home-country VAT; at/above → destination rates (`eu_b2c_oss`).

`BILLING_OSS_REGISTERED=true` forces destination rates without waiting for the ledger.

## Country rates

EU rates live in `eu-vat-rates.constants.ts` (Your Europe snapshot; see file header). Non-EU countries have no rate rows. Issuer env `BILLING_TAX_RATE_*` only overrides the issuer country / legacy bridge.

## Invoice snapshot

Issued invoices store `taxMode`, `taxCountryCode`, `taxNote`, `einvoiceTaxCategoryCode`, `resolvedTaxRate`, and buyer/issuer tax fields so PDF, eInvoice, and DATEV stay stable if rate tables change later.

## Related

- [Customer Profiles](./customer-profiles.md)
- [Invoices](./invoices.md)
- [Webhooks](./webhooks.md)
- [Environment configuration](../deployment/environment-configuration.md)
