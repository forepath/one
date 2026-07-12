# Marketing promotions

Decabill marketing promotions let tenants define discount codes that customers redeem against subscriptions. Benefits are applied automatically during invoice creation.

## Tenant isolation

- Every promotion belongs to a tenant (`tenant_id` on `billing_promotions`).
- Codes are unique per tenant: `(tenant_id, code)`.
- All admin and customer APIs resolve promotions within the `X-Tenant` header context.

## Advantage types

| Type                   | Behavior                                                 |
| ---------------------- | -------------------------------------------------------- |
| `fixed_amount_net`     | Monetary credit applied across invoices until exhausted  |
| `free_days`            | Waives charges overlapping the benefit window (prorated) |
| `free_billing_periods` | Waives full subscription charge for N billing runs       |

## Product scoping

- Optional `applicable_plan_ids` restricts a promotion to specific service plans.
- Empty/null means all plans in the tenant catalog.

## Subscription eligibility

| Value      | Redemption surfaces      |
| ---------- | ------------------------ |
| `new`      | Subscription order only  |
| `existing` | `/promotions` page only  |
| `both`     | Either surface (default) |

## Customer flow

1. **Validate** — `POST /promotions/validate` simulates redemption (no writes).
2. **Redeem** — `POST /promotions/redeem` persists an active redemption linked to a subscription.
3. **Checkout** — optional `promotionCode` on `POST /subscriptions` redeems with context `new` after the subscription is created.

## Billing integration

- `PromotionApplicationService` runs during invoice creation before totals finalize.
- Invoices are issued when raw charges ≥ €0.01 even if promotions reduce the balance to zero.
- Zero-balance promotional invoices are marked **paid** immediately and use e-invoice type code **325** (instead of **380**).

## Related docs

- [Invoices](./invoices.md) — zero-balance promotional invoices
- [Subscriptions](./subscriptions.md) — promo code at order time
- [Multi-tenancy](./multi-tenancy.md) — tenant-scoped catalogs
