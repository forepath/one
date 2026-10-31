import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

import { runningCopies, withMigrationHints } from './network-state.service';
import { podSubnetsOf, reservedAddresses } from './workload-planner.service';

const subnets = podSubnetsOf([
  { name: 'n1', podSubnetV4: '10.88.0.0/24', podSubnetV6: null },
  { name: 'n2', podSubnetV4: '10.88.1.0/24', podSubnetV6: null },
]);
const placement = (extra: Record<string, unknown> = {}) => ({
  id: 'p/d/web/0',
  node: 'n2',
  addresses: ['10.88.0.10'],
  targetNode: null,
  targetAddresses: [],
  cronRun: null,
  ...extra,
});

describe('kept addresses in allocation (3.10)', () => {
  it('reserves an address kept by a live-migrated replica on the node whose subnet it belongs to', () => {
    // The replica runs on n2 with an address of n1's subnet: n1 must never hand it out again.
    const reserved = reservedAddresses([placement()], new Set(['p/d/web/0']), subnets);

    expect(reserved.get('n1')).toEqual(['10.88.0.10']);
    expect(reserved.get('n2')).toBeUndefined();
    // Without subnets (old callers) nothing changes.
    expect(reservedAddresses([placement()], new Set(['p/d/web/0'])).size).toBe(0);
    // Addresses of the node's own subnet are not "kept".
    expect(reservedAddresses([placement({ node: 'n1' })], new Set(['p/d/web/0']), subnets).get('n1')).toBeUndefined();
  });
});

describe('running copies during migrations (3.10)', () => {
  const migrating = (method: string, phase: string) =>
    runningCopies({
      id: 'p/d/web/0',
      node: 'n1',
      addresses: ['10.88.0.10'],
      targetNode: 'n2',
      targetAddresses: method === 'live' ? ['10.88.0.10'] : ['10.88.1.10'],
      migration: { method, phase, reason: 'plan', startedAt: 'x' } as never,
    }).map((c) => c.node);

  it('runs only the source while queued or checkpointing, both ends during blue / green', () => {
    expect(migrating('blue-green', 'starting')).toEqual(['n1', 'n2']);
    expect(migrating('blue-green', 'queued')).toEqual(['n1']);
    expect(migrating('short-stop', 'stopping')).toEqual([]);
    expect(migrating('short-stop', 'queued')).toEqual(['n1']);

    for (const phase of ['prepare', 'precopy', 'freeze', 'transfer', 'restore', 'aborting'])
      expect(migrating('live', phase)).toEqual(['n1']);
  });

  it('marks restored replicas and their kept addresses in the desired state', () => {
    const spec = { id: 'p/d/web/0', addresses: ['10.88.0.10'] } as WorkloadSpec;
    const restored = { migration: '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', runtime: 'runc' as const };

    expect(withMigrationHints(spec, { ...placement(), restored }, 'n2', subnets)).toEqual({
      ...spec,
      restoredFrom: restored,
      hostRoutes: ['10.88.0.10/32'],
    });
    // Back on its own subnet: plain spec.
    expect(withMigrationHints(spec, placement({ node: 'n1' }), 'n1', subnets)).toEqual(spec);
  });
});
