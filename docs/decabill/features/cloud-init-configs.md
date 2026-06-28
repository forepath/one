# CloudInit Configs

Admin-managed CloudInit templates for the `custom` service kind on provisioning-enabled service plans.

## Multi-tenancy

CloudInit configs are tenant-scoped, following the same pattern as [service types](./service-types-and-plans.md):

- Each row stores `tenant_id` with a unique `(tenant_id, key)` constraint.
- All repository queries filter by the request tenant from the `X-Tenant` header via `getRequiredTenantId()`.
- Admin list, create, update, and delete endpoints only touch configs in the current tenant.
- `GET /service-plans/{id}/cloud-init-configs/{configId}/order-fields` returns 404 when the config is not on the plan or belongs to another tenant.
- Custom service plans must reference a config id that exists and is active in the same tenant. Validation runs when admins save service plans and again at order or provisioning time.

The billing console attaches `X-Tenant` from `billing.tenantId` on every API call. See [Multi-tenancy](./multi-tenancy.md).

## Overview

CloudInit configs let operators define reusable provisioning templates without shipping a new product bundle. Each template supports three provisioning modes:

| Mode                 | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `simple`             | Single Docker image with generated compose file (default)            |
| `compose-template`   | Custom Docker Compose YAML with placeholder interpolation            |
| `user-data-template` | Full cloud-init user-data bash script with placeholder interpolation |

Templates also define host paths, port mapping, and an ordered list of environment variables. Service plans reference a template by id when `providerConfigDefaults.service` is set to `custom`.

The billing manager merges customer input with encrypted admin defaults at order time and generates cloud-init user data based on the selected provisioning mode.

## Template Placeholders

Compose and user-data templates support allowlisted placeholders:

| Placeholder          | Value                                                         |
| -------------------- | ------------------------------------------------------------- |
| `{{HOSTNAME}}`       | Provisioned host short name                                   |
| `{{FQDN}}`           | Host FQDN                                                     |
| `{{WORK_DIR}}`       | Application work directory                                    |
| `{{SSH_PUBLIC_KEY}}` | SSH public key from order config                              |
| `{{DOCKER_IMAGE}}`   | Configured Docker image (simple/compose modes)                |
| `{{CONTAINER_PORT}}` | Container port                                                |
| `{{HOST_PORT}}`      | Host port                                                     |
| `{{env.VAR_KEY}}`    | Resolved environment variable (must be defined on the config) |

Unknown placeholders are rejected when admins save a template.

## Environment Variables

Each variable stores metadata in plain jsonb on the config row:

| Field                       | Purpose                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `key`                       | Environment variable name injected into the container                                   |
| `label`                     | Customer-facing label in the order form                                                 |
| `description`               | Optional help text                                                                      |
| `showInOrderForm`           | When true, the variable appears in the customer order modal                             |
| `hasDefault`                | When true, an admin default exists (the value itself is not returned in list responses) |
| `useRandomDefault`          | When true, a password-like value is generated at order time instead of a static default |
| `randomDefaultLength`       | Minimum 21; used when `useRandomDefault` is true                                        |
| `randomDefaultSpecialChars` | Include special characters in generated random defaults                                 |

Default values are stored in a separate encrypted column (`env_default_values`) using the same AES-256-GCM transformer as other billing secrets. Admin GET by id and create or update responses include decrypted defaults for edit workflows. List responses expose metadata only.

When `useRandomDefault` is enabled for a variable, the static default input is omitted and a password-like value is generated at order/provisioning time (minimum length 21, optional special characters).

## Service plan product defaults

The billing console plan editor shows **Provider default config** for base server fields (`serverType`, geography, `firewallId`). Integrated stack settings and CloudInit environment variable plan overrides appear in **Product defaults** only when the selected customer options require them.

## Admin API

| Method | Path                       | Auth  | Purpose                                                 |
| ------ | -------------------------- | ----- | ------------------------------------------------------- |
| GET    | `/cloud-init-configs`      | Admin | List configs (defaults masked)                          |
| POST   | `/cloud-init-configs`      | Admin | Create config                                           |
| GET    | `/cloud-init-configs/{id}` | Admin | Get config with decrypted defaults                      |
| POST   | `/cloud-init-configs/{id}` | Admin | Update config                                           |
| DELETE | `/cloud-init-configs/{id}` | Admin | Delete config (blocked when referenced by active plans) |

Customer order fields are loaded via `GET /service-plans/{planId}/cloud-init-configs/{configId}/order-fields` (plan-scoped; see Customer Order Flow).

Schema details are in the [API Reference](../api-reference/README.md).

## Admin UI

The **Configs** page lives under Administration in the billing console, directly below **Providers** (`/administration/cloud-init-configs`). Operators can create, edit, and delete templates and manage environment variables with the same add, reorder, and remove interaction used for ordering highlights on service plans.

Compose and user-data templates are edited in Monaco-based code editors (YAML and shell syntax) that follow the Decabill Bootstrap theme in light and dark mode.

Default values are edited in password-style fields so values are not shown in list views.

## Plan Linkage

Service plans can expose one or more provisioning options that customers choose at order time. Options are stored in `providerConfigDefaults.provisioningOptions`:

```json
{
  "provisioningOptions": [
    { "type": "integrated", "service": "controller" },
    { "type": "integrated", "service": "manager" },
    { "type": "custom", "cloudInitConfigId": "<uuid-a>" },
    { "type": "custom", "cloudInitConfigId": "<uuid-b>" }
  ],
  "serverType": "cx11",
  "region": "fsn1"
}
```

The plan editor shows checkboxes for integrated stacks (Agenstra Controller, Agenstra Manager) and each active CloudInit config when the provider schema supports provisioning products. Both integrated options are selected by default for new plans. Provider keys such as `serverType` and `region` continue to use the existing provider schema.

`GET /service-plans/{id}/order-provisioning-options` returns the customer-facing option list (labels and descriptions) for the order modal.

## Customer Order Flow

When a customer orders a plan with provisioning options:

1. The console loads `GET /service-plans/{id}/order-provisioning-options`.
2. When more than one option exists, the customer selects one via `requestedConfig.provisioningOptionKey` (for example `integrated:controller` or `custom:<uuid>`).
3. For custom options, the console loads `GET /service-plans/{planId}/cloud-init-configs/{configId}/order-fields` for the selected config on the current plan.
4. Only variables with `showInOrderForm` appear in the order modal.
5. Fields with admin defaults (static or random) are optional (`required: false`) and expose `hasDefault: true` in the order-fields response. Default values are resolved server-side at order time and are not returned to customers.
6. Customer values are sent in `requestedConfig.env` as a string map.
7. The backend decrypts admin defaults, merges customer input, and rejects the order when a required variable has no value after merge.

Integrated and custom fieldsets are shown based on the selected option. When only one option is configured on the plan, the backend auto-selects it without requiring `provisioningOptionKey`.

## Provisioning

Custom cloud-init is built by `custom-configuration.utils` and dispatched through `buildProvisioningUserData` alongside controller and manager paths.

### Automated image updates

The **subscription-item-update** background job SSHes to provisioned hosts and runs `docker compose up -d --pull=always` for integrated controller and manager stacks. **Custom service items are skipped** because their runtime layout is defined per CloudInit template (single compose service, optional user-data-only mode) and is not compatible with the bundled stack update command. Operators must roll out template or image changes to custom instances manually (re-provision, SSH, or a future template-specific update path).

`workDir` must match `/opt/<segment>` with alphanumeric path segments; values are validated on admin save and quoted in generated bootstrap scripts.

### Simple mode

The generated user data:

1. Installs Docker CE on the host.
2. Writes a single-service `docker-compose.yml` under the configured work directory.
3. Injects resolved environment variables into the service definition.
4. Starts the stack on first boot.

### Compose-template mode

Uses the same bootstrap script as simple mode but writes an admin-authored Docker Compose template after placeholder interpolation instead of the built-in single-service compose file.

### User-data-template mode

Runs the admin-authored cloud-init user-data script after placeholder interpolation. Operators are responsible for the full provisioning logic in this mode.

The admin UI provides a **Load example** starter script that installs Docker, configures SSH, writes a compose file under `{{WORK_DIR}}`, and starts the stack. Extend the compose `environment` block with lines such as `API_KEY: {{env.API_KEY}}` after defining matching env variables on the config.

Custom stacks do not include Nginx or Let's Encrypt in v1. TLS termination is out of scope for this service kind.

## Related Documentation

- **[Server Provisioning](./server-provisioning.md)** - Provider provisioning and cloud-init overview
- **[Service Types and Plans](./service-types-and-plans.md)** - Plan defaults and admin catalog
- **[Subscriptions](./subscriptions.md)** - Order flow and `requestedConfig`
- **[API Reference](../api-reference/README.md)** - OpenAPI schemas
