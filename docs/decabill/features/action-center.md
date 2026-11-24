# Action Center

The to-do list of the billing console for admins and managers: every open next step of the tenant (documents to send, payments to chase, incomplete profiles, failed provisioning, bookings to reconcile, setup to finish), collected automatically and updated live.

## Overview

A light bulb in the top bar (`bi-lightbulb`) shows the number of open to-dos as a badge. It opens the action center, a sidebar on the right below the top bar:

- **Docked** next to the content from 1200 px width, **overlaid** on narrower screens. It never covers the top bar, and it is never wider than the content area (the navigation rail stays visible). The open state is remembered per browser.
- **Suggested next steps** (highlighted) on top: onboarding and configuration suggestions such as missing company details.
- **To-dos per area** below (Receivables, Offers, Payables, Customers, Subscriptions, Inventory, Accounting, Platform). Each type is one card; several records of the same type are shown as a **stack of cards** with their number. **Show all** expands the stack into its records (up to 25, the rest on the linked page).
- **Open** / **Set up** leads to the page of the type; a record leads to the record (e.g. the billing page searched for the invoice number). Choosing a to-do switches the console into the mode of the target page, so admins and managers can use the action center in user mode too.
- The list updates live without reloading. The bulb (or Escape) closes the panel again; on phones it also closes after choosing a to-do.

The bulb and the sidebar are shown to admins and managers in both console modes (user and admin), never to regular users.

## To-dos

| Area          | Type                                          | Condition                                                                                   | Who    |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| Setup         | `decabill.setup.issuer`                       | `BILLING_ISSUER_NAME`, `_VAT_ID`, `_ADDRESS_LINE1`, `_POSTAL_CODE` or `_CITY` empty         | admins |
| Setup         | `decabill.setup.issuer_details`               | `BILLING_ISSUER_EMAIL`, `_IBAN` or `_BIC` empty                                             | admins |
| Setup         | `decabill.setup.accounting`                   | `BILLING_ACCOUNTING_ENABLED=true`, but accounting prerequisites are missing                 | admins |
| Setup         | `decabill.setup.datev`                        | DATEV export enabled, but the tenant's DATEV configuration is incomplete                    | admins |
| Setup         | `decabill.setup.first_customer`               | The tenant has no customer profile of a regular user yet                                    | all    |
| Setup         | `platform.setup.email`                        | `SMTP_HOST` empty: no emails are sent                                                       | admins |
| Receivables   | `decabill.invoices.unsent`                    | Numbered, not void, not draft and never emailed (issued with "notify customer" off)         | all    |
| Receivables   | `decabill.invoices.credit_note_unsent`        | Voided numbered invoice whose credit note was not emailed                                   | all    |
| Receivables   | `decabill.invoices.draft`                     | Draft invoices                                                                              | all    |
| Receivables   | `decabill.invoices.overdue`                   | Status `overdue`                                                                            | all    |
| Receivables   | `decabill.invoices.auto_payment_exhausted`    | Open invoices whose automatic collection gave up                                            | all    |
| Offers        | `decabill.offers.draft`                       | Draft offers                                                                                | all    |
| Offers        | `decabill.offers.unsent`                      | Finalized (`archived`), never emailed, not expired                                          | all    |
| Offers        | `decabill.offers.expiring`                    | Finalized and expiring within 7 days                                                        | all    |
| Offers        | `decabill.offers.fulfillment_failed`          | Positions of accepted offers whose automatic fulfillment failed                             | all    |
| Payables      | `decabill.payables.draft`                     | Draft supplier invoices                                                                     | all    |
| Payables      | `decabill.payables.due`                       | Open supplier invoices due within 3 days or overdue                                         | all    |
| Payables      | `decabill.payables.missing_document`          | Issued supplier invoices without an uploaded original receipt                               | all    |
| Payables      | `decabill.suppliers.incomplete`               | Supplier profiles without a name or postal address                                          | all    |
| Customers     | `decabill.customers.incomplete`               | Incomplete billing profiles of customers with business (live subscription or open document) | all    |
| Customers     | `decabill.customers.vat_invalid`              | Customer or supplier VAT IDs that failed validation                                         | all    |
| Subscriptions | `decabill.subscriptions.provisioning_failed`  | Failed server provisioning of a live subscription                                           | all    |
| Subscriptions | `decabill.subscriptions.addon_failed`         | Failed add-ons of a live subscription                                                       | all    |
| Subscriptions | `decabill.subscriptions.config_change_failed` | The latest configuration change of a live subscription failed                               | all    |
| Subscriptions | `decabill.subscriptions.backorder_failed`     | Backorders that could not be fulfilled                                                      | all    |
| Inventory     | `decabill.inventory.withdrawal_pending`       | Withdrawal requests waiting for a decision                                                  | all    |
| Inventory     | `decabill.inventory.lending_overdue`          | Open lendings past their due date                                                           | all    |
| Inventory     | `decabill.inventory.low_stock`                | Active articles at or below their reorder point                                             | all    |
| Accounting    | `decabill.accounting.unbooked_documents`      | Issued / voided documents since the bookkeeping start date without a journal entry          | all    |
| Accounting    | `decabill.accounting.posting_issues`          | Unresolved posting issues                                                                   | all    |
| Accounting    | `decabill.accounting.bank_unmatched`          | Booked bank transactions without a match                                                    | all    |
| Accounting    | `decabill.accounting.bank_suggested`          | Booked bank transactions with a suggested match to confirm                                  | all    |
| Accounting    | `decabill.accounting.bank_import_failed`      | Failed bank imports of the last 30 days                                                     | all    |
| Accounting    | `decabill.accounting.vat_return_due`          | Draft VAT returns of finished periods (global-view tenants only, entity-wide)               | all    |
| Accounting    | `decabill.datev.export_failed`                | DATEV runs of the last 30 days whose latest attempt failed                                  | all    |
| Platform      | `platform.updates.available`                  | A newer release or outdated instances (see [Application Updates](./application-updates.md)) | all    |
| Platform      | `platform.webhooks.failing`                   | Webhook endpoints with consecutive failures or disabled after them                          | all    |
| Platform      | `platform.email.delivery_failed`              | Emails of the last 7 days that finally failed                                               | all    |

"Who": **all** = admins and managers; **admins** = only admins, because the fix lives on the admin-only settings page.

Feature-dependent to-dos only exist while the feature is on: accounting types need `BILLING_ACCOUNTING_ENABLED` with complete prerequisites, DATEV types need `BILLING_DATEV_EXPORT_ENABLED`. Everything is evaluated per tenant (`X-Tenant`) with the regular tenant scoping. Entity-wide accounting records (posting issues and bank lines without a tenant, VAT returns) are only shown to tenants listed in `TENANTS_ALLOW_GLOBAL_VIEWS`.

## Silencing

The bell menu of a card or record silences it:

- **Silence for me**, **Snooze for 1 day**, **Snooze for 1 week**: only for the current user (admins and managers).
- **Silence for everyone**: hides it for every admin and manager of the tenant (admins only).

A silence covers either a whole type or one record. Silenced to-dos do not count in the badge. The **Silenced** tab lists the silences that apply to you; you can lift your own, admins also the ones for everyone. Snoozes end on their own. Limits: 300 personal silences per user and 2,000 silences for everyone per tenant.

## Live updates

The console holds one Socket.IO connection to `socket/action-center` (`ACTION_CENTER_WEBSOCKET_NAMESPACE`) while an admin or manager is signed in. The API recomputes the tenant's to-dos and pushes a view to each connected viewer, only when that viewer's view changed:

- right after every successful `POST` / `PUT` / `PATCH` / `DELETE` request of the tenant (customers' actions included), debounced by `ACTION_CENTER_RECOMPUTE_DEBOUNCE_MS` (default 400 ms)
- right after every published webhook event of the tenant, also from queue workers (overdue invoices, payments, provisioning)
- across processes and replicas: every change writes a revision to Valkey, which API processes poll every `ACTION_CENTER_REVISION_POLL_INTERVAL_MS` (default 2 s)
- for time-based conditions (due dates, expiry), a full refresh every `ACTION_CENTER_REFRESH_INTERVAL_MS` (default 60 s)

With `CACHE_ENABLED=false` changes from other processes arrive with the periodic refresh. Connected sessions are re-validated every `ACTION_CENTER_SESSION_REVALIDATE_INTERVAL_MS` (default 60 s): an expired, revoked or locked session, or a user who is no longer admin or manager, is disconnected. When the socket cannot connect, the console falls back to loading the view over REST every 30 s.

## Access

- Console: admins and managers (`canAccessBillingAdministration`), users / OIDC / SAML authentication.
- REST: `GET /api/admin/billing/action-center`, `POST /api/admin/billing/action-center/silences` (`{ itemType, itemId?, audience: "self" | "everyone", until? }`), `DELETE /api/admin/billing/action-center/silences/:id`. Admin or manager role, PAT scope `action_center:admin`. Each returns the caller's current view.
- Personal access tokens see only the to-dos of domains they also have a scope for, so the action center never shows a token more than the domain routes would: setup `billing:admin`, receivables `invoices:admin`, offers `offers:admin`, payables `supplier_invoices:admin` (incomplete suppliers `supplier_profile:admin`), customers `customer_profile:admin`, subscriptions `subscriptions:admin`, inventory `inventory:admin`, accounting `accounting_audit:admin` (DATEV `datev:admin`), webhooks `webhooks:admin`, updates `updates:admin`, other platform items `billing:admin`. Silences of hidden to-dos are not listed either.
- Socket: interactive console sessions only (no PATs, app tokens or the static credential).
- The static credential (`api-key` / `mtls` mode) has no user and gets no action center.

Silences for everyone are published as webhook events `action_center.silence.created` and `action_center.silence.removed` (see [Webhooks](./webhooks.md#action-center-events)); personal silences stay private.

## Load

A recompute runs the sources one after another with at most three concurrent queries each, never more often than every 2 s per tenant (bursts of changes are coalesced), and only for tenants with a connected viewer. The periodic refresh is spread over a few seconds.

## Related

- [Admin Overview](./admin-overview.md) for the key figures behind many to-dos
- [Invoices](./invoices.md) and [Offers](./offers.md) for sending documents later
- [Multi-tenancy](./multi-tenancy.md) for `X-Tenant` and `TENANTS_ALLOW_GLOBAL_VIEWS`
- Shared implementation: `libs/domains/shared/backend/feature-action-center`, `libs/domains/shared/frontend/{data-access,feature}-action-center`
