import { projectSpecSchema } from '@forepath/loadweaver/shared/util-model';

import { vmDeployments } from '../utils/vm-planning.utils';
import { planRequirements } from './access.utils';
import { projectUsage, quotaIssues, quotaShares } from './plan-access.utils';

const GiB = 1024 ** 3;
const VM = {
  image: 'registry.lw/shop/debian:13',
  cpu: { vcpus: 4 },
  memory: '8Gi',
  disks: [
    { name: 'root', size: '20Gi', source: 'image' },
    { name: 'data', size: '80Gi' },
  ],
  nics: [{ name: 'eth0' }],
};

describe('VM quotas and admin-only allowances (3.35, 3.1)', () => {
  const quota = { virtualMachines: 1, vmVcpus: 6, vmMemory: '12g', vmDiskBytes: '150g', memory: '20g' };
  const resources = [{ kind: 'Project', name: 'shop', project: null, spec: { quota } }];
  const projects = new Map([['shop', projectSpecSchema.parse({ quota })]]);
  const { parsed } = vmDeployments(
    [
      { project: 'shop', name: 'a', spec: VM },
      { project: 'shop', name: 'b', spec: { ...VM, runStrategy: 'Halted' } },
    ],
    projects,
  );

  it('counts VMs into their own quotas and the CPU / memory / storage ones', () => {
    const usage = projectUsage(parsed, resources).get('shop');

    expect(usage).toMatchObject({
      virtualMachines: 2,
      vmVcpus: 4,
      vmMemoryBytes: 8 * GiB,
      vmDiskBytes: 200 * GiB,
      // Only the running VM has a replica: its vCPUs and memory plus the launcher overhead.
      cpuMillis: 4250,
      memoryBytes: 8 * GiB + 384 * 1024 ** 2,
      storageBytes: 200 * GiB,
    });
  });

  it('rejects plans over the VM quotas', () => {
    expect(quotaIssues(projectUsage(parsed, resources), resources, ['shop'])).toEqual([
      'project shop: virtual machines 2 exceeds the quota of 1',
      'project shop: VM disks 200 GiB exceeds the quota of 150 GiB',
    ]);
    expect(quotaShares(projectUsage(parsed, resources), resources).map((s) => s.resource)).toEqual(
      expect.arrayContaining(['virtual machines', 'VM vCPUs', 'VM memory', 'VM disks']),
    );
  });

  it('lets only cluster admins change a project (allowedDevices is admin-only)', () => {
    expect(planRequirements([{ action: 'update', kind: 'Project', project: null }])).toEqual({
      cluster: 'admin',
      projects: [],
    });
    expect(planRequirements([{ action: 'create', kind: 'VirtualMachine', project: 'shop' }])).toEqual({
      projects: ['shop'],
    });
  });
});
