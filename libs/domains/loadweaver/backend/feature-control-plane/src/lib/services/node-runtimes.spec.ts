import { matchesSelector } from '@forepath/loadweaver/shared/util-model';

import { effectiveNodeLabels, nodeRuntimes } from '../dto/node.dto';
import { runtimeQuerySelector } from './nodes.service';
import { reservedNameIssue, workloadArch, workloadArches } from './plans.service';
import { nodeArch } from './workload-planner.service';

const node = (name: string, runtimes: unknown) => ({
  name,
  site: 's1',
  labels: { tier: 'a', 'loadweaver.com/runtime': 'spoofed' },
  capabilities: { runtimes },
});

describe('node isolation levels in the API (3.1)', () => {
  it('lists the ready levels in ladder order and derives the runtime labels', () => {
    expect(nodeRuntimes({ runtimes: ['microvm', 'runc', 'sandboxed', 'future'] })).toEqual([
      'runc',
      'sandboxed',
      'microvm',
    ]);
    expect(nodeRuntimes(null)).toEqual(['runc']);
    expect(effectiveNodeLabels(node('n1', ['runc', 'sandboxed-kvm']))).toEqual({
      tier: 'a',
      'loadweaver.com/runtime': 'sandboxed-kvm',
      'runtime.loadweaver.com/runc': 'ready',
      'runtime.loadweaver.com/sandboxed-kvm': 'ready',
      'loadweaver.com/site': 's1',
      'loadweaver.com/node': 'n1',
    });
  });

  it('queries nodes by exact level or "at least" a level', () => {
    const nodes = [
      node('plain', ['runc']),
      node('gkvm', ['runc', 'sandboxed', 'sandboxed-kvm']),
      node('vm', ['runc', 'microvm']),
    ];
    const match = (query: string) =>
      nodes
        .filter((n) => matchesSelector(runtimeQuerySelector(query)!, { name: n.name, labels: effectiveNodeLabels(n) }))
        .map((n) => n.name);

    expect(match('sandboxed')).toEqual(['gkvm']);
    expect(match('>=sandboxed')).toEqual(['gkvm', 'vm']);
    expect(match('>= sandboxed-kvm')).toEqual(['gkvm', 'vm']);
    expect(match('>=microvm')).toEqual(['vm']);
    expect(match('runc')).toEqual(['plain', 'gkvm', 'vm']);
    expect(runtimeQuerySelector('>=firecracker')).toBeNull();
  });
});

describe('plan names and image architecture (3.17, 3.35)', () => {
  const doc = (kind: string, name: string) => ({ kind, metadata: { name } }) as never;

  it('reserves the project cluster and the deployment lw-vm', () => {
    expect(reservedNameIssue([doc('Project', 'cluster')])).toContain('reserved');
    expect(reservedNameIssue([doc('Deployment', 'lw-vm')])).toBe(
      'the deployment name lw-vm is reserved for virtual machines',
    );
    expect(reservedNameIssue([doc('Deployment', 'store'), doc('VirtualMachine', 'lw-vm')])).toBeNull();
  });

  it('pins arm64 images only for all-arm64 clusters', () => {
    const n = (arch: string, witness = false) => ({
      os: { id: 'debian', versionId: '13', kernel: '6', arch },
      witness,
    });

    expect(workloadArch([n('arm64'), n('aarch64'), n('amd64', true)])).toBe('arm64');
    expect(workloadArch([n('arm64'), n('amd64')])).toBe('amd64');
    expect(workloadArch([])).toBe('amd64');
  });

  it('inspects microVM images for every workload node architecture, amd64 first', () => {
    const n = (arch: string | null, witness = false) => ({
      os: arch ? { id: 'debian', versionId: '13', kernel: '6', arch } : null,
      witness,
    });

    expect(workloadArches([n('aarch64'), n('amd64')])).toEqual(['amd64', 'arm64']);
    expect(workloadArches([n('arm64'), n('amd64', true)])).toEqual(['arm64']);
    expect(workloadArches([n(null)])).toEqual(['amd64']);
    expect(nodeArch(n('aarch64'))).toBe('arm64');
    expect(nodeArch(n('x86_64'))).toBe('amd64');
    expect(nodeArch(n(null))).toBeUndefined();
  });
});
