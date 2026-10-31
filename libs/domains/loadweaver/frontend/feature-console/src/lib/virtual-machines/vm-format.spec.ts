import type { VirtualMachineSummary } from '@forepath/loadweaver/frontend/data-access-console';

import {
  commandColor,
  commandStatusLabel,
  importAmount,
  importBar,
  matchesVmSearch,
  phaseTone,
  suggestImageRef,
  vmActionConfirmMessage,
  vmActionDangerous,
  vmLink,
} from './vm-format';

const vm: VirtualMachineSummary = {
  project: 'shop',
  name: 'db1',
  labels: { app: 'db' },
  description: 'Primary database',
  image: 'registry.lw/shop/debian:13',
  pinnedImage: null,
  runStrategy: 'Manual',
  power: 'running',
  phase: 'Running',
  node: 'n1',
  vcpus: 2,
  memoryBytes: 1,
  diskBytes: 1,
  disks: 1,
  nics: 1,
  addresses: ['10.20.1.5'],
  graphical: true,
};

describe('vm format (3.35)', () => {
  it('searches names, nodes, addresses and labels', () => {
    expect(matchesVmSearch(vm, '')).toBe(true);
    expect(matchesVmSearch(vm, 'DB1')).toBe(true);
    expect(matchesVmSearch(vm, '10.20.1')).toBe(true);
    expect(matchesVmSearch(vm, 'app=db')).toBe(true);
    expect(matchesVmSearch(vm, 'primary')).toBe(true);
    expect(matchesVmSearch(vm, 'web')).toBe(false);
  });

  it('maps phases, actions and links', () => {
    expect(phaseTone('Running')).toBe('success');
    expect(phaseTone('Failed')).toBe('danger');
    expect(vmActionDangerous('reset')).toBe(true);
    expect(vmActionDangerous('reboot')).toBe(false);
    expect(vmActionConfirmMessage('force-off')).toContain('Unsaved data');
    expect(vmLink(vm)).toEqual(['/resources', 'virtualmachine', 'shop', 'db1']);
  });

  it('computes the boot disk import bar and amount', () => {
    const MiB = 1024 ** 2;
    const fmt = (b: number) => `${b / MiB}M`;

    expect(importBar({ phase: 'writing', bytes: 256 * MiB, totalBytes: 1024 * MiB })).toEqual({
      value: 256 * MiB,
      max: 1024 * MiB,
      percent: 25,
    });
    expect(importBar({ phase: 'writing', bytes: 2048 * MiB, totalBytes: 1024 * MiB })?.percent).toBe(100);
    expect(importBar({ phase: 'fetching', bytes: MiB })).toBeNull();
    expect(importBar({ phase: 'queued' })).toBeNull();
    expect(importBar({ phase: 'failed', bytes: MiB, totalBytes: 2 * MiB })).toBeNull();
    expect(importAmount({ phase: 'writing', bytes: MiB, totalBytes: 2 * MiB }, fmt)).toBe('1M / 2M');
    expect(importAmount({ phase: 'fetching', bytes: MiB }, fmt)).toBe('1M');
    expect(importAmount({ phase: 'queued' }, fmt)).toBe('');
  });

  it('suggests an image ref from the download URL', () => {
    expect(suggestImageRef('https://cloud.debian.org/images/debian-13-genericcloud-amd64.qcow2?x=1')).toBe(
      'debian-13-genericcloud-amd64:latest',
    );
    expect(suggestImageRef('https://example.com/Fedora_40.tar.gz')).toBe('fedora_40:latest');
    expect(suggestImageRef('https://example.com/')).toBe('');
  });

  it('labels node command outcomes', () => {
    expect(commandColor('succeeded')).toBe('success');
    expect(commandColor('failed')).toBe('danger');
    expect(commandColor('running')).toBe('info');
    expect(commandColor('pending')).toBe('secondary');
    expect(commandStatusLabel('succeeded')).toBe('Done');
    expect(commandStatusLabel('pending')).toBe('Queued');
  });
});
