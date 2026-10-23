import { projectSpecSchema, virtualMachineSpecSchema } from '@forepath/loadweaver/shared/util-model';

import { vmDeployments, vmNicMac, vmUid } from './vm-planning.utils';
import { loadVmOperationalState } from './vm-power.utils';
import {
  vmActionRefusal,
  vmAvailableActions,
  vmConsoles,
  vmDiskStatus,
  vmNicStatus,
  vmPhase,
  vmShouldRun,
  vmSnapshotConsistency,
  vmSnapshotStatus,
  type VmPlacementView,
} from './vm-status.utils';

const spec = (overrides: Record<string, unknown> = {}) =>
  virtualMachineSpecSchema.parse({
    image: 'registry.lw/shop/debian:13',
    cpu: { vcpus: 2 },
    memory: '4Gi',
    disks: [
      { name: 'data', size: '100Gi' },
      { name: 'root', size: '20Gi', source: 'image', replicas: 2 },
    ],
    nics: [
      { name: 'eth0', groups: ['db'] },
      { name: 'data1', ipv6: false, labels: { net: 'storage' } },
    ],
    ...overrides,
  });

const placement = (state?: string, overrides: Partial<VmPlacementView> = {}): VmPlacementView => ({
  node: 'n1',
  addresses: ['10.20.1.5', 'fd00::5', '10.20.1.6'],
  targetNode: null,
  migration: null,
  drainUntil: null,
  status: state
    ? { n1: { state, at: '2026-10-23T10:00:00.000Z', message: state === 'pulling' ? 'importing disk' : undefined } }
    : null,
  ...overrides,
});

describe('VM status (3.35)', () => {
  it('runs per run strategy and operational power', () => {
    expect(vmShouldRun(spec(), 'stopped')).toBe(true);
    expect(vmShouldRun(spec({ runStrategy: 'Halted' }), undefined)).toBe(false);
    expect(vmShouldRun(spec({ runStrategy: 'Manual' }), undefined)).toBe(true);
    expect(vmShouldRun(spec({ runStrategy: 'Manual' }), 'stopped')).toBe(false);
  });

  it('derives the phase from placement and report', () => {
    expect(vmPhase(true, null)).toBe('Pending');
    expect(vmPhase(true, placement())).toBe('Pending');
    expect(vmPhase(true, placement('pulling'))).toBe('Importing');
    expect(vmPhase(true, placement('starting'))).toBe('Starting');
    expect(vmPhase(true, placement('running'))).toBe('Running');
    expect(vmPhase(true, placement('failed'))).toBe('Failed');
    expect(vmPhase(true, placement('running', { targetNode: 'n2' }))).toBe('Migrating');
    expect(vmPhase(false, null)).toBe('Stopped');
    expect(vmPhase(false, placement('running'))).toBe('Stopping');
    expect(vmPhase(true, placement('running', { drainUntil: new Date() }))).toBe('Stopping');
    expect(vmPhase(false, placement('exited'))).toBe('Stopped');
    // The guest's power (W9) wins over the container state.
    const guest = (vm: { power?: string; importing?: boolean }) =>
      placement(undefined, { status: { n1: { state: 'running', at: '2026-10-23T10:00:00.000Z', vm } } });

    expect(vmPhase(true, guest({ importing: true }))).toBe('Importing');
    // A failed background import (F3b): the node reports `failed` until its retry.
    expect(
      vmPhase(
        true,
        placement(undefined, {
          status: {
            n1: {
              state: 'failed',
              at: '2026-10-23T10:00:00.000Z',
              message: 'boot disk import failed: digest mismatch',
              vm: { importing: false, importProgress: { phase: 'failed' } },
            },
          },
        }),
      ),
    ).toBe('Failed');
    expect(vmPhase(true, guest({ power: 'shutting-down' }))).toBe('Stopping');
    expect(vmPhase(true, guest({ power: 'shut-off' }))).toBe('Stopped');
    expect(vmPhase(true, guest({ power: 'crashed' }))).toBe('Failed');
    expect(vmPhase(true, guest({ power: 'paused' }))).toBe('Running');
    expect(vmPhase(false, guest({ power: 'shut-off' }))).toBe('Stopped');
  });

  it('splits the addresses per NIC with stable MACs', () => {
    const nics = vmNicStatus('shop', 'db1', spec(), ['10.20.1.5', 'fd00::5', '10.20.1.6']);
    const uid = vmUid('shop', 'db1');

    expect(nics).toEqual([
      expect.objectContaining({
        name: 'eth0',
        primary: true,
        mac: vmNicMac(uid, 0, 'eth0'),
        groups: ['db'],
        families: ['v4', 'v6'],
        addresses: ['10.20.1.5', 'fd00::5'],
      }),
      expect.objectContaining({
        name: 'data1',
        primary: false,
        labels: { net: 'storage' },
        families: ['v4'],
        addresses: ['10.20.1.6'],
      }),
    ]);
    expect(vmNicStatus('shop', 'db1', spec(), [])[1].addresses).toEqual([]);
  });

  it('lists the boot disk first with its volume placement', () => {
    const disks = vmDiskStatus('shop', 'db1', spec(), [
      { id: 'shop/lw-vm/db1.root', primaryNode: 'n1', syncReplicas: ['n2'], remoteReplicas: [], crossSite: 'none' },
    ]);

    expect(disks.map((d) => [d.name, d.boot, d.volume, d.primaryNode])).toEqual([
      ['root', true, 'shop/lw-vm/db1.root', 'n1'],
      ['data', false, 'shop/lw-vm/db1.data', null],
    ]);
    expect(disks[0]).toMatchObject({ sizeBytes: 20 * 1024 ** 3, replicas: 2, syncReplicas: ['n2'], crossSite: 'none' });
  });

  it('offers consoles on running VMs of nodes with vm-consoles, VNC only with a graphical console', () => {
    const node = { name: 'n1', connected: true, protocolFeatures: ['vm-consoles'] };

    expect(vmConsoles(spec(), 'Running', node, true)).toEqual({
      serial: { available: true },
      vnc: { available: true },
    });
    expect(vmConsoles(spec({ console: { graphical: false } }), 'Running', node, true).vnc.available).toBe(false);
    expect(vmConsoles(spec(), 'Stopped', node, true).serial.reason).toContain('not running');
    expect(vmConsoles(spec(), 'Running', { ...node, protocolFeatures: [] }, true).serial.reason).toContain(
      'does not support VM consoles',
    );
    expect(vmConsoles(spec(), 'Running', { ...node, connected: false }, true).serial.available).toBe(false);
    expect(vmConsoles(spec(), 'Running', node, false).serial.reason).toContain('role');
  });

  it('allows power changes for Manual VMs only and guest actions while running', () => {
    expect(vmAvailableActions(spec(), 'Running', undefined)).toEqual(['reboot', 'reset']);
    expect(vmAvailableActions(spec({ runStrategy: 'Manual' }), 'Running', undefined)).toEqual([
      'stop',
      'force-off',
      'shutdown',
      'reboot',
      'reset',
    ]);
    expect(vmAvailableActions(spec({ runStrategy: 'Manual' }), 'Stopped', 'stopped')).toEqual(['start', 'reimage']);
    expect(vmAvailableActions(spec({ runStrategy: 'Halted' }), 'Stopped', undefined)).toEqual(['reimage']);
    expect(vmActionRefusal('stop', spec(), 'Running', undefined)).toContain(
      'managed by the spec (runStrategy: Always)',
    );
    expect(vmActionRefusal('start', spec({ runStrategy: 'Manual' }), 'Running', undefined)).toBe(
      'the virtual machine is already running',
    );
    expect(vmActionRefusal('reimage', spec(), 'Running', undefined)).toContain('stop the virtual machine first');
    expect(vmActionRefusal('reboot', spec({ runStrategy: 'Manual' }), 'Stopped', 'stopped')).toContain('not running');
    expect(vmActionRefusal('reboot', spec(), 'Running', undefined)).toBeNull();
  });

  it('summarizes snapshots', () => {
    expect(vmSnapshotConsistency({ guestAgent: true })).toBe('application');
    expect(vmSnapshotConsistency(undefined)).toBe('crash');
    expect(vmSnapshotStatus(['succeeded', 'running'])).toBe('running');
    expect(vmSnapshotStatus(['succeeded', 'succeeded'])).toBe('succeeded');
    expect(vmSnapshotStatus(['succeeded', 'failed'])).toBe('partial');
    expect(vmSnapshotStatus(['failed'])).toBe('failed');
  });

  it('feeds the operational power and cloud-init generations into the planner', async () => {
    const rows = [
      { project: 'shop', name: 'a', desired: 'stopped', instanceGeneration: 1 },
      { project: 'shop', name: 'b', desired: 'running', instanceGeneration: 3 },
    ];
    const state = await loadVmOperationalState({ getRepository: () => ({ find: async () => rows }) } as never);

    expect(state.power).toEqual(new Map([['shop/a', 'stopped']]));
    expect(state.generations).toEqual(new Map([['shop/b', 3]]));
    expect(await loadVmOperationalState(undefined)).toEqual({ power: new Map(), generations: new Map() });

    const vm = {
      image: 'registry.lw/shop/d:1',
      cpu: { vcpus: 1 },
      memory: '1Gi',
      disks: [{ name: 'root', size: '10Gi', source: 'image' }],
      nics: [{ name: 'eth0' }],
      runStrategy: 'Manual',
    };
    const { parsed } = vmDeployments(
      [
        { project: 'shop', name: 'a', spec: vm },
        { project: 'shop', name: 'b', spec: vm },
      ],
      new Map([['shop', projectSpecSchema.parse({})]]),
      state.power,
      state.generations,
    );
    const vms = parsed[0].virtualMachines ?? {};

    expect(vms['a']).toMatchObject({ running: false });
    expect(vms['b']).toMatchObject({ running: true, instanceGeneration: 3 });
    expect(vms['a'].instanceGeneration).toBeUndefined();
  });
});
