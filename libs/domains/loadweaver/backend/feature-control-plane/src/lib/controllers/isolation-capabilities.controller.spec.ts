import type { SchedulerNode } from '@forepath/loadweaver/shared/util-scheduler';
import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { ProjectAccessService } from '../access/project-access.service';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import {
  aggregateIsolationCapabilities,
  IsolationCapabilitiesController,
  parseSelectorQuery,
} from './isolation-capabilities.controller';

const ALL = ['isolation-ladder', 'microvm', 'workload-devices'];

function node(name: string, extra: Partial<SchedulerNode> = {}): SchedulerNode {
  return {
    name,
    site: 'fra1',
    labels: { 'loadweaver.com/node': name, 'loadweaver.com/site': 'fra1' },
    lifecycle: 'active',
    witness: false,
    capacity: { cpuMillis: 4000, memoryBytes: 8 * 1024 ** 3 },
    diskBytes: 100 * 1024 ** 3,
    runtimes: ['runc', 'sandboxed'],
    kvm: { usable: false, optOut: false },
    reachable: true,
    features: ALL,
    ...extra,
  };
}

const KVM_NODE: Partial<SchedulerNode> = {
  runtimes: ['runc', 'sandboxed', 'sandboxed-kvm', 'microvm'],
  kvm: { usable: true, optOut: false },
};

describe('isolation capabilities (Agenstra on Loadweaver, M7.5)', () => {
  it('reports a level ready when at least one schedulable node offers it, with the count', () => {
    const view = aggregateIsolationCapabilities('ws', [node('a'), node('b', KVM_NODE)], null);

    expect(view.nodes).toBe(2);
    expect(view.strongest).toBe('microvm');
    expect(view.levels.runc).toEqual({ state: 'ready', nodes: 2 });
    expect(view.levels.sandboxed).toEqual({ state: 'ready', nodes: 2 });
    expect(view.levels['sandboxed-kvm']).toEqual({ state: 'ready', nodes: 1 });
    expect(view.levels.microvm).toEqual({ state: 'ready', nodes: 1 });
  });

  it('ignores nodes that take no workloads (cordoned, unreachable, witness)', () => {
    const view = aggregateIsolationCapabilities(
      'ws',
      [
        node('a'),
        node('b', { ...KVM_NODE, lifecycle: 'cordoned' }),
        node('c', { ...KVM_NODE, reachable: false }),
        node('d', { ...KVM_NODE, witness: true }),
      ],
      null,
    );

    expect(view.nodes).toBe(1);
    expect(view.levels.microvm.state).not.toBe('ready');
    expect(view.strongest).toBe('sandboxed');
  });

  it('uses the most common cause and its reason code, with the per-node reason', () => {
    const view = aggregateIsolationCapabilities(
      'ws',
      [
        node('a', {
          isolation: { microvm: { state: 'probe-failed', reasonCode: 'E_MICROVM_BOOT_FAILED' } },
          kvm: { usable: true, optOut: false },
        }),
        node('b'),
        node('c'),
      ],
      null,
    );

    expect(view.levels.microvm).toMatchObject({ state: 'unsupported', nodes: 0, reasonCode: 'E_KVM_UNAVAILABLE' });
    expect(view.levels.microvm.reason).toContain('runtime microvm: 0 of 3 nodes ready');
    expect(view.levels.microvm.reason).toContain('a E_MICROVM_BOOT_FAILED');
  });

  it('reports nodes opted out of KVM as disabled-by-admin', () => {
    const view = aggregateIsolationCapabilities('ws', [node('a', { kvm: { usable: true, optOut: true } })], null);

    expect(view.levels['sandboxed-kvm']).toMatchObject({
      state: 'disabled-by-admin',
      reasonCode: 'E_DISABLED_BY_ADMIN',
    });
  });

  it("doesn't count nodes whose agent lacks the level's protocol features", () => {
    const view = aggregateIsolationCapabilities('ws', [node('a', { ...KVM_NODE, features: [] })], null);

    expect(view.levels.microvm).toMatchObject({ state: 'unsupported', reasonCode: 'E_RUNTIME_NOT_REGISTERED' });
    expect(view.levels.microvm.reason).toContain('update the node agents');
    expect(view.levels.sandboxed.state).toBe('ready');
  });

  it('narrows the placement with the selector; no node left means nothing is ready', () => {
    const nodes = [node('a'), node('b', { ...KVM_NODE, labels: { ...node('b').labels, pool: 'kvm' } })];
    const kvmOnly = aggregateIsolationCapabilities('ws', nodes, parseSelectorQuery('pool=kvm'));

    expect(kvmOnly.nodes).toBe(1);
    expect(kvmOnly.levels.runc.nodes).toBe(1);
    expect(kvmOnly.levels.microvm.state).toBe('ready');

    const none = aggregateIsolationCapabilities('ws', nodes, parseSelectorQuery('pool=gpu'));

    expect(none.nodes).toBe(0);
    expect(none.strongest).toBeNull();
    expect(none.levels.runc).toMatchObject({ state: 'unsupported', reasonCode: 'E_DOCKER_BASELINE_UNAVAILABLE' });
    expect(none.levels.runc.reason).toContain('selector matches none');
  });

  it('parses selectors strictly', () => {
    expect(parseSelectorQuery(undefined)).toBeNull();
    expect(parseSelectorQuery(' ')).toBeNull();
    expect(parseSelectorQuery('a=b, loadweaver.com/site=fra1')).toEqual({
      matchLabels: { a: 'b', 'loadweaver.com/site': 'fra1' },
    });
    expect(() => parseSelectorQuery('a')).toThrow(BadRequestException);
    expect(() => parseSelectorQuery('=b')).toThrow(BadRequestException);
    expect(() => parseSelectorQuery('a b=c')).toThrow(BadRequestException);
  });

  it('serves the view to project readers from the nodes and Node resources (KVM opt-out from the spec)', async () => {
    const now = new Date();
    const entity = (name: string, capabilities: Record<string, unknown>) =>
      ({
        name,
        site: 'fra1',
        labels: {},
        lifecycle: 'active',
        witness: false,
        controlPlane: false,
        capacity: { cpuMillis: 4000, memoryBytes: 8 * 1024 ** 3, diskBytes: 1e11 },
        capabilities,
        lastSeenAt: now,
        protocolFeatures: ALL,
      }) as unknown as NodeEntity;
    const kvmCaps = {
      runtimes: ['runc', 'sandboxed', 'sandboxed-kvm', 'microvm'],
      kvm: { usable: true, optOut: false },
    };
    const rows = new Map<unknown, unknown[]>([
      [NodeEntity, [entity('a', kvmCaps), entity('b', kvmCaps)]],
      [ResourceEntity, [{ kind: 'Node', name: 'a', spec: { site: 'fra1', virtualization: { kvm: 'disabled' } } }]],
    ]);
    const dataSource = { getRepository: (e: unknown) => ({ find: async () => rows.get(e) ?? [] }) };
    const access = { assertRead: jest.fn(async () => undefined) };
    const controller = new IsolationCapabilitiesController(
      dataSource as unknown as DataSource,
      access as unknown as ProjectAccessService,
    );
    const view = await controller.get('ws', undefined);

    expect(access.assertRead).toHaveBeenCalledWith(undefined, 'ws');
    expect(view).toMatchObject({ project: 'ws', selector: null, nodes: 2, strongest: 'microvm' });
    // Node a is opted out by its Node spec: only b offers the KVM levels.
    expect(view.levels.microvm).toEqual({ state: 'ready', nodes: 1 });
    expect(view.levels.runc).toEqual({ state: 'ready', nodes: 2 });
    expect(Date.parse(view.checkedAt)).not.toBeNaN();
  });
});
