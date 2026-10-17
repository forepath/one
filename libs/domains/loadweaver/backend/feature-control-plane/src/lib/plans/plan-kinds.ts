/** Changes to these kinds change what the network compiler produces (they need a recompile). */
export const NETWORK_KINDS = new Set([
  'NodeGroup',
  'WorkloadGroup',
  'Policy',
  'Cluster',
  'Node',
  'Deployment',
  'Project',
  'IpPool',
  'DnsProvider',
  'DnsZone',
  'DnsRecord',
  // Probes, answers and steering views (3.28); site locations steer by latency.
  'DnsFailover',
  'Site',
  // Vulnerability limits are part of the nodes' workload specs (3.22).
  'ImagePolicy',
  // Remote access client groups (3.31).
  'ClientGroup',
  'AutonomousSystem',
  'BgpPeer',
  'BgpAnnouncement',
  // Status page hostnames are ingress sites (3.25).
  'StatusPage',
]);
/** Changes to these kinds can move public addresses (3.27). */
export const ADDRESS_KINDS = new Set(['Cluster', 'IpPool', 'DnsProvider', 'Policy']);
/** Changes to these kinds can move workloads (3.11). */
/** `NodeImport` makes a pending node schedulable for its imported deployments (3.21). */
/**
 * `Policy` / `WorkloadGroup` steer sources with per-source egress settings older agents can't apply (M6 gate): a plan
 * that only adds such a policy must still run the workload planner (refusal / "stays on node" warnings).
 */
export const WORKLOAD_KINDS = new Set([
  'Deployment',
  'Project',
  'Node',
  'Cluster',
  'NodeImport',
  'Policy',
  'WorkloadGroup',
]);
