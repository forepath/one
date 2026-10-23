import {
  drainImportNote,
  holdVmImports,
  importProgressText,
  vmImportHolds,
  type VmImportHold,
} from './vm-import-hold.utils';

const MiB = 1024 * 1024;

const row = (id: string, node: string, phase?: string, extra: Record<string, unknown> = {}) => {
  const [project, deployment, service] = id.split('/');

  return {
    id,
    project,
    deployment,
    service,
    node,
    cronRun: null,
    drainUntil: null,
    status: {
      [node]: {
        state: 'pending',
        specHash: 'h',
        at: '2026-10-23T00:00:00Z',
        ...(phase ? { vm: { importing: true, importProgress: { phase, bytes: 3 * MiB, totalBytes: 8 * MiB } } } : {}),
      },
    },
    ...extra,
  };
};

describe('vmImportHolds', () => {
  it('holds VM replicas with an active import on a reachable node only', () => {
    const holds = vmImportHolds(
      [
        row('shop/lw-vm/a/0', 'n1', 'queued'),
        row('shop/lw-vm/b/0', 'n1', 'fetching'),
        row('shop/lw-vm/c/0', 'n1', 'writing'),
        row('shop/lw-vm/d/0', 'n1', 'failed'),
        row('shop/lw-vm/e/0', 'n1'),
        row('shop/lw-vm/f/0', 'n2', 'writing'),
        row('shop/lw-vm/g/0', 'n1', 'writing', { drainUntil: new Date() }),
        // Not a VM deployment: a compose service never holds.
        row('shop/store/web/0', 'n1', 'writing'),
      ],
      new Set(['n1']),
    );

    expect([...holds.keys()]).toEqual(['shop/lw-vm/a/0', 'shop/lw-vm/b/0', 'shop/lw-vm/c/0']);
    expect(holds.get('shop/lw-vm/c/0')).toEqual({
      replica: 'shop/lw-vm/c/0',
      service: 'shop/lw-vm/c',
      project: 'shop',
      vm: 'c',
      node: 'n1',
      phase: 'writing',
      bytes: 3 * MiB,
      totalBytes: 8 * MiB,
    });
  });

  it('formats the progress', () => {
    expect(importProgressText({ phase: 'queued' })).toBe('queued');
    expect(importProgressText({ phase: 'fetching', bytes: 100 * MiB })).toBe('fetching, 100 MiB');
    expect(importProgressText({ phase: 'writing', bytes: 512 * MiB, totalBytes: 2048 * MiB })).toBe(
      'writing, 512 MiB of 2048 MiB',
    );
  });

  it('notes importing VMs in the leave refusal', () => {
    expect(drainImportNote([row('shop/lw-vm/a/0', 'n1', 'writing')], 'n1')).toBe(
      '; the drain waits: virtual machine shop/a is waiting for the boot-disk import on n1 (writing, 3 MiB of 8 MiB)',
    );
    expect(drainImportNote([row('shop/lw-vm/a/0', 'n1')], 'n1')).toBe('');
  });
});

describe('holdVmImports', () => {
  const hold: VmImportHold = {
    replica: 'shop/lw-vm/a/0',
    service: 'shop/lw-vm/a',
    project: 'shop',
    vm: 'a',
    node: 'n1',
    phase: 'writing',
  };
  const current = { volumes: [{ volume: 'shop/lw-vm/a.root', primary: 'n1', syncReplicas: [], remoteReplicas: [] }] };
  const owners = new Map([['shop/lw-vm/a.root', 'shop/lw-vm/a']]);

  it('keeps a held replica and its volumes where they are; others move', () => {
    const { schedule, held } = holdVmImports(
      {
        replicas: [
          { service: 'shop/lw-vm/a', replica: 'shop/lw-vm/a/0', node: 'n2' },
          { service: 'shop/store/web', replica: 'shop/store/web/0', node: 'n2' },
        ],
        volumes: [{ volume: 'shop/lw-vm/a.root', primary: 'n2', syncReplicas: [], remoteReplicas: [] }],
        unschedulable: [],
        allocated: {},
      },
      current,
      new Map([[hold.replica, hold]]),
      owners,
    );

    expect(schedule.replicas.map((r) => r.node)).toEqual(['n1', 'n2']);
    expect(schedule.volumes[0].primary).toBe('n1');
    expect(held).toEqual([{ hold, to: 'n2' }]);
  });

  it('keeps an unschedulable held replica in place (per replica or whole service)', () => {
    for (const entry of [
      { service: 'shop/lw-vm/a', replica: 'shop/lw-vm/a/0', reason: 'x' },
      { service: 'shop/lw-vm/a', reason: 'no eligible node' },
    ]) {
      const { schedule, held } = holdVmImports(
        {
          replicas: [],
          volumes: [],
          unschedulable: [entry, { service: 'shop/store/web', reason: 'y' }],
          allocated: {},
        },
        current,
        new Map([[hold.replica, hold]]),
        owners,
      );

      expect(schedule.replicas).toEqual([{ service: 'shop/lw-vm/a', replica: 'shop/lw-vm/a/0', node: 'n1' }]);
      expect(schedule.unschedulable).toEqual([{ service: 'shop/store/web', reason: 'y' }]);
      expect(held).toEqual([{ hold, to: null }]);
    }
  });
});
