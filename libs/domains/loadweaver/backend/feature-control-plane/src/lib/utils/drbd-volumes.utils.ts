/** DRBD node ids are 0–31 (`node-id` in the resource file, kept in each replica's metadata). */
export const DRBD_MAX_NODE_ID = 31;

/**
 * Stable DRBD node ids for a volume's replica holders (3.5). Nodes keep their id for as long as they hold a copy
 * (failover and migration only change roles); new holders get the next id round robin, skipping ids in use, so the
 * id of a peer that just left isn't handed to its successor while the remaining replicas still forget its bitmap
 * slot (`drbdsetup forget-peer`).
 */
export function assignDrbdNodeIds(
  holders: readonly string[],
  previous: Readonly<Record<string, number>>,
  next: number,
): { ids: Record<string, number>; next: number } {
  const ids: Record<string, number> = {};

  for (const holder of holders) if (previous[holder] !== undefined) ids[holder] = previous[holder];

  const used = new Set(Object.values(ids));
  let cursor = ((next % (DRBD_MAX_NODE_ID + 1)) + DRBD_MAX_NODE_ID + 1) % (DRBD_MAX_NODE_ID + 1);

  for (const holder of holders) {
    if (ids[holder] !== undefined) continue;

    while (used.has(cursor)) cursor = (cursor + 1) % (DRBD_MAX_NODE_ID + 1);

    ids[holder] = cursor;
    used.add(cursor);
    cursor = (cursor + 1) % (DRBD_MAX_NODE_ID + 1);
  }

  return { ids, next: cursor };
}

/** The node facts the volume part of the desired state and the volume placement need. */
export interface DrbdNodeFacts {
  name: string;
  hostname: string | null;
  capabilities: Record<string, unknown> | null;
}

/**
 * Whether a node can hold volume replicas: `drbd9` from its hello; `undefined` for agents that don't report it yet
 * (treated as capable, with a plan warning).
 */
export function drbd9Capability(node: Pick<DrbdNodeFacts, 'capabilities'>): boolean | undefined {
  const value = node.capabilities?.['drbd9'];

  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Plan warnings about the nodes' volume support (3.5): nodes without the DRBD 9 module get no replicas, nodes whose
 * agent doesn't report it yet or that didn't report their host name hold replicas on assumptions.
 */
export function volumeNodeWarnings(
  nodes: readonly DrbdNodeFacts[],
  volumeHolders: ReadonlySet<string>,
  hasVolumes: boolean,
): { level: 'warning'; path: string; message: string }[] {
  if (!hasVolumes) return [];

  const warnings: { level: 'warning'; path: string; message: string }[] = [];

  for (const node of nodes) {
    const drbd9 = drbd9Capability(node);

    if (drbd9 === false)
      warnings.push({
        level: 'warning',
        path: `nodes/${node.name}`,
        message: `node ${node.name} has no DRBD 9 kernel module (capability drbd9); it gets no volume replicas`,
      });
    else if (drbd9 === undefined && volumeHolders.has(node.name))
      warnings.push({
        level: 'warning',
        path: `nodes/${node.name}`,
        message: `node ${node.name} doesn't report DRBD 9 support (older agent); volume replicas are placed there assuming the module is present`,
      });

    if (!node.hostname && volumeHolders.has(node.name))
      warnings.push({
        level: 'warning',
        path: `nodes/${node.name}`,
        message: `node ${node.name} didn't report its host name (older agent); its DRBD configuration uses the node name, which must equal the host's \`uname -n\``,
      });
  }

  return warnings;
}
