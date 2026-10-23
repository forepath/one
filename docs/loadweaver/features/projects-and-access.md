# Projects and Access

A **project** is the access unit inside a cluster. People get a role in the cluster, a role in a project, or both. Roles decide who sees what, who may plan and apply, and whose plans need a second pair of eyes.

Access is not desired state: memberships, project settings and acceptances change immediately through the API (never through plan / apply, so a stuck plan can't lock anyone out), and every change is written to the [audit log](./audit-log.md).

## Roles

| Role             | Scope   | May                                                                                                                    |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cluster-admin`  | Cluster | Everything. Acts as `admin` in every project. Only role that changes `Cluster` and `Project` resources (and so quotas) |
| `infra-operator` | Cluster | Plan and apply cluster-level resources (nodes, sites, node groups, IP pools, DNS, …), manage nodes and join tokens     |
| `auditor`        | Cluster | Read everything, including the audit log; change nothing                                                               |
| `admin`          | Project | Everything an operator may, plus manage the project's members and settings                                             |
| `operator`       | Project | Plan and apply the project's resources, approve other people's plans, accept other projects' policies                  |
| `developer`      | Project | Plan the project's resources; apply them once the plan is approved (see [Approvals](#approvals))                       |
| `viewer`         | Project | Read the project's resources, plans, members, settings and requests                                                    |

- Global admins (interactive login) and the static API key are cluster admins. A personal access token never inherits global admin from the login; it gets cluster and project roles from memberships like anyone else, narrowed by its scopes.
- Terminals, the file browser and debug tunnels: operators and admins; developers terminals and files only with `developerExec`; viewers never (see [Terminals, files and tunnels](./terminals-files-and-tunnels.md#who-may)).
- Virtual machines: power actions and the serial / VNC consoles follow the terminal rule (operators and admins; developers with `developerExec`); snapshots, re-imaging and VM image imports need an operator ([Virtual machines](./virtual-machines.md#roles)).
- Who may plan, apply or discard is checked against the caller's roles at that moment. A plan that touches cluster-level resources needs `infra-operator` (or `cluster-admin` for `Cluster` and `Project`); project resources need at least `developer` in every project the plan changes.

## Who may grant what

- Cluster admins assign every cluster role and every project role.
- The author of the plan that created a project assigns every role in that project, like a cluster admin.
- Project admins assign `operator`, `developer` and `viewer`. They can't make someone an admin, and can't change or remove another admin.

```bash
curl -X PUT https://<control-plane>/api/projects/shop/members/<userId> \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"role": "developer"}'
```

`DELETE` on the same path removes the member. Cluster roles work the same way under `/api/cluster/members/<userId>` (cluster admins only).

## Approvals

Each project sets an **approval mode** (`PUT /api/projects/{project}/settings`, project admins):

| Mode                   | Needs an approval                                                      |
| ---------------------- | ---------------------------------------------------------------------- |
| `developers` (default) | Plans by developers (or anyone below operator)                         |
| `risky`                | Plans by developers, and every plan whose part in the project is risky |
| `everyone`             | Every plan (four-eyes)                                                 |

- A project's part of a plan is **risky** when it has unacknowledged pins, a policy to or from `internet`, or creates / changes a deployment that publishes hostnames or ports. The plan lists the reasons per project in `risk`.
- What counts is the author's role in each project when the plan was made (`creatorRoles` in the plan).
- `POST /api/plans/{id}/approve` approves the plan for every touched project where the caller is operator or admin and isn't the author. The plan's `approvals` list who approved for which project.
- An approval belongs to exactly that plan, not to its author or its content: a new plan needs a new approval.
- Until every project that needs it has an approval (and every cross-project policy is accepted), apply answers `409` with the reasons:

```json
{
  "message": "The plan cannot be applied yet",
  "blockers": ["project shop needs an approval from an operator or admin who didn't create the plan"]
}
```

Once approved, anyone who may apply the plan (developers included) applies it.

## Cross-project policies

A project's policy can reach another project's workload group, like VPC peering:

```yaml
apiVersion: loadweaver.com/v1
kind: WorkloadGroup
metadata: { name: api, project: billing }
spec:
  selector: { app: api }
  exposed: true # other projects may request access
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: shop-to-billing, project: shop }
spec:
  from: [{ group: web }]
  to: [{ group: api, project: billing }]
  rules: [{ protocol: tcp, ports: [443] }]
```

- The other project's group must exist and be `exposed`, or the plan is rejected.
- The other project has to **accept** the policy before it's applied. `GET /api/projects/{project}/requests` shows what's asked of it: policies from pending plans (with `planId`) and applied ones (`planId: null`), each with its `specHash` and whether it's `accepted`.
- Its operators and admins accept with `POST /api/projects/{project}/acceptances` and `{ "project": "shop", "policy": "shop-to-billing", "specHash": "<hash>" }`. The acceptance is bound to that exact policy spec; any change to the policy needs a new one.
- Someone who is operator or admin in both projects applies the policy directly, without an acceptance.

## Quotas

Cluster admins set limits in the `Project` resource. Unset fields are unlimited.

```yaml
apiVersion: loadweaver.com/v1
kind: Project
metadata: { name: shop }
spec:
  quota:
    cpu: '8' # requested CPUs of all replicas
    memory: 16g # requested memory of all replicas
    storage: 200g # volume sizes
    publicIps: 2 # egress addresses
    ports: 4 # published ports
    virtualMachines: 5 # VirtualMachine resources
    vmVcpus: 16 # vCPUs of running VMs
    vmMemory: 32g # memory of running VMs
    vmDiskBytes: 1t # disk sizes of all VMs
```

| Field             | What counts                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `cpu`             | Each service's requested CPUs (`deploy.resources.reservations`, otherwise the project's `defaults`) × replicas |
| `memory`          | Same for memory                                                                                                |
| `storage`         | The size of every volume, counted once (not per replica)                                                       |
| `publicIps`       | One per pool in `egress.pools` of every project policy                                                         |
| `ports`           | Every entry in a service's compose `ports` (once per service, not per replica)                                 |
| `virtualMachines` | Every [`VirtualMachine`](./virtual-machines.md) of the project, running or not                                 |
| `vmVcpus`         | `cpu.vcpus` of the running VMs                                                                                 |
| `vmMemory`        | `memory` of the running VMs                                                                                    |
| `vmDiskBytes`     | The size of every VM disk, counted once (not per copy), running or not                                         |

- [MicroVM](./isolation-levels.md#microvms) services and running [virtual machines](./virtual-machines.md#quotas) count their guest size plus the launcher's overhead (384 MiB memory, 0.25 CPU per replica or VM) into `cpu` and `memory`; VM disks count into `storage`. Starting a `Manual` VM through the API is checked against the quotas like a plan.

- The desired state after the plan is judged, for every project the plan touches. A plan over a quota is rejected, with the usage and the limit in the message.
- Lowering a quota below the current usage is rejected too, because the plan touches the project.

**Device access** is an admin-only allowance in the same resource: `spec.workloads.allowedDevices: ['/dev/kvm']` lets the project's `runc` services use compose `devices` for `/dev/kvm` (the only device on the allow-list; it lets a workload run its own VMs and pins it for migration). Without it, a plan using the device fails with a policy error. See [Isolation levels](./isolation-levels.md#devices-devkvm).

`spec.billing.decabillSubscriptionId` maps the project to a Decabill subscription that its [metered usage](./usage-metering.md) is billed on (cluster admins, like quotas).

## IP pools per project

An `IpPool` can name the projects whose policies may take egress addresses from it:

```yaml
apiVersion: loadweaver.com/v1
kind: IpPool
metadata: { name: egress-v4 }
spec:
  # …
  projects: [shop, billing] # unset: every project
```

A plan with a project policy using a pool its project isn't listed in is rejected. The check runs for the projects a plan touches, so policies already using a pool are checked the next time their project changes.

## Who sees what

- Cluster-level resources: anyone with a cluster role.
- Project resources and plans: the project's members, cluster admins, auditors and infra operators (they manage the nodes the project runs on). A cluster infra-operator role alone doesn't grant access to the project's logs or secrets.
- Secret writes and deletes: project admins and operators, plus cluster admins; developers, viewers and non-members receive `403`. Infra operators must also hold an allowed project role. Platform-reserved `lw-` names require a cluster admin. PATs need `secrets:write` and never exceed their owner's effective roles. Values remain unreadable through the API; changes are audited without values. See [secrets and encryption](./secrets-and-encryption.md).
- A plan is visible to whoever may read everything it touches. Others get `404`, as for resources they can't read.
- Lists (`GET /api/resources`, `GET /api/resources/export`, `GET /api/plans`) only contain what the caller may read.
- Members, settings and requests of a project: whoever may read the project. Cluster members: anyone with a cluster role.

`GET /api/access/me` tells callers who they are here: their user id (`null` for the static API key), their cluster role (or `null`) and their role in each project they are a member of. The console builds its navigation from it, and `loadweaver whoami` prints it. Scope `cluster:read`.

```bash
curl -s https://cp.example.com/api/access/me -H "Authorization: Bearer $TOKEN"
# {"userId":"6c1f3e1a-2b9d-4c55-9a43-0f6d2e8b7a10","clusterRole":null,"projects":{"shop":"developer","billing":"viewer"}}
```

## Terminal settings

Two more project settings, changed the same way (`PUT /api/projects/{project}/settings`, project admins) and audited as `project.settings`:

| Setting           | Default | Effect                                                                                                                                         |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `developerExec`   | `false` | Developers may open terminals in the project's replicas and use the file browser on its replicas and volumes (operators and admins always may) |
| `recordTerminals` | `false` | Terminal sessions in the project's replicas are recorded, even when the `Cluster`'s `terminalRecording` is `off`                               |

```bash
curl -s -X PUT https://cp.example.com/api/projects/shop/settings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"developerExec": true, "recordTerminals": true}'
```

See [Terminals, files and tunnels](./terminals-files-and-tunnels.md).

## Export and import

Cluster admins keep access as YAML, for documentation and setup:

```yaml
clusterMembers:
  - { userId: 6c1f3e1a-2b9d-4c55-9a43-0f6d2e8b7a10, role: infra-operator }
  - { userId: 9e2b7c44-1d3a-4f0e-8b6c-5a7d9e0f1c22, role: auditor }
projects:
  - name: shop
    approvalMode: risky
    developerExec: false
    recordTerminals: false
    members:
      - { userId: alice, role: admin }
      - { userId: bob, role: developer }
```

- `GET /api/access/export` returns every cluster member and every project with its settings and members.
- `POST /api/access/import` with `{ "yaml": "<document>" }` (up to 1 MiB) makes access match the document:
  - `clusterMembers`: when the list isn't empty, cluster members become exactly the list. An empty or missing list leaves them as they are.
  - Every listed project must exist. Its `approvalMode`, `developerExec` and `recordTerminals` are set (missing: `developers`, `false` and `false`), and its members become exactly `members`: a missing list removes everyone.
  - Projects not in the document stay as they are.
- The import runs in one transaction: an error changes nothing. Unknown keys and YAML aliases are rejected. The answer `{ "changed": n }` counts added, changed and removed memberships.
- Global admins aren't in the document: they are cluster admins through their identity role.

## Audit

Every access change is audited: `cluster.member.set` / `remove`, `project.member.set` / `remove`, `project.settings`, `project.policy.accept`, `plan.approve` and `access.import`.

## Scopes

Personal access tokens need `projects:admin` to change members, settings and acceptances, `live:access` for the file browser and VM power actions, `live:exec` for [machine exec](./terminals-files-and-tunnels.md#machine-exec), `plans:approve` to approve plans, and `cluster:admin` for cluster members and access export / import. Reads need `projects:read` (project members, settings, requests) or `cluster:read` (cluster members, `GET /api/access/me`).
