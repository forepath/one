# Admin Overview

A dashboard of the key figures of a tenant for billing administrators, with optional cross-tenant and combined numbers.

## Overview

Administrators open **Admin → Overview** (`/administration/overview`) in the billing console. The page is laid out like the Agenstra audit overview:

- **Summary bar**: customers, active subscriptions, revenue in period, expenses in period, open receivables, open payables. The receivables card turns to a warning when invoices are overdue.
- **Filter strip**: period (`From`, `To`, default the last 30 days) and grouping (`Day` or `Month`). The applied filters are kept in the URL (`?f=`), so a view can be shared or reloaded.
- **Panels**:
  - **Revenue and expenses**: issued customer invoices (gross) and issued supplier invoices (gross) per day or month of the period.
  - **Result in period**: revenue minus expenses (gross), green when positive, red when negative.
  - **Customers and subscriptions**, **Receivables**, **Payables**, **Offers**, **Projects**, **Inventory**: the current figures of each area, each with a link to its administration page.

All figures are the current state except those marked "in period" (revenue, expenses, paid invoices, accepted offers).

| Area                        | Figures                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| Customers and subscriptions | Customer profiles, subscriptions, active subscriptions, subscriptions waiting for capacity (backorder) |
| Receivables                 | Open and overdue invoices (count, balance due), overdue invoices, not yet billed, revenue in period    |
| Payables                    | Suppliers, open supplier invoices (count, balance due), expenses in period                             |
| Offers                      | Awaiting response (count, gross), drafts, accepted in period                                           |
| Projects                    | Active projects, open tickets (to do, in progress, prototype)                                          |
| Inventory                   | Articles, low stock, pending withdrawal requests, open and overdue lendings                            |

## Tenants and combined numbers

By default the page shows the request tenant (`X-Tenant`). Admins of tenants listed in `TENANTS_ALLOW_GLOBAL_VIEWS` get a tenant chip in the page header, the same switch as on the accounting, DATEV and File Explorer pages:

- Any configured tenant: that tenant's figures.
- **All tenants**: the combined numbers (sums over every configured tenant) in the summary bar and panels, plus a **Revenue by tenant** chart and a **Tenants** table that compares the tenants side by side. Selecting a row switches to that tenant.

The links to the administration pages are only shown for the home tenant, because those pages show the home tenant.

Each tenant's figures come from the regular tenant-scoped queries, run once per tenant in that tenant's context, so the overview never reads data outside the tenants in scope. Tenants are evaluated one after another to keep the database pool free for regular traffic.

## Access

- Route guard: `billingAdminGuard` (admins only); the nav tile sits first in the **Admin** menu.
- API: `GET /api/admin/billing/overview?viewTenantId=&from=&to=&groupBy=` (admin role, PAT scope `billing:admin`).
  - `viewTenantId` omitted or equal to the request tenant: the request tenant.
  - Another configured tenant or `all`: only for tenants in `TENANTS_ALLOW_GLOBAL_VIEWS` (`403` otherwise); unknown tenants return `400`.
  - `from` / `to` are `YYYY-MM-DD` (default the last 30 days); `groupBy` is `day` (at most 366 days) or `month` (at most 3660 days). Other values return `400`.

The response lists one entry per tenant in scope (`tenants[]` with `metrics` and `series`) and their sum (`combined`). See the [OpenAPI spec](../../../libs/domains/decabill/backend/feature-billing-manager/spec/openapi.yaml) (`AdminOverviewResponse`).

## Related

- [Billing Administration](./billing-administration.md) for the statistics, invoices and bill-now behind the receivables figures
- [Multi-tenancy](./multi-tenancy.md) for `X-Tenant` and `TENANTS_ALLOW_GLOBAL_VIEWS`
- [Supplier invoices](./supplier-invoices.md), [Offers](./offers.md), [Projects](./projects.md), [Inventory](./inventory.md)
