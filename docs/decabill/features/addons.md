# Addons

Tenant-scoped modular extensions that can be attached to service plans whose provisioning provider supports addons (`supportsAddons: true`).

## Overview

Addons are administered similarly to [CloudInit configs](./cloud-init-configs.md): a shared catalog with CRUD, then selected on plans under **Customer-selectable options**. Customers can pick allowed addons in the Order Plan wizard (Step 1). Addon configuration fields appear on the Configuration step. Pricing, invoices, provisioning, and teardown all account for selected addons.

## Provider gate (`supportsAddons`)

Some future providers may lack hook points (module lifecycle or cloud-init script append). Capability is declared on provider metadata:

| Provider                                            | Default                                |
| --------------------------------------------------- | -------------------------------------- |
| Hetzner / DigitalOcean (built-in)                   | `supportsAddons: true`                 |
| Dynamic `DYNAMIC_BILLING_PROVIDER_METADATA` plugins | **`false` when omitted** (fail closed) |

When `supportsAddons` is false for a plan's service-type provider:

- Plan create/update rejects non-empty `allowedAddonIds`
- `GET /service-plans/{id}/addons` returns `[]`
- Order create and pricing preview reject `addonIds`
- Admin plan editor and Order Plan Step 1 hide addon UI

## Implementation types

| Type                | Behavior                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module`            | Node submodule loaded via `DYNAMIC_ADDON_MODULES`; must implement `provision` / `teardown` and may declare `configFields` and optional `nestModule` HTTP |
| `cloud_init_script` | Script template interpolated then appended after the primary cloud-init user-data at provision time                                                      |

## Configuration

Addon config mirrors [CloudInit environment variables](./cloud-init-configs.md) (script addons) and provider-declared fields (module addons). Secrets use the same AES-256-GCM JSON column transformer as CloudInit defaults and service-type provider defaults.

### Schema (`configSchema.environmentVariables`)

Each field may define:

- `key` / `label` / optional `description`
- `showInOrderForm`, customer-visible on Order Plan Configuration step (selection happens in Step 1)
- `useRandomDefault` (+ length ≥ 21, optional special chars), server generates when still empty after merge
- `hasDefault`, computed from static default or random flag (never expose values to customers)

| Type                | Who owns the field list                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud_init_script` | Admin edits env-var rows in the Addons page                                                                                                                    |
| `module`            | Registered module’s `configFields`; snapped into `configSchema` on create/update (admin does not free-edit the list). Missing module at write time is rejected |

Encrypted `configDefaultValues` store admin static defaults (partial update merges / empty clears). List responses omit decrypted defaults; GET by id returns them for editing.

### Resolve order (order create)

1. Admin defaults
2. Customer `addonConfigs[addonId]` (allowlisted keys only)
3. Random fill for `useRandomDefault`
4. Fail if any declared key is still empty

Resolved map is stored encrypted on `billing_subscription_addons.configSnapshot`.

### Injection

- **Scripts:** `scriptTemplate` is interpolated with `{{env.KEY}}` (same helper as custom CloudInit), then appended.
- **Modules:** `configSnapshot` is passed on `AddonLifecycleContext` to `provision` / `teardown`.

## Pricing

Optional `basePrice` (non-negative) with `priceIntervalType` / `priceIntervalValue`. Rates are converted to the plan billing period (hour/day/month/year) and appear as separate invoice line items. Zero is valid (free addon). Config values do not affect price.

## Plan linkage

Stored in `providerConfigDefaults`:

| Key                 | Meaning                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `allowedAddonIds`   | UUID array of customer-selectable catalog addons                          |
| `mandatoryAddonIds` | UUID subset of `allowedAddonIds`; always activated (cannot be deselected) |

Delete/deactivate of a catalog addon is blocked while active plans reference it, or while any subscription addon rows still reference it (including inactive history).

`GET /service-plans/{id}/addons` returns each option with `mandatory: true|false` so the Order Plan UI can lock required addons.

### Order merge

On order create and mid-life addon add, the server merges client `addonIds` with plan `mandatoryAddonIds` (`mergeOrderAddonIds`): mandatory IDs are always included first regardless of the client payload. Clients cannot omit a mandatory addon.

When the effective provider (from customer selection or plan pin) is incompatible with a selected addon, pricing preview marks the line with `invalid: true`, excludes it from totals, and order create silently omits that addon. Mandatory addons incompatible with the chosen provider are omitted as well — operators should avoid configuring plans where a mandatory addon only supports a subset of allowed providers.

### Integrated stack auto-mandatory

Plans that offer at least one **integrated** (Docker-host) provisioning option automatically ensure the first-party **Container Manager** catalog addon (`key` / `moduleKey`: `container-manager`) is present in both `allowedAddonIds` and `mandatoryAddonIds`. Custom-only plans are left unchanged. See [Container Manager](./container-manager.md).

## First-party module: Container Manager

Builtin first-party contributor module (`ContainerManagerContributorModule` + compile-time UI module). Registered with the addon module registry (alongside `DYNAMIC_ADDON_MODULES`). Provision/teardown are readiness no-ops; diagnostics run over SSH when the subscription addon is `active`. Declares a service-details tab (`id: container-manager`, order `100`). Code modules may also export `nestModule` to ship HTTP. Details: [Container Manager](./container-manager.md).

## Order and lifecycle

1. Customer selects addons → `addonIds` + optional `addonConfigs`
2. Rows created as `pending` with price/name snapshots and resolved `configSnapshot`
3. After successful server provision → interpolated scripts already in user-data; module `provision` → `active` + `addon.activated`
4. On subscription teardown → module `teardown` → `inactive` + `addon.deactivated`
5. Failures emit `addon.provision_failed` / `addon.teardown_failed` (webhook + email)

### Mid-life changes

Addons can also be added to or removed from a running subscription:

- **Add:** a `pending` row is created for every addon that is not already pending or active, then the module `provision` runs, or the interpolated `scriptTemplate` is executed over SSH (`root`, port 22, item SSH key). Exit code `0` activates the row; anything else fails it and aborts the batch.
- **Remove:** the row goes to `tearing_down`, then module `teardown` runs, or the interpolated `deprovisionScriptTemplate` is executed over SSH. **Empty / null `deprovisionScriptTemplate` = status-only** (no SSH undo): the row still becomes `inactive` and `configSnapshot` is cleared. Operators who need remote cleanup must supply a reverse script.
- **Subscription teardown:** a configured `deprovisionScriptTemplate` also runs before the server is deleted, and is skipped when the item has no SSH key or no reachable public IP.

Customer-facing notifications carry generic messages; script output, config values, and keys are never logged or published.

| Variable                               | Default  | Purpose                                  |
| -------------------------------------- | -------- | ---------------------------------------- |
| `BILLING_ADDON_SSH_COMMAND_TIMEOUT_MS` | `120000` | Hard stop for a remote addon script (ms) |

Ops checklist for mid-life addon remove and related env knobs: [Subscription Config Change → Operations](./subscription-config-change.md#operations).

## Admin API

| Method          | Path                            | Purpose                              |
| --------------- | ------------------------------- | ------------------------------------ |
| GET/POST        | `/addons`                       | List / create                        |
| GET/POST/DELETE | `/addons/{id}`                  | Get / update / delete                |
| GET/POST        | `/addons/{id}/meters`           | List / attach usage meters           |
| POST/DELETE     | `/addons/{id}/meters/{meterId}` | Update override / detach             |
| GET             | `/addons/modules`               | Registered modules + declared meters |

Addon responses embed attached meters (optional unit-price and included-usage overrides). Module addons sync declared meters as required (`source=module`) on create/update; required meters cannot be detached. See [Usage meters](./usage-meters.md).

## Customer API

| Method | Path                         | Purpose                                                                                                            |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/service-plans/{id}/addons` | Orderable addons (`orderFields` included; no secret values). Optional `?provider=` filters by compatibility.       |
| POST   | `/pricing/preview`           | Include `addonIds` for live totals; incompatible addons return `addonLines[].invalid` and are excluded from totals |
| POST   | `/subscriptions`             | Include `addonIds` + optional `addonConfigs`; incompatible addons are omitted server-side                          |

## Notifications

See [Webhooks](./webhooks.md) and [Email notifications](./email-notifications.md) for `addon.*` events, including `addon.collection_failed` (webhook-only).

## Related documentation

- [Container Manager](./container-manager.md) Docker host diagnostics addon and service tab
- [Service details](./service-details.md) Tabs and extension registry
- [Dynamic provider plugins](./dynamic-provider-plugins.md) `DYNAMIC_ADDON_MODULES` and `configFields`
- [CloudInit configs](./cloud-init-configs.md) Env var and random default pattern
- [Service types and plans](./service-types-and-plans.md) Catalog attachment of addons to plans
- [Subscriptions](./subscriptions.md) Addon lifecycle on subscription orders
- [Usage meters](./usage-meters.md) Meter attachments on addons and scoped usage billing
