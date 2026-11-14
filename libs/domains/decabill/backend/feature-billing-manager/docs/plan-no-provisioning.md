# Plans without a provisioning process (bare servers)

## Purpose

Plans on server providers (Hetzner, DigitalOcean) normally offer one or more provisioning options: an integrated stack (`integrated:<service>`) or an admin CloudInit template (`custom:<cloudInitConfigId>`). The **no provisioning** option (`none`) lets admins sell a bare server: the server is created, but no product stack is installed and no CloudInit config is needed.

## Plan configuration

- Stored in `providerConfigDefaults.provisioningOptions` as `{ "type": "none" }`. It can be the only option or sit next to other options, so customers can choose between, for example, Agenstra Controller and a bare server.
- Option key: `none`. A plan whose only option is `none` persists the legacy mirror `service: "none"`.
- Offered in the billing console when the provider schema's `service` enum includes `none` (Hetzner and DigitalOcean do).
- `assertActiveConfigForPlanDefaults` accepts a `none`-only plan. Server plans with no parseable option are still rejected, and an empty selection is still inferred as `agenstra-controller` for legacy data.

## Order API (`POST /subscriptions`)

- `GET /service-plans/:id/order-provisioning-options` returns `{ optionKey: "none", type: "none", label: "No provisioning" }` for the option.
- Customers can select `none` only when the plan offers it (`provisioningOptionKey: "none"`, or the only option). On a `none`-only plan, a requested `service` or `cloudInitConfigId` is overwritten. On other plans, `none` is rejected.
- The item `configSnapshot.service` is `none`, and `cloudInitConfigId` is removed.

## Provisioning

`CloudInitDispatchService` builds a minimal user-data script for `none`. The script installs no software stack. It only applies the SSH access baseline that every provisioned host gets:

- the generated platform public key in `/root/.ssh/authorized_keys` (shell-quoted)
- `PasswordAuthentication no`, `KbdInteractiveAuthentication no` and `PermitRootLogin prohibit-password`, written to `/etc/ssh/sshd_config.d/00-decabill-hardening.conf`. sshd keeps the first value it reads, and images ship drop-ins such as `50-cloud-init.conf` with `PasswordAuthentication yes`. The `00-` file sorts first so it wins, and `sshd -t` checks the config before the restart.

Customers reveal the private key once from the service page, as for other servers. Addon CloudInit scripts are appended as usual. The script fails closed when no public key is present.

## Lifecycle

- No service-detail tabs are added, because there is no stack or template module.
- The update job skips `none` items because there is no stack to update.
- Start, stop, restart, server type changes, teardown and billing work as for every other server.
