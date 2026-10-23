# Terraform

The Loadweaver Terraform provider (`forepath/loadweaver`) manages projects, deployments, groups, policies, DNS, alert rules, backup policies and any other resource kind from Terraform. It talks to the same control-plane API as the console and the [CLI](../cli.md), and every change still goes through [plan and apply](../features/plan-and-apply.md):

- `terraform plan` runs a **Loadweaver dry-run plan** for each changed resource: the control plane validates the change and computes its effects; the plan is discarded right away. Refusals become Terraform errors on the attribute they concern. Network and workload effects, pins and approval risk show up as a warning per resource.
- `terraform apply` **creates and applies a Loadweaver plan** per resource change and follows it until every node reported it. [Approval rules](../features/projects-and-access.md#approvals) still apply: `terraform apply` waits until an approver has approved the plan.

The provider is written in TypeScript and ships as a single executable (Node.js runtime included). It speaks Terraform's plugin protocol 6, so it needs **Terraform 1.0 or newer** (tested with 1.16).

## Install

Release builds are attached to the GitHub release in the Terraform registry layout: `terraform-provider-loadweaver_<version>_<os>_<arch>.zip` for `linux_amd64`, `linux_arm64`, `darwin_amd64`, `darwin_arm64` and `windows_amd64`, plus `terraform-provider-loadweaver_<version>_SHA256SUMS` (with a detached GPG signature `…_SHA256SUMS.sig` once the release signing key is set up) and `…_manifest.json`. The zips are also listed (path, SHA-256, size) in Loadweaver's signed release manifest (`loadweaver-release-manifest-<version>.json`, see `tools/release-integrity/README.md`) once the Loadweaver release signing key is configured.

Without the registry, put the zips into a [filesystem mirror](https://developer.hashicorp.com/terraform/cli/config/config-file#filesystem_mirror):

```bash
mkdir -p ~/.terraform.d/plugins/registry.terraform.io/forepath/loadweaver
cp terraform-provider-loadweaver_1.4.0_linux_amd64.zip ~/.terraform.d/plugins/registry.terraform.io/forepath/loadweaver/
sha256sum --check --ignore-missing terraform-provider-loadweaver_1.4.0_SHA256SUMS
```

```hcl
terraform {
  required_providers {
    loadweaver = {
      source  = "forepath/loadweaver"
      version = "1.4.0"
    }
  }
}
```

Use the provider release that matches your cluster: the provider validates resources with the same schema as the control plane of that release.

Building from the repository:

```bash
npx nx run loadweaver-terraform-provider:sea      # single executable for this machine
npx nx run loadweaver-terraform-provider:package --release=1.4.0 --platforms=linux_amd64,windows_amd64
```

`package` writes the zips, `…_manifest.json` and `…_SHA256SUMS` to `dist/terraform-provider/`. macOS binaries need `codesign` (macOS) or `rcodesign` for the ad-hoc signature.

For other platforms `package` downloads the official Node.js binaries of the same Node version. It trusts their hashes only after `gpg --verify` of `SHASUMS256.txt.sig` (temporary GNUPGHOME) succeeds with one of the Node.js release keys whose fingerprints are pinned in `scripts/node-dist-verify.cjs`. The public keys come from [nodejs/release-keys](https://github.com/nodejs/release-keys) at a pinned commit. Cached archives and extracted binaries are hashed again every time they are used. The cache directory (default `<tmp>/lw-tf-node-cache`, `--node-cache`) must belong to you and must not be writable by group or others. Without `gpg` the script stops. `--allow-unsigned-node-sums` skips the signature check, for local experiments only; CI never passes it.

## Provider configuration

```hcl
provider "loadweaver" {
  endpoint = "https://cp.example.com"   # or LOADWEAVER_URL
  # token  = var.loadweaver_token       # or LOADWEAVER_TOKEN (recommended: keep it out of the configuration)
  project  = "shop"                     # or LOADWEAVER_PROJECT: default project for project resources

  # ca_certificate   = file("ca.pem")   # or LOADWEAVER_CA_CERT (PEM or a path): replaces the system CAs, for a private CA
  # approval_timeout = "30m"            # how long apply waits for approvals
  # apply_timeout    = "15m"            # how long apply follows a running Loadweaver apply
  # poll_interval    = "5s"
  # confirm_pins     = false            # confirm unacknowledged pins (as `confirm` in the console)
  # dry_run          = true             # dry-run plans during terraform plan
  # insecure_http    = false            # allow a plain http:// endpoint (local development only)
}
```

| Attribute          | Default              | Meaning                                                                                          |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------ |
| `endpoint`         | `LOADWEAVER_URL`     | Control-plane URL                                                                                |
| `token`            | `LOADWEAVER_TOKEN`   | Personal access token (sensitive)                                                                |
| `project`          | `LOADWEAVER_PROJECT` | Default project of project resources and of resources that may be cluster-wide                   |
| `ca_certificate`   | `LOADWEAVER_CA_CERT` | CA(s) the control plane is verified with instead of the system CAs (PEM; a path in the variable) |
| `approval_timeout` | `30m`                | Wait for approvals / locks during apply; `0s` fails at once                                      |
| `apply_timeout`    | `15m`                | Follow a running apply; afterwards Terraform reports it as still running                         |
| `poll_interval`    | `5s`                 | Interval of approval and progress checks                                                         |
| `confirm_pins`     | `false`              | Apply plans whose warnings contain unacknowledged pins                                           |
| `dry_run`          | `true`               | Dry-run plans during `terraform plan` (local schema validation runs either way)                  |
| `insecure_http`    | `false`              | Accept an `http://` endpoint (also from `LOADWEAVER_URL`); the token then travels unencrypted    |

The endpoint must use `https://`. An `http://` endpoint, whether set in the block or in `LOADWEAVER_URL`, is refused because the bearer token would cross the network in plain text. With `insecure_http = true` it is accepted, and every run shows an "Insecure endpoint" warning. Use that only against a local control plane or a test fake. Responses larger than 32 MiB are aborted with an error, since no control-plane response comes close to that.

The token needs the scopes `resources:read`, `plans:create` and `plans:apply` (see [Scopes](../features/projects-and-access.md#scopes)); what it may change is bounded by its user's roles: developer or higher in the touched projects, a cluster role for cluster resources. The provider configuration must be known at plan time (it cannot depend on resources of the same run).

## Resources

Every resource has `id` (`Kind/name` or `Kind/project/name`), `name`, `labels` and `last_plan_id` (the Loadweaver plan that last changed it through Terraform). Changing `name`, `project` (or `kind`) replaces the resource.

| Resource                    | Kind            | Scope              | Spec                                                                                                                 |
| --------------------------- | --------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `loadweaver_project`        | `Project`       | cluster            | typed: `description`, `default_cpu` / `default_memory` / `default_volume_size`, `quota_*`, `billing_subscription_id` |
| `loadweaver_deployment`     | `Deployment`    | project            | typed: `compose`, `variables`                                                                                        |
| `loadweaver_workload_group` | `WorkloadGroup` | project            | `spec` (JSON)                                                                                                        |
| `loadweaver_node_group`     | `NodeGroup`     | cluster            | `spec` (JSON)                                                                                                        |
| `loadweaver_client_group`   | `ClientGroup`   | cluster            | `spec` (JSON)                                                                                                        |
| `loadweaver_policy`         | `Policy`        | project or cluster | `spec` (JSON)                                                                                                        |
| `loadweaver_dns_zone`       | `DnsZone`       | cluster            | `spec` (JSON)                                                                                                        |
| `loadweaver_dns_record`     | `DnsRecord`     | project or cluster | `spec` (JSON)                                                                                                        |
| `loadweaver_alert_rule`     | `AlertRule`     | project or cluster | `spec` (JSON)                                                                                                        |
| `loadweaver_backup_policy`  | `BackupPolicy`  | project or cluster | `spec` (JSON)                                                                                                        |
| `loadweaver_resource`       | any (`kind`)    | by kind            | `spec` (JSON), for every other kind (e.g. `ImagePolicy`, `IpPool`, `StatusPage`)                                     |

- **JSON specs** take the resource's `spec` exactly as in YAML, written with `jsonencode({ … })` or taken from a file with `jsonencode(yamldecode(file("policy.yaml")))`. The fields are those of the kind's JSON Schema (`GET /api/schemas/{kind}`, also used by the console editor). `jsonencode` keeps the value canonical, so formatting never shows up as a change.
- **Defaults** the control plane fills in (e.g. a policy's `mode: enforce`) don't count as differences: a refresh compares the configured spec with the stored one after applying the same defaults. A real difference (someone changed the resource in the console) shows up as an update that puts the configuration back.
- **Projects**: project resources take `project` from the resource or the provider block. Resources that may be cluster-wide (policies, DNS records, alert rules, backup policies) use the provider's `project` too if one is set; `project = ""` makes them cluster-wide.
- **Volumes** are part of a deployment: declare them in the compose file's top-level `volumes` with `x-loadweaver` (size, replicas, backups; see [Volumes](../features/volumes.md)). Loadweaver has no separate volume resource; `loadweaver_deployment` manages them with the deployment, and `loadweaver_backup_policy` selects them for backups.

```hcl
resource "loadweaver_project" "shop" {
  name        = "shop"
  description = "Web shop"
  quota_cpu   = "16"
}

resource "loadweaver_deployment" "site" {
  name      = "site"
  project   = loadweaver_project.shop.name
  compose   = file("${path.module}/compose.yaml")
  variables = { TAG = var.release }
}

resource "loadweaver_workload_group" "web" {
  name    = "web"
  project = loadweaver_project.shop.name
  spec    = jsonencode({ selector = { matchLabels = { app = "web" } } })
}

resource "loadweaver_policy" "web_from_internet" {
  name    = "web-from-internet"
  project = loadweaver_project.shop.name
  spec = jsonencode({
    from  = [{ builtin = "internet" }]
    to    = [{ group = loadweaver_workload_group.web.name }]
    rules = [{ protocol = "tcp", ports = [80, 443] }]
  })
}

resource "loadweaver_resource" "signed_images" {
  kind    = "ImagePolicy"
  name    = "signed"
  project = loadweaver_project.shop.name
  spec    = jsonencode(yamldecode(file("${path.module}/image-policy.yaml")))
}
```

## Data sources

| Data source                    | Reads                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `loadweaver_resource`          | Any stored resource: `kind`, `name`, `project` → `spec` (JSON, use `jsondecode`), `labels`   |
| `loadweaver_project`           | A project with its defaults and quota                                                        |
| `loadweaver_deployment_status` | Where a deployment runs: `replicas` (node, state, addresses) and stable `services` addresses |

```hcl
data "loadweaver_deployment_status" "site" {
  name    = loadweaver_deployment.site.name
  project = loadweaver_project.shop.name
}

output "service_address" {
  value = one([for s in data.loadweaver_deployment_status.site.services : s.address_v4 if s.name == "web"])
}
```

## Plan and apply semantics

- **One Loadweaver plan per resource change.** Terraform plans and applies resources one by one (in dependency order, `-parallelism` at a time); the provider maps each create, update or delete onto its own Loadweaver plan. Plans lock exactly the resources they touch, so parallel applies of different resources don't block each other; a plan that touches a resource locked by another plan waits (up to `approval_timeout`).
- **`terraform plan`** validates locally with the control plane's schema, then creates a dry-run plan and discards it. Nothing changes and nothing is locked. Values unknown until apply (e.g. computed from other resources) skip the dry run for that resource. Errors of the dry run (invalid compose, quota, unknown groups, rights) fail `terraform plan`.
- **`terraform apply`** creates the plan again (the cluster may have changed since `terraform plan`), applies it and follows it: `applying` until every connected node reported the revision. A failed node, the cluster's apply timeout or a cancel roll it back (`rolled-back`); Terraform then reports the error from the plan and keeps the previous state. A plan without changes is discarded and not applied.
- **Pins**: plans whose warnings contain unacknowledged pins are refused unless `confirm_pins = true` (review them in the `terraform plan` warning first) or the pin is acknowledged with `x-loadweaver.pinned`.
- **Interrupting** (`Ctrl-C`) discards a plan that waits for approval; a plan already applying continues on the cluster and is no longer followed.
- **Destroy** creates a deletion plan per resource; resources that are already gone are just removed from the state.

## Approvals

With the project's [approval mode](../features/projects-and-access.md#approvals) requiring it (always for `everyone`, for developer tokens with `developers`, for risky changes with `risky`), the apply of a Terraform-created plan answers with its blockers and the provider waits:

1. `terraform apply` creates the plan and tries to apply it; the control plane refuses with the missing approvals.
2. The provider logs `Loadweaver plan <id> waits for approval: …` (visible with `TF_LOG_PROVIDER=INFO`) and retries every `poll_interval`.
3. An operator or admin of the project who is not the token's user approves the plan in the console (**Plans**) or with `POST /api/plans/{id}/approve`. The `terraform plan` warning shows when a change is risky, so approvers can be asked in advance.
4. The next retry applies the plan; Terraform reports `Loadweaver plan <id> was approved` as a warning and continues.

If nobody approves within `approval_timeout`, the plan is discarded and the apply fails with the list of missing approvals and how to approve. Approvals are bound to one plan: a new `terraform apply` creates a new plan that needs a new approval. For many resources in a project with `everyone`, approvers approve one plan per resource; group related changes into one run with a longer `approval_timeout`, or keep Terraform for projects in `developers` mode with an operator token.

## Import

```bash
terraform import loadweaver_project.shop shop                       # cluster kinds: name
terraform import loadweaver_deployment.site shop/site               # project kinds: project/name (or name with the provider project)
terraform import loadweaver_policy.global global                    # cluster-wide policy
terraform import loadweaver_resource.signed ImagePolicy/shop/signed # generic: Kind/name or Kind/project/name
```

After an import of a JSON-spec resource, the state holds the stored spec including defaults; the next plan may show the spec rewritten to your `jsonencode` form, which applies as an unchanged Loadweaver plan (nothing is changed on the cluster).

## Troubleshooting

- `TF_LOG_PROVIDER=DEBUG terraform plan` shows the provider's log lines (approval waits, discarded plans).
- **"Loadweaver rejected the token"**: the PAT is invalid, expired or revoked. **"Not allowed to …"**: the scopes or the user's roles are missing for the touched project.
- **"Provider configuration not known yet"**: the provider block references a value computed in the same run.
- **State from a newer provider**: the state was written by a newer provider release; all resource schemas are at version 0 so far.
- **"Insecure endpoint"**: the endpoint is `http://`. Switch to `https://` (add `ca_certificate` for a private CA), or set `insecure_http = true` for local development.
- The provider and its gRPC socket only live while Terraform runs; it listens on a private unix socket (loopback TCP on Windows) with mutual TLS between Terraform and the provider. On Windows it will not start without Terraform's client certificate (`PLUGIN_CLIENT_CERT`, which Terraform always sets). To launch it by hand while debugging, set `LOADWEAVER_TF_PLUGIN_INSECURE_TCP=1`.
