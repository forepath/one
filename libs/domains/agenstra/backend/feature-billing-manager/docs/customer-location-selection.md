# Customer location selection

## Purpose

Some products are provisioned in a specific geography (Hetzner `location`, DigitalOcean `region`). Plan defaults live in `providerConfigDefaults`. This feature lets admins opt in to **customer-selectable** geography on the order flow when the provider schema defines a bounded list (`enum`) for `region` or `location`.

## Service plan field

- **`allowCustomerLocationSelection`** (boolean, default `false`) on `billing_service_plans`.
- Exposed on `ServicePlanResponse`, `CreateServicePlanDto`, `UpdateServicePlanDto`, and public offerings (`PublicServicePlanOffering`) as `allowCustomerLocationSelection`.

## Admin rules

- The billing console shows “Allow location selection” only when the selected service type’s merged provider schema includes **`region` or `location`** as `type: string` with a **non-empty string `enum`**.
- The API returns **400** if `allowCustomerLocationSelection: true` is sent when neither the **stored** `service_types.config_schema` nor the **registered** provider default schema (same source as `GET /service-types/providers`, matched by `service_types.provider`) defines that geography field with a string enum. Many service types keep `config_schema` as `{}` and rely on the provider registry; the server assertion follows that same effective schema.

## Order API (`POST /subscriptions`)

1. If **`allowCustomerLocationSelection` is false**, `region` and `location` are removed from `requestedConfig` before merging with `providerConfigDefaults`.
2. If **true**, client-supplied `region` / `location` are merged like other keys.
3. For **`hetzner` and `digital-ocean`**, the effective geography string is resolved from **`region` or `location`** (aliases), then **both keys are set** to that value so validation and downstream code stay consistent.
4. **`validateConfigSchema`** enforces property types and, when `enum` is present on a property, that the value is allowed.

## Backorder retry

`POST /backorders/:id/retry` applies the **same** strip/merge/mirror/validate rules using the plan’s current `allowCustomerLocationSelection` flag and the stored `requestedConfigSnapshot`.

## Related code

- `src/lib/utils/provider-location.utils.ts` — schema support check, stripping, resolution, mirroring.
- `src/lib/services/subscription.service.ts` — `createSubscription`.
- `src/lib/services/backorder.service.ts` — `retry`.
