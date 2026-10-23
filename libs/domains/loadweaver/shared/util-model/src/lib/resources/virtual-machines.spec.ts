import { LOADWEAVER_API_VERSION } from '../metadata';
import { parseResource, resourceJsonSchema } from '../resource';

import {
  atLeast,
  isRuntime,
  nodeSpecSchema,
  RUNTIME_RANK,
  RUNTIMES,
  runtimesAtLeast,
  strongestRuntime,
} from './infrastructure';
import { parseVmQuantity, virtualMachineSpecSchema, vmBootDisk, vmDiskVolumeId, vmReplicaId } from './virtual-machines';
import { projectSpecSchema } from './workloads';

const vm = (spec: Record<string, unknown> = {}) => ({
  image: 'registry.lw/shop/debian-13:20261017',
  cpu: { vcpus: 2 },
  memory: '4Gi',
  disks: [
    { name: 'root', size: '20Gi', source: 'image', replicas: 2, crossSite: 'async' },
    { name: 'data', size: '100Gi', replicas: 2 },
  ],
  nics: [{ name: 'eth0', groups: ['db'], ipv6: true }],
  ...spec,
});

function issues(spec: Record<string, unknown>): string[] {
  const parsed = virtualMachineSpecSchema.safeParse(spec);

  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('isolation ladder (3.1)', () => {
  it('orders the four levels by strength', () => {
    expect(RUNTIMES).toEqual(['runc', 'sandboxed', 'sandboxed-kvm', 'microvm']);
    expect(RUNTIMES.map((r) => RUNTIME_RANK[r])).toEqual([1, 2, 3, 4]);
    expect(atLeast('microvm', 'sandboxed-kvm')).toBe(true);
    expect(atLeast('sandboxed', 'sandboxed-kvm')).toBe(false);
    expect(atLeast('runc', 'runc')).toBe(true);
    expect(runtimesAtLeast('sandboxed-kvm')).toEqual(['sandboxed-kvm', 'microvm']);
    expect(runtimesAtLeast('runc')).toEqual(RUNTIMES);
    expect(strongestRuntime(['sandboxed', 'runc', 'sandboxed-kvm'])).toBe('sandboxed-kvm');
    expect(strongestRuntime([])).toBeNull();
    expect(isRuntime('microvm')).toBe(true);
    expect(isRuntime('runsc-kvm')).toBe(false);
  });

  it('lets a node opt out of KVM', () => {
    expect(nodeSpecSchema.parse({ site: 'fra1' })).not.toHaveProperty('virtualization');
    expect(nodeSpecSchema.parse({ site: 'fra1', virtualization: {} }).virtualization).toEqual({ kvm: 'auto' });
    expect(nodeSpecSchema.parse({ site: 'fra1', virtualization: { kvm: 'disabled' } }).virtualization).toEqual({
      kvm: 'disabled',
    });
    expect(nodeSpecSchema.safeParse({ site: 'fra1', virtualization: { kvm: 'off' } }).success).toBe(false);
    expect(nodeSpecSchema.safeParse({ site: 'fra1', virtualization: { nested: true } }).success).toBe(false);
  });
});

describe('project allowances and VM quotas', () => {
  it('allows only /dev/kvm as a device and takes VM quotas', () => {
    expect(
      projectSpecSchema.parse({
        workloads: { allowedDevices: ['/dev/kvm'] },
        quota: { virtualMachines: 4, vmVcpus: 16, vmMemory: '64g', vmDiskBytes: '2t' },
      }),
    ).toMatchObject({
      workloads: { allowedDevices: ['/dev/kvm'] },
      quota: { virtualMachines: 4, vmVcpus: 16, vmMemory: '64g', vmDiskBytes: '2t' },
    });
    expect(projectSpecSchema.safeParse({ workloads: { allowedDevices: ['/dev/sda'] } }).success).toBe(false);
    expect(projectSpecSchema.safeParse({ quota: { vmVcpus: -1 } }).success).toBe(false);
    expect(projectSpecSchema.safeParse({ quota: { vmMemory: 'lots' } }).success).toBe(false);
  });
});

describe('VirtualMachine (3.35)', () => {
  it('applies the defaults', () => {
    const spec = virtualMachineSpecSchema.parse(vm());

    expect(spec).toMatchObject({
      firmware: 'uefi',
      cpu: { vcpus: 2, model: 'host-model' },
      ha: { restartElsewhere: true },
      liveMigration: { enabled: true },
      runStrategy: 'Always',
      console: { graphical: true },
    });
    expect(spec.disks[1]).toMatchObject({ source: 'blank', bus: 'virtio', cache: 'none' });
    expect(vmBootDisk(spec)?.name).toBe('root');
  });

  it('takes one or more NICs, each with its own groups', () => {
    const spec = virtualMachineSpecSchema.parse(
      vm({
        nics: [
          { name: 'eth0', groups: ['db'] },
          { name: 'eth1', groups: ['backup'], labels: { zone: 'storage' }, ipv4: false },
        ],
      }),
    );

    expect(spec.nics.map((n) => [n.name, n.groups])).toEqual([
      ['eth0', ['db']],
      ['eth1', ['backup']],
    ]);
    expect(issues(vm({ nics: [] }))).not.toEqual([]);
    expect(issues(vm({ nics: [{ name: 'eth0' }, { name: 'eth0' }] }))).toEqual([
      'nics.1.name: duplicate NIC name eth0',
    ]);
    expect(issues(vm({ nics: [{ name: 'eth0', ipv4: false, ipv6: false }] }))).toEqual([
      'nics.0: a NIC needs at least one address family',
    ]);
    expect(issues(vm({ nics: [{ name: 'Eth-0' }] }))).not.toEqual([]);
    expect(issues(vm({ nics: Array.from({ length: 9 }, (_, i) => ({ name: `eth${i}` })) }))).not.toEqual([]);
  });

  it('validates disks, memory and CPU', () => {
    expect(issues(vm({ disks: [{ name: 'data', size: '1Gi' }] }))).toEqual([
      'disks: exactly one disk must have source: image (the boot disk), found 0',
    ]);
    expect(
      issues(
        vm({
          disks: [
            { name: 'root', size: '20Gi', source: 'image' },
            { name: 'root', size: '20Gi', source: 'image' },
          ],
        }),
      ),
    ).toEqual([
      'disks.1.name: duplicate disk name root',
      'disks: exactly one disk must have source: image (the boot disk), found 2',
    ]);
    expect(issues(vm({ disks: Array.from({ length: 9 }, (_, i) => ({ name: `d${i}`, size: '1Gi' })) }))).not.toEqual(
      [],
    );
    expect(issues(vm({ disks: [{ name: 'root', size: '20Zi', source: 'image' }] }))).toEqual([
      'disks.0.size: invalid disk size',
    ]);
    expect(issues(vm({ memory: '128Mi' }))).toEqual(['memory: a virtual machine needs at least 256Mi of memory']);
    expect(issues(vm({ memory: '256Mi' }))).toEqual([]);
    expect(issues(vm({ cpu: { vcpus: 65 } }))).not.toEqual([]);
    expect(issues(vm({ cpu: { vcpus: 0 } }))).not.toEqual([]);
    expect(issues(vm({ disks: [{ name: 'root', size: '20Gi', source: 'image', bus: 'ide' }] }))).not.toEqual([]);
    expect(issues(vm({ cloudInit: { userData: '#cloud-config', userDataSecret: 'secret://shop/ud' } }))).toEqual([
      'cloudInit.userDataSecret: use either userData or userDataSecret',
    ]);
    expect(
      issues(vm({ cloudInit: { userDataSecret: 'secret://shop/ud', sshAuthorizedKeys: ['ssh-ed25519 AAA'] } })),
    ).toEqual([]);
  });

  it('parses VM quantities in binary units', () => {
    expect(parseVmQuantity('4Gi')).toBe(4 * 1024 ** 3);
    expect(parseVmQuantity('4g')).toBe(4 * 1024 ** 3);
    expect(parseVmQuantity('512Mi')).toBe(512 * 1024 ** 2);
    expect(parseVmQuantity(1_048_576)).toBe(1_048_576);
    expect(parseVmQuantity('1.5Ti')).toBe(1.5 * 1024 ** 4);
    expect(parseVmQuantity('lots')).toBeNull();
    expect(parseVmQuantity('4Zi')).toBeNull();
    expect(parseVmQuantity(0)).toBeNull();
  });

  it('is a project-scoped resource kind with a JSON Schema', () => {
    const doc = (metadata: Record<string, unknown>) => ({
      apiVersion: LOADWEAVER_API_VERSION,
      kind: 'VirtualMachine',
      metadata,
      spec: vm(),
    });

    expect(parseResource(doc({ name: 'db1', project: 'shop', labels: { app: 'db' } })).ok).toBe(true);
    expect(parseResource(doc({ name: 'db1' })).ok).toBe(false);
    expect(resourceJsonSchema('VirtualMachine')).toMatchObject({
      $id: 'https://loadweaver.com/schemas/v1/VirtualMachine.json',
      title: 'VirtualMachine',
    });
    expect(vmReplicaId('shop', 'db1')).toBe('shop/lw-vm/db1/0');
    expect(vmDiskVolumeId('shop', 'db1', 'root')).toBe('shop/lw-vm/db1.root');
  });
});
