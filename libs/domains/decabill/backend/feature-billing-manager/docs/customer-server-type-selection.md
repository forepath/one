# Customer server type selection

## Purpose

Provisioning plans (Hetzner, DigitalOcean) use `basePriceFromField: 'serverType'` in the provider registry. Plan defaults live in `providerConfigDefaults.serverType` and `basePrice` is derived from that type’s `priceMonthly`. This feature lets admins opt in to **customer-selectable** server types on the order flow when the effective provider schema uses server-type-based pricing.

## Service plan fields

- **`allowCustomerServerTypeSelection`** (boolean, default `false`) on `billing_service_plans`.
- **`allowedServerTypes`** (`string[]`, default `[]`) — server type ids customers may choose when the flag is true.
- Exposed on `ServicePlanResponse`, `CreateServicePlanDto`, `UpdateServicePlanDto`, and public offerings (`PublicServicePlanOffering`) as `allowCustomerServerTypeSelection` (and `allowedServerTypes` on admin DTOs).

## Admin rules

- The billing console shows “Allow server type selection” only when the merged provider schema has **`basePriceFromField === 'serverType'`**.
- When the flag is **false**, `allowedServerTypes` is ignored/cleared on save; a single server type is selected in `providerConfigDefaults.serverType` and `basePrice` follows that type.
- When the flag is **true**, admins multi-select `allowedServerTypes` (minimum one). `providerConfigDefaults.serverType` is set to the first selected type (checkout default). `basePrice` is synced from that default type’s `priceMonthly`.
- The API returns **400** if `allowCustomerServerTypeSelection: true` is sent when the effective schema does not support server-type selection, or when `allowedServerTypes` is empty or contains invalid values.

## Order API (`POST /subscriptions`)

1. If **`allowCustomerServerTypeSelection` is false**, `serverType` is removed from `requestedConfig` before merging with `providerConfigDefaults`.
2. If **true**, client-supplied `serverType` is kept; when omitted, the plan default (`providerConfigDefaults.serverType`) is used.
3. The resolved `serverType` must be listed in `plan.allowedServerTypes` when the flag is true.
4. The resolved infrastructure base price (`priceMonthly` for the chosen type) is snapshotted in subscription item `configSnapshot` as **`billingBasePrice`** so recurring billing matches checkout pricing.

## Pricing preview (`POST /pricing/preview`)

When `requestedConfig.serverType` is set (or the plan default when customer selection is enabled), the preview resolves `priceMonthly` via `ProviderServerTypesService` and passes it to `pricingService.calculate(plan, basePriceOverride)`.

## Public catalog

When `allowCustomerServerTypeSelection` is true and `allowedServerTypes` has more than one entry:

- **`totalPrice`** — customer total for the plan’s default `providerConfigDefaults.serverType`.
- **`totalPriceFrom`** — lowest customer total across all `allowedServerTypes` (same margin formula).
- **`GET /public/service-plan-offerings/cheapest`** compares plans using `totalPriceFrom ?? totalPrice`.

Marketing pages use `formatPublicOfferingPrice` to show **“from €X”** when `totalPriceFrom` is lower than `totalPrice`.

## Backorder retry

When availability fails during `POST /subscriptions` with `autoBackorder`, the stored `requestedConfigSnapshot` includes the customer’s sanitized `requestedConfig` plus the resolved **`serverType`** and **`billingBasePrice`** from the pre-check effective config (so list pricing and retry match checkout).

`POST /backorders/:id/retry` applies the **same** strip/validate rules using the plan’s current `allowCustomerServerTypeSelection` flag and `allowedServerTypes`, and the stored `requestedConfigSnapshot`.

## Invoice and withdrawal

`invoice-creation.service` and `withdrawal-refund.service` use `configSnapshot.billingBasePrice` as a base-price override when present so billed amounts match the server type chosen at order time.

## Related code

- `src/lib/utils/provider-server-type.utils.ts` — schema support check, stripping, validation.
- `src/lib/utils/server-type-billing.utils.ts` — price resolution and `billingBasePrice` snapshot helpers.
- `src/lib/services/provider-server-types.service.ts` — fetches server type catalogs from provider APIs.
- `src/lib/services/subscription.service.ts` — `createSubscription`.
- `src/lib/services/backorder.service.ts` — `retry`.
- `src/lib/controllers/pricing.controller.ts` — pricing preview.
- `src/lib/controllers/public-service-plan-offerings.controller.ts` — `totalPriceFrom`.
