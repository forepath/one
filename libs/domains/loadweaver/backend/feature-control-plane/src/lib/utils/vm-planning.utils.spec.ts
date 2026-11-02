import { workloadSpecSchema } from '@forepath/loadweaver/shared/util-agent-protocol';
import { projectSpecSchema } from '@forepath/loadweaver/shared/util-model';
import { schedule } from '@forepath/loadweaver/shared/util-scheduler';

import type { ImageInspection } from './microvm-planning.utils';
import {
  addressFamiliesOf,
  buildVmWorkloadSpec,
  vmBlockVolumes,
  vmDeployments,
  vmImageIssues,
  vmNicAddresses,
  vmNicMac,
  pinVmSecrets,
  vmSecretRefs,
  vmSecretVersionKey,
  vmUid,
  vmUsage,
} from './vm-planning.utils';
import {
  allocateWorkloadAddresses,
  buildWorkloadSpec,
  toSchedulerNodes,
  toSchedulerServices,
} from './workload-planning.utils';

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const sha = (c: string) => `sha256:${c.repeat(64)}`;
const LAUNCHER = 'ghcr.io/forepath/microvm-launcher:test';
const projects = new Map([['shop', projectSpecSchema.parse({})]]);

const DB1 = {
  image: 'registry.lw/shop/debian-13:20261017',
  cpu: { vcpus: 2 },
  memory: '4Gi',
  disks: [
    { name: 'data', size: '100Gi', source: 'blank', replicas: 3 },
    { name: 'root', size: '20Gi', source: 'image' },
  ],
  nics: [
    { name: 'eth0', groups: ['db'] },
    { name: 'mgmt', groups: ['admin'], labels: { zone: 'mgmt' }, ipv6: false },
  ],
  cloudInit: {
    userData: '#cloud-config\npassword: secret://shop/db1-pw\n',
    sshAuthorizedKeys: ['ssh-ed25519 AAAA test'],
  },
};

const vmImage: ImageInspection = {
  manifestDigest: sha('f'),
  platform: 'linux/amd64',
  platforms: [],
  labels: {},
  config: {},
  layers: [],
  vmImage: { arch: 'amd64', format: 'qcow2', layerDigest: sha('1'), virtualSize: 10 * GiB, firmware: ['uefi', 'bios'] },
};

function plan(spec: Record<string, unknown> = DB1, power = new Map<string, 'running' | 'stopped'>()) {
  return vmDeployments([{ project: 'shop', name: 'db1', labels: { app: 'db' }, spec }], projects, power);
}

const pinned = { images: { db1: `registry.lw/shop/debian-13:20261017@${sha('9')}` }, imageConfigs: { db1: vmImage } };

describe('VM planning (M7.3)', () => {
  it('derives a stable uuid and per-NIC MACs', () => {
    const uid = vmUid('shop', 'db1');

    expect(uid).toBe(vmUid('shop', 'db1'));
    expect(uid).not.toBe(vmUid('shop', 'db2'));
    expect(uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(vmNicMac(uid, 0, 'eth0')).toMatch(/^52:54:00(:[0-9a-f]{2}){3}$/);
    expect(vmNicMac(uid, 1, 'mgmt')).not.toBe(vmNicMac(uid, 0, 'eth0'));
  });

  it('plans VMs as the reserved deployment lw-vm with block disks', () => {
    const { parsed, issues } = plan();

    expect(issues).toEqual([]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ project: 'shop', name: 'lw-vm' });

    const [service] = toSchedulerServices(parsed);

    expect(service).toMatchObject({
      id: 'shop/lw-vm/db1',
      replicas: 1,
      runtime: 'microvm',
      virtualMachine: true,
      requests: { cpuMillis: 2250, memoryBytes: 4 * GiB + 384 * MiB },
      volumes: [
        { id: 'shop/lw-vm/db1.data', sizeBytes: 100 * GiB, replicas: 3, crossSite: 'async', mode: 'block' },
        { id: 'shop/lw-vm/db1.root', sizeBytes: 20 * GiB, replicas: 2, crossSite: 'async', mode: 'block' },
      ],
    });
    expect(service.needsKvmDevice).toBeUndefined();
    expect(service.requiredFeatures).toBeUndefined();
  });

  it('has no replica when halted or stopped through the API', () => {
    expect(toSchedulerServices(plan({ ...DB1, runStrategy: 'Halted' }).parsed)[0].replicas).toBe(0);
    expect(
      toSchedulerServices(plan({ ...DB1, runStrategy: 'Manual' }, new Map([['shop/db1', 'stopped']])).parsed)[0]
        .replicas,
    ).toBe(0);
    expect(toSchedulerServices(plan({ ...DB1, runStrategy: 'Manual' }).parsed)[0].replicas).toBe(1);
  });

  it('rejects invalid specs and unknown projects', () => {
    const { issues } = vmDeployments(
      [
        { project: 'shop', name: 'bad', spec: { ...DB1, memory: '1Mi' } },
        { project: 'nope', name: 'x', spec: DB1 },
      ],
      projects,
    );

    expect(issues).toEqual([
      expect.objectContaining({ project: 'nope', level: 'error', message: 'project nope does not exist' }),
      expect.objectContaining({ project: 'shop', level: 'error', message: expect.stringContaining('256Mi') }),
    ]);
  });

  it('only places VMs on VM-capable nodes whose agents have the VM features', () => {
    const base = {
      site: 's',
      labels: {},
      lifecycle: 'active' as const,
      witness: false,
      controlPlane: false,
      capacity: { cpuMillis: 16_000, memoryBytes: 64 * GiB, diskBytes: 1000 * GiB },
      reachable: true,
    };
    const nodes = toSchedulerNodes([
      { ...base, name: 'micro-only', runtimes: ['runc', 'microvm'], kvm: { usable: true, optOut: false } },
      {
        ...base,
        name: 'old-agent',
        runtimes: ['runc', 'microvm'],
        kvm: { usable: true, optOut: false },
        virtualMachines: true,
        features: ['isolation-ladder', 'microvm'],
      },
      {
        ...base,
        name: 'vm1',
        runtimes: ['runc', 'microvm'],
        kvm: { usable: true, optOut: false },
        virtualMachines: true,
      },
      {
        ...base,
        name: 'vm2',
        runtimes: ['runc', 'microvm'],
        kvm: { usable: true, optOut: false },
        virtualMachines: true,
      },
    ]);
    const result = schedule({ nodes, services: toSchedulerServices(plan().parsed) });

    expect(result.unschedulable).toEqual([]);
    expect(['vm1', 'vm2']).toContain(result.replicas[0].node);

    for (const v of result.volumes)
      for (const holder of [v.primary, ...v.syncReplicas]) expect(['vm1', 'vm2']).toContain(holder);
  });

  it('allocates one address per NIC and family and keeps them when a NIC is added', () => {
    const { parsed } = plan();
    const subnets = new Map([['n1', ['10.88.0.0/24', 'fd00:88::/80']]]);
    const placement = [{ service: 'shop/lw-vm/db1', replica: 'shop/lw-vm/db1/0', node: 'n1' }];
    const first = allocateWorkloadAddresses(placement, subnets, new Map(), new Map(), addressFamiliesOf(parsed));

    // eth0: v4 + v6, mgmt: v4 only.
    expect(first.get('shop/lw-vm/db1/0')).toEqual(['10.88.0.2', 'fd00:88::2', '10.88.0.3']);

    const vm = parsed[0].virtualMachines!['db1'];

    expect(vmNicAddresses(vm, first.get('shop/lw-vm/db1/0')!).map((n) => [n.nic.name, n.addresses])).toEqual([
      ['eth0', ['10.88.0.2', 'fd00:88::2']],
      ['mgmt', ['10.88.0.3']],
    ]);

    const more = plan({ ...DB1, nics: [...DB1.nics, { name: 'data1', ipv4: true, ipv6: true }] }).parsed;
    const again = allocateWorkloadAddresses(
      placement,
      subnets,
      new Map([['shop/lw-vm/db1/0', { node: 'n1', addresses: first.get('shop/lw-vm/db1/0')! }]]),
      new Map(),
      addressFamiliesOf(more),
    );

    expect(again.get('shop/lw-vm/db1/0')).toEqual(['10.88.0.2', 'fd00:88::2', '10.88.0.3', '10.88.0.4', 'fd00:88::3']);
  });

  it('compiles the vm field with every NIC, block disks (boot first) and the NoCloud seed', () => {
    const { parsed } = plan();
    const spec = buildWorkloadSpec(
      parsed[0],
      parsed[0].compose.services[0],
      0,
      ['10.88.0.2', 'fd00:88::2', '10.88.0.3'],
      'lw',
      { ...pinned, secretVersions: {} },
    );

    expect(workloadSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec).toMatchObject({
      id: 'shop/lw-vm/db1/0',
      kind: 'service',
      runtime: 'runc',
      isolation: 'microvm',
      addresses: ['10.88.0.2', 'fd00:88::2'],
      labels: expect.objectContaining({ app: 'db', 'loadweaver.com/vm': 'db1' }),
      vm: {
        uid: vmUid('shop', 'db1'),
        firmware: 'uefi',
        cpuModel: 'host-model',
        vcpus: 2,
        memoryMiB: 4096,
        disks: [
          { name: 'root', volume: 'shop/lw-vm/db1.root', bus: 'virtio', cache: 'none', boot: true },
          { name: 'data', volume: 'shop/lw-vm/db1.data', bus: 'virtio', cache: 'none', boot: false },
        ],
        image: { ref: pinned.images.db1, digest: sha('9'), format: 'qcow2', layerDigest: sha('1') },
        graphics: true,
        power: 'running',
      },
    });
    // The first NIC's addresses are the workload's own (W1 contract).
    expect(spec.vm?.nics.map((n) => [n.name, n.addresses])).toEqual([
      ['eth0', spec.addresses],
      ['mgmt', ['10.88.0.3']],
    ]);
    expect(spec).not.toHaveProperty('microvm');
    expect(spec.vm?.cloudInit?.secretRefs).toEqual(['secret://shop/db1-pw']);
    expect(JSON.parse(spec.vm?.cloudInit?.metaData ?? '{}')).toEqual({
      'instance-id': `${vmUid('shop', 'db1')}-1`,
      'local-hostname': 'db1',
      'public-keys': ['ssh-ed25519 AAAA test'],
    });

    const network = JSON.parse(spec.vm?.cloudInit?.networkConfig ?? '{}');

    expect(network.ethernets.eth0).toMatchObject({
      addresses: ['10.88.0.2/32', 'fd00:88::2/128'],
      routes: [
        { to: '0.0.0.0/0', via: '169.254.1.1', 'on-link': true },
        { to: '::/0', via: 'fe80::1' },
      ],
      nameservers: { addresses: ['${LW_DNS}'] },
    });
    // Extra NICs answer through their own table (anti-spoofing on their tap).
    expect(network.ethernets.mgmt).toMatchObject({
      addresses: ['10.88.0.3/32'],
      routes: [{ to: '0.0.0.0/0', via: '169.254.1.1', 'on-link': true, table: 101 }],
      'routing-policy': [{ from: '10.88.0.3/32', table: 101 }],
    });
  });

  it('keeps the spec hash when only user data or SSH keys change', () => {
    const build = (spec: Record<string, unknown>) => {
      const { parsed } = plan(spec);

      return buildVmWorkloadSpec(parsed[0], parsed[0].virtualMachines!['db1'], ['10.88.0.2'], 'lw', pinned, LAUNCHER);
    };
    const base = build(DB1);

    expect(build({ ...DB1, cloudInit: { userData: '#cloud-config\n{}' } }).specHash).toBe(base.specHash);
    expect(build({ ...DB1, memory: '8Gi' }).specHash).not.toBe(base.specHash);
  });

  it('pins user-data secret refs to the planned versions (per VM)', () => {
    const spec = {
      ...DB1,
      cloudInit: {
        userData: '#cloud-config\na: secret://shop/db1-pw\nb: secret://shop/fixed@2\nc: secret://shop/db1-pw\n',
      },
    };
    const { parsed } = plan(spec);
    const vm = parsed[0].virtualMachines!['db1'];

    expect(vmSecretRefs(vm.spec)).toEqual(['secret://shop/db1-pw']);
    expect(vmSecretVersionKey('db1', 'secret://shop/db1-pw')).toBe('db1/secret://shop/db1-pw');

    const build = (secretVersions?: Record<string, number>) =>
      buildVmWorkloadSpec(parsed[0], vm, ['10.88.0.2', '10.88.0.3'], 'lw', { ...pinned, secretVersions }, LAUNCHER);
    const unpinned = build();
    const v3 = build({ 'db1/secret://shop/db1-pw': 3, 'other/secret://shop/db1-pw': 9 });
    const v4 = build({ 'db1/secret://shop/db1-pw': 4 });

    expect(unpinned.vm?.cloudInit?.secretRefs).toEqual(['secret://shop/db1-pw', 'secret://shop/fixed@2']);
    expect(v3.vm?.cloudInit?.userData).toBe(
      '#cloud-config\na: secret://shop/db1-pw@3\nb: secret://shop/fixed@2\nc: secret://shop/db1-pw@3\n',
    );
    expect(v3.vm?.cloudInit?.secretRefs).toEqual(['secret://shop/db1-pw@3', 'secret://shop/fixed@2']);
    expect(workloadSpecSchema.safeParse(v3).success).toBe(true);
    // A new secret version changes the next boot's seed, not the running VM (cloud-init is outside the hash).
    expect(v4.vm?.cloudInit?.userData).toContain('secret://shop/db1-pw@4');
    expect(v4.specHash).toBe(v3.specHash);
  });

  it('pins VM secrets at plan time: re-pinned VMs get the latest versions, others keep theirs', async () => {
    const vms = {
      db1: { spec: plan().parsed[0].virtualMachines!['db1'].spec },
      db2: {
        spec: { ...plan().parsed[0].virtualMachines!['db1'].spec, cloudInit: { userData: 'x: secret://shop/a' } },
      },
      db3: { spec: { ...plan().parsed[0].virtualMachines!['db1'].spec, cloudInit: undefined } },
    };
    const latest = jest.fn(async (refs: string[]) =>
      Object.fromEntries(refs.filter((r) => r !== 'secret://shop/a').map((r) => [r, 7])),
    );
    const result = await pinVmSecrets(vms as never, (vm) => vm === 'db1', { 'db2/secret://shop/a': 2 }, latest);

    expect(result).toEqual({ versions: { 'db1/secret://shop/db1-pw': 7, 'db2/secret://shop/a': 2 }, missing: [] });
    expect(latest).toHaveBeenCalledTimes(1);

    const all = await pinVmSecrets(vms as never, () => true, undefined, latest);

    expect(all.missing).toEqual([{ vm: 'db2', ref: 'secret://shop/a' }]);
  });

  it('notes a KubeVirt containerDisk used as a VM image', () => {
    const vm = plan().parsed[0].virtualMachines!['db1'];

    expect(
      vmImageIssues(vm, {
        ...vmImage,
        vmImage: { ...vmImage.vmImage!, containerDisk: { path: 'disk/fedora.qcow2' } },
      }),
    ).toEqual([
      expect.objectContaining({
        level: 'warning',
        path: 'db1.spec.image',
        message: expect.stringContaining('KubeVirt containerDisk (disk/fedora.qcow2'),
      }),
    ]);
  });

  it('refuses to compile a VM whose image is not pinned yet', () => {
    const { parsed } = plan();

    expect(() =>
      buildVmWorkloadSpec(parsed[0], parsed[0].virtualMachines!['db1'], ['10.0.0.2'], 'lw', { images: {} }),
    ).toThrow('image not pinned');
  });

  it('checks the pinned image against the boot disk and firmware', () => {
    const vm = plan({ ...DB1, firmware: 'bios' }).parsed[0].virtualMachines!['db1'];

    expect(vmImageIssues(vm, vmImage)).toEqual([]);
    expect(
      vmImageIssues(vm, { ...vmImage, vmImage: { ...vmImage.vmImage!, virtualSize: 30 * GiB, firmware: ['uefi'] } }),
    ).toEqual([
      expect.objectContaining({ path: 'db1.spec.disks.root.size' }),
      expect.objectContaining({ path: 'db1.spec.firmware' }),
    ]);
    expect(vmImageIssues(vm, { ...vmImage, vmImage: undefined })).toEqual([
      expect.objectContaining({ message: expect.stringContaining('no VM image artifact') }),
    ]);
  });

  it('marks VM disks as block volumes and initializes the boot disk from the image layer', () => {
    const { parsed } = plan();

    expect(vmBlockVolumes(parsed, [{ id: 'shop/lw-vm', imageConfigs: { db1: vmImage } }])).toEqual(
      new Map([
        ['shop/lw-vm/db1.data', { mode: 'block' }],
        ['shop/lw-vm/db1.root', { mode: 'block', initializeFrom: { digest: sha('1'), format: 'qcow2' } }],
      ]),
    );
  });

  it('counts VM usage for the quotas', () => {
    expect(vmUsage(plan().parsed).get('shop')).toEqual({
      virtualMachines: 1,
      vmVcpus: 2,
      vmMemoryBytes: 4 * GiB,
      vmDiskBytes: 120 * GiB,
    });
    expect(vmUsage(plan({ ...DB1, runStrategy: 'Halted' }).parsed).get('shop')).toMatchObject({
      virtualMachines: 1,
      vmVcpus: 0,
      vmMemoryBytes: 0,
    });
  });
});
