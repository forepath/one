import { assignDrbdNodeIds, drbd9Capability, volumeNodeWarnings } from './drbd-volumes.utils';

describe('assignDrbdNodeIds', () => {
  it('keeps ids across role changes and gives new holders fresh ones round robin', () => {
    const first = assignDrbdNodeIds(['a1', 'a2', 'b1'], {}, 0);

    expect(first).toEqual({ ids: { a1: 0, a2: 1, b1: 2 }, next: 3 });
    // Failover: a2 becomes primary, nothing is renumbered.
    expect(assignDrbdNodeIds(['a2', 'a1', 'b1'], first.ids, first.next)).toEqual(first);

    // b1's replica moves to c1: c1 doesn't inherit b1's id (its slot is being forgotten on the others).
    const moved = assignDrbdNodeIds(['a1', 'a2', 'c1'], first.ids, first.next);

    expect(moved).toEqual({ ids: { a1: 0, a2: 1, c1: 3 }, next: 4 });
  });

  it('wraps around at 31 and skips ids in use', () => {
    expect(assignDrbdNodeIds(['a1', 'x'], { a1: 0 }, 31)).toEqual({ ids: { a1: 0, x: 31 }, next: 0 });
    expect(assignDrbdNodeIds(['a1', 'x'], { a1: 0 }, 32)).toEqual({ ids: { a1: 0, x: 1 }, next: 2 });
  });
});

describe('volume node warnings', () => {
  const node = (name: string, capabilities: Record<string, unknown> | null, hostname: string | null = name) => ({
    name,
    hostname,
    capabilities,
  });

  it('reads the drbd9 capability', () => {
    expect(drbd9Capability(node('a', { drbd9: true }))).toBe(true);
    expect(drbd9Capability(node('a', { drbd9: false }))).toBe(false);
    expect(drbd9Capability(node('a', { drbd: true }))).toBeUndefined();
    expect(drbd9Capability(node('a', null))).toBeUndefined();
  });

  it('warns about nodes without DRBD 9 and holders of older agents, only when there are volumes', () => {
    const nodes = [
      node('a1', { drbd9: true }),
      node('a2', { drbd9: false }),
      node('b1', { drbd: true }, null),
      node('c1', {}, null),
    ];

    expect(volumeNodeWarnings(nodes, new Set(['a1', 'b1']), false)).toEqual([]);
    expect(volumeNodeWarnings(nodes, new Set(['a1', 'b1']), true).map((w) => w.message)).toEqual([
      'node a2 has no DRBD 9 kernel module (capability drbd9); it gets no volume replicas',
      "node b1 doesn't report DRBD 9 support (older agent); volume replicas are placed there assuming the module is present",
      "node b1 didn't report its host name (older agent); its DRBD configuration uses the node name, which must equal the host's `uname -n`",
    ]);
  });
});
