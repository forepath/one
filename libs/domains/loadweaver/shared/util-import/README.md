# loadweaver-shared-util-import

Import of existing Docker hosts and former nodes (3.21), pure and shared by the control plane, the console preview and
the labs:

- `discoveredItems(report)`: the units the import wizard decides on (compose projects, standalone containers) with
  their ports and mounts;
- `resolveConflicts(report, cluster, freed)`: ports (reserved WireGuard ports, freed by the import, fixed node ports),
  pre-existing tunnels, interface names, subnets overlapping the cluster's pools — resolved or refused with a reason;
- `classifyFormer(report, cluster)`: a former Loadweaver installation — same cluster (reusable / discarded DRBD
  replicas) or another cluster (identity wipe required);
- `buildJoinPlan(report, selections, cluster)`: the one join plan — deployments (compose with ingress routes /
  forwards, replicated volumes, node pinning) and ordered steps (components, wipe / reuse, activate, rsync pre-copy,
  stop, final pass, release, verify, handover).

## Running unit tests

Run `nx test loadweaver-shared-util-import` to execute the unit tests via [Jest](https://jestjs.io).
