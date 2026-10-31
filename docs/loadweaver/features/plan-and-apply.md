# Plan and Apply

Every declarative change goes through a **plan** that is reviewed and then **applied**.

1. Submit resources as a multi-document YAML bundle (`POST /api/plans`, `documents`) and optionally resources to delete.
2. The plan lists every resource change (`create`, `update`, `delete`, `unchanged`) and the compiled effect on every network layer, for example `adds WireGuard peer n1↔n3` or `exports 10.88.1.0/24 from n1 to n2`.
3. `POST /api/plans/{id}/apply` [locks](#locks) the resources the plan touches and writes the new desired state. If any of them changed since the plan was created, the apply is refused (`409`) and a new plan is needed.
4. The nodes then pick up the change. The plan stays `applying` until they report it, and ends `applied`, or `rolled-back` if something failed (see [Tracked applies](#tracked-applies)).

The change and its audit entry are written in the same transaction.

## Who may plan and apply

- Cluster-level resources need the `infra-operator` role, `Cluster` and `Project` resources `cluster-admin`; project resources need at least `developer` in every project the plan changes.
- Depending on the project's approval mode, a plan needs an approval (`POST /api/plans/{id}/approve`) from an operator or admin of the project who didn't create it. Policies reaching another project's groups need that project's acceptance.
- Until then, apply answers `409` with the missing approvals and acceptances in `blockers`.
- Cancelling a running apply needs the same rights as applying it.

See [Projects and access](./projects-and-access.md).

## Locks

An apply locks exactly the resources the plan changes (kind, project, name). Resources the plan leaves `unchanged` are not locked.

- A plan that changes the `Cluster` resource takes the **cluster lock** instead. It conflicts with every other lock, and every other lock conflicts with it.
- If another plan holds one of the locks, apply answers `409` with `message` and the conflicting locks in `locks`, for example `Deployment/shop/web (plan <id>)`. Try again once that plan is done.
- Locks are released when the apply ends (`applied` or `rolled-back`). A [failed rollback](#failed-rollbacks) keeps them.

## Tracked applies

After the desired state is written, the network is compiled. Every node whose desired state moved past the revision before the apply has to report that it applied the new one.

- Nodes that are connected and sent a heartbeat in the last 30 seconds are expected to report. Other nodes are `skipped`; they catch up when they are back and don't block the apply.
- Apply waits up to 5 seconds. Quick applies come back settled (`applied`, `rolled-back`, …); longer ones come back `applying`. Follow them with `GET /api/plans/{id}` or the [live socket](#live-progress).
- If the control-plane replica tracking an apply stops, another replica takes over after 30 seconds.

### Statuses

| Status            | Meaning                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `pending`         | Planned, not applied yet                                                        |
| `applying`        | Written; waiting for the nodes to report                                        |
| `applied`         | Every expected node reported the new revision                                   |
| `rolling-back`    | A node failed, the apply timed out or was cancelled; the previous state returns |
| `rolled-back`     | The previous state is back on every expected node                               |
| `rollback-failed` | The rollback failed too; the locks stay until a fix-forward plan is applied     |
| `failed`          | A failed rollback that its fix-forward plan resolved                            |
| `discarded`       | Discarded without applying                                                      |

### Progress

While a plan applies or rolls back, `progress` on the plan shows:

- `phase`: `apply` or `rollback`.
- `step` and `percent`, for example `Applying: waiting for n1, n2`. The percentage is the share of nodes that are done; it stays at 99 or below until every node is done.
- `nodes`: per node `pending`, `applied`, `failed` or `skipped`, the status of each layer it reported (`steps`) and an `error` if it failed.
- `failure`: why the phase failed (the first failing node, `cancelled`, or a timeout). In the rollback phase, `cause` says why the apply was rolled back.

### Live progress

The Socket.IO namespace `socket/plans` (env `LOADWEAVER_PLANS_WEBSOCKET_NAMESPACE`) sends plans as they change. Authenticate with the same `Authorization` header as the REST API.

- On connect: `plansSnapshot` with up to 50 plans you may see that are `pending`, `applying`, `rolling-back` or `rollback-failed`.
- Then: `planPatch` with the whole plan each time one you may see changes (approvals, applies, progress, rollbacks).
- `approvals` is always empty on the socket; read them with `GET /api/plans/{id}`.

Every control-plane replica serves every plan.

## Rollback

A failed node, a timeout or a cancel rolls the apply back automatically:

- Every changed resource returns to its version before the apply. Created resources are removed.
- Deployments get their previous pinned images and secret versions back.
- The nodes then have to report the rollback the same way as an apply (`rolling-back` → `rolled-back`). The rollback has its own timeout.

### Failed rollbacks

If the rollback fails too, configuration and reality may differ. The plan becomes `rollback-failed`:

- It keeps its locks, so no other plan can build on the inconsistent state.
- A **fix-forward** plan is created first: the original target state again, planned against what is stored now, with the original author's roles. Its `resolves` field names the failed plan.
- Only the fix-forward may take over the failed plan's locks. Review and apply it like any plan. Once it is `applied`, the failed plan becomes `failed`.

Failed rollbacks also show up in [drift](#drift).

## Cancel

`POST /api/plans/{id}/cancel` stops an `applying` plan at the next safe point: between node reports, never in the middle of an apply on a node. The plan then rolls back. Other statuses answer `409`. The call returns like apply: settled, or as it is after 5 seconds.

## Timeout

Nodes that haven't reported within `LOADWEAVER_APPLY_TIMEOUT_MS` (default 10 minutes, at least 10 seconds) fail with `no report within the apply timeout`, and the apply rolls back. A rollback that times out becomes `rollback-failed`.

## Drift

What Loadweaver owns heals by itself. What was changed outside Loadweaver is reported, never overwritten or adopted silently.

`GET /api/drift` (any cluster role) lists:

- `containers`: foreign containers on the nodes, i.e. containers Loadweaver doesn't manage (for example from `docker run`), with image, state and published ports. Nodes report them with every heartbeat and never touch them.
- `delegated`: containers a workload started itself through the node's Docker socket, with `delegatedTo` (the replica). A service that binds `/var/run/docker.sock` (an acknowledged pin) declares the label prefixes of the containers it starts in its label `loadweaver.com/delegates` (comma-separated, for example `io.agenstra.` for Agenstra's agent manager on its Docker runtime); foreign containers with such a label on the same node are that replica's, not drift. They can't be turned into a plan.
- `inconsistent`: plans in `rollback-failed`, their error, and their pending fix-forward plan.
- `gitAhead`: Git scopes whose default branch is ahead of the cluster: the plan of the branch head isn't applied (pending, failed, discarded) or the push was rejected. See [GitOps](./gitops.md#default-branch-ahead-of-cluster).

`POST /api/drift/plans` with `node`, `container`, `project` and `deployment` turns a foreign container into a proposed plan: a `Deployment` with the same image and published ports. Environment and volumes are not copied (they may hold secrets and host paths). The plan is a normal plan: review it, add what is missing, and apply it with the usual rights. Loadweaver never removes the foreign container; do that yourself. In a scope connected to Git, the plan becomes a pull request (authoritative) or is committed back after the apply (bidirectional), see [GitOps](./gitops.md).

Every plan has a `source`: `git` (with `connection`, `commit`, `ref`, `author`), `ui`, `api`, `drift` or `system` (fix-forward plans).

## Rules

- The `Cluster` resource can only be updated, never created or deleted.
- `Node` resources hold the declarative part of joined nodes (site, labels, cordon); nodes themselves join with tokens and leave through drain / leave.
- Sites that still have nodes can't be deleted.
- YAML bundles are limited to 2 MiB; aliases are capped and duplicate keys are rejected.

## Export

`GET /api/resources/export` returns the whole desired state as one YAML bundle, the same format the console and Git use.
