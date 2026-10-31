/** What the control plane knows about one etcd voter (a member or the voting witness, 3.2). */
export interface EtcdVoterState {
  name: string;
  witness: boolean;
  /** An agent stream is open. */
  connected: boolean;
  /** The agent reported its etcd state since it last connected (`heartbeat.etcd`). */
  reported: boolean;
  /** The agent reported a non-empty etcd data directory (kept while it is offline). */
  holdsData: boolean;
  /** Told to bootstrap and hasn't reported data since (persisted: it may have started etcd before going offline). */
  assigned?: boolean;
}

export interface EtcdBootstrap {
  /** The one member that starts a new etcd cluster of itself, if any. */
  bootstrapper: string | null;
  /** Voters an empty member joins through, sorted. */
  peers: string[];
}

/**
 * Split-brain-safe etcd bootstrap (3.43): members bootstrap with any number of nodes up, but never twice.
 * - Some voter holds etcd data: nobody bootstraps; empty members join through the holders.
 * - No voter does: exactly one connected member bootstraps, the first by name. Offline voters that never reported
 *   data count as empty (they join the new cluster when they come up).
 * - A connected voter whose state is unknown (reconnected, no report yet, or an agent without `etcd-bootstrap`) may
 *   hold data: nobody bootstraps until it reported, and it is a peer to join through.
 */
export function etcdBootstrap(voters: readonly EtcdVoterState[]): EtcdBootstrap {
  const unknown = voters.filter((v) => v.connected && !v.reported && !v.holdsData);
  const assigned = voters.filter((v) => v.assigned && !v.holdsData);
  const peers = voters
    .filter((v) => v.holdsData || unknown.includes(v) || assigned.includes(v))
    .map((v) => v.name)
    .sort();

  // An earlier assignment stands until that node holds data or leaves — also while it is offline (safety over
  // liveness: the others wait instead of starting a second cluster). It is its own bootstrapper; others join it.
  const kept = assigned.map((v) => v.name).sort()[0];

  if (kept && unknown.length === 0 && voters.every((v) => !v.holdsData)) return { bootstrapper: kept, peers };

  if (peers.length > 0) return { bootstrapper: null, peers };

  const first = voters
    .filter((v) => !v.witness && v.connected)
    .map((v) => v.name)
    .sort()[0];

  return { bootstrapper: first ?? null, peers };
}
