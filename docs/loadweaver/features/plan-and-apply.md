# Plan and Apply

Every declarative change goes through a **plan** that is reviewed and then **applied**.

1. Submit resources as a multi-document YAML bundle (`POST /api/plans`, `documents`) and optionally resources to delete.
2. The plan lists every resource change (`create`, `update`, `delete`, `unchanged`) and the compiled effect on every network layer, for example `adds WireGuard peer n1↔n3` or `exports 10.88.1.0/24 from n1 to n2`.
3. `POST /api/plans/{id}/apply` locks exactly the resources the plan touches. If any of them changed since the plan was created, the apply is refused (`409`) and a new plan is needed.

The change and its audit entry are written in the same transaction.

## Rules

- The `Cluster` resource can only be updated, never created or deleted.
- `Node` resources hold the declarative part of joined nodes (site, labels, cordon); nodes themselves join with tokens and leave through drain / leave.
- Sites that still have nodes can't be deleted.
- YAML bundles are limited to 2 MiB; aliases are capped and duplicate keys are rejected.

## Export

`GET /api/resources/export` returns the whole desired state as one YAML bundle, the same format the console and Git use.
