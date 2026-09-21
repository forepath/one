# Numbering

How Decabill assigns invoice, subscription, customer, supplier, and DATEV debtor/creditor numbers across tenants.

## Overview

Assigned business numbers use a configurable pool mode controlled by **`TENANTS_SHARED_NUMBERS`**:

| Mode             | Env                                            | Behavior                                                                    |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| Shared (default) | unset, `true`, or any value other than `false` | One global pool. The same literal cannot be issued twice in the deployment. |
| Tenant-scoped    | `TENANTS_SHARED_NUMBERS=false`                 | Separate pool per tenant. The same literal may exist in different tenants.  |

Credit notes and void documents derive their document numbers from the invoice number (for example `INV-2026-00001-CN`) and therefore inherit the invoice pool’s scoping.

**Out of scope:** reserved hostnames remain globally unique regardless of this flag.

## Formats

| Kind           | Format                | Notes                                                                               |
| -------------- | --------------------- | ----------------------------------------------------------------------------------- |
| Invoice        | `INV-{year}-{nnnnn}`  | Yearly counter; five-digit pad                                                      |
| Subscription   | `SUB-{nnnnnn}`        | Six-digit pad; used in public withdrawal                                            |
| Customer       | `CUS-{nnnnnn}`        | Six-digit pad; allocated once on billing profile create                             |
| Supplier       | `SUP-{nnnnnn}`        | Six-digit pad; allocated once on supplier profile create                            |
| Supplier inv   | `SINV-{year}-{nnnnn}` | Yearly counter; five-digit pad; allocated at issue                                  |
| Offer          | `OFF-{year}-{nnnnn}`  | Yearly counter; five-digit pad; allocated at archive (see [Offers](./offers.md))    |
| DATEV debtor   | integer               | Allocated within tenant DATEV range (`debtorAccountStart`–`debtorAccountEnd`)       |
| DATEV creditor | integer               | Allocated within (`creditorAccountStart`–`creditorAccountEnd`, default 70000–99999) |

## Storage

- Invoice counters: `billing_invoice_number_sequences` keyed by `(scope, year)` (`tenant_id` column holds the scope key)
- Subscription counters: `billing_subscription_number_sequences` keyed by `scope_key`; subscriptions store `number_scope` with a unique `(number_scope, number)`
- Customer counters: `billing_customer_number_sequences` keyed by `scope_key`; profiles store `number_scope` with a unique `(number_scope, customer_number)`
- Supplier counters: `billing_supplier_number_sequences` keyed by `scope_key`; profiles store `number_scope` with a unique `(number_scope, supplier_number)`
- Supplier invoice counters: `billing_supplier_invoice_number_sequences` keyed by `(scope, year)`; invoices store `number_scope` with issued `invoice_number`
- Debtors: `billing_datev_debtor_accounts.allocation_scope` with unique `(allocation_scope, debtor_number)`
- Creditors: `billing_datev_creditor_accounts.allocation_scope` with unique `(allocation_scope, creditor_number)`

Shared mode uses the sentinel scope `__shared__`. Tenant-scoped mode uses the current `X-Tenant` id as the scope.

## DATEV ranges and unified export

Per-tenant DATEV debtor ranges still apply for start/end of allocation. When numbers are **shared**, overlapping ranges across tenants are expected and do not produce uniqueness collisions. When numbers are **tenant-scoped**, overlapping ranges can collide in **unified** DATEV exports; the billing manager logs a warning at startup in that mode.

If the configured range is exhausted, allocation fails and emits webhook `datev.debtor_range_exhausted` or `datev.creditor_range_exhausted` (see [Webhooks](./webhooks.md)).

## Operator guidance

- Treat `TENANTS_SHARED_NUMBERS` as **deploy-time** configuration. Switching after production data exists can break uniqueness assumptions.
- Enabling shared mode requires that no duplicate invoice or debtor numbers already exist across tenants (the shared-number migration fails loudly on duplicate debtors).
- Reserved hostnames and other global identifiers are unrelated; see multi-tenancy docs for tenant isolation of catalog and user data.

## Related

- [Multi-tenancy](./multi-tenancy.md)
- [Environment configuration](../deployment/environment-configuration.md)
- [Customer profiles](./customer-profiles.md)
- [Supplier profiles](./supplier-profiles.md)
- [Supplier invoices](./supplier-invoices.md)
- [Webhooks](./webhooks.md)
