# Billing Administration

Admin-only features in the billing console for manual invoice management and customer billing profile CRUD.

See also: [API Reference](../api-reference/README.md#billing-manager-http-api) for the published OpenAPI and AsyncAPI specifications.

## Access control

All endpoints under `/admin/billing/*` require admin role (`@KeycloakRoles(ADMIN)` + `@UsersRoles(ADMIN)`). Frontend routes use `authGuard` + `billingAdminGuard`.

**Multi-tenancy:** Admin and user routes are scoped by **`X-Tenant`** and the user’s **`tenant_id`**. API key auth with **`STATIC_API_KEY`** and without **`STATIC_API_KEY_TENANT_ID`** can administer **all** configured tenants (accepted risk **[AR-007](../security/accepted-risks.md#ar-007--billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset)**).

## Manual invoice administration

**Immutability:** Only invoices in `draft` status can be edited or deleted. Once issued (`issued`, `paid`, `partially_paid`, `overdue`, or `void`), line items and amounts are immutable. Admins can still void unpaid issued invoices or mark payment status manually.

**Workflow:**

1. `POST /admin/billing/invoices/manual` — create draft with user, optional subscription, custom line items
2. `POST /admin/billing/invoices/{id}` — update draft line items
3. `POST /admin/billing/invoices/{id}/issue` — issue draft (requires complete customer profile)
4. `DELETE /admin/billing/invoices/{id}` — delete draft only

The workflow steps above mirror the manual invoice administration sequence (create draft → update → issue or delete).

**Frontend:** `/administration/billing` in the billing console — split layout with dashboard cards and charts on the left, invoice list (batch-loaded, client-side search, list-group style) on the right.

## Customer billing profiles (admin)

Customer billing data is stored in `billing_customer_profiles` (one profile per user).

| Method | Path                                    | Purpose                                                |
| ------ | --------------------------------------- | ------------------------------------------------------ |
| GET    | `/admin/billing/customer-profiles`      | Paginated list                                         |
| GET    | `/admin/billing/customer-profiles/{id}` | Full profile detail                                    |
| POST   | `/admin/billing/customer-profiles`      | Create for user                                        |
| POST   | `/admin/billing/customer-profiles/{id}` | Update                                                 |
| DELETE | `/admin/billing/customer-profiles/{id}` | Delete (blocked if user has invoices or subscriptions) |

Self-service `GET/POST /customer-profile` remains for end users.

**Frontend:** `/administration/customer-profiles` in the billing console.

## Related admin pages

- **Billing dashboard** (`/administration/billing`) — KPIs, charts, bill-now (unchanged)
- **Users** (`/users`) — shared identity user manager (unchanged)
