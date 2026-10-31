import type { Resource } from '@forepath/loadweaver/shared/util-model';

import { summarizePlan } from './plan-runner';
import {
  attributeForIssue,
  canonicalJson,
  definitionFor,
  documentFromState,
  fromSpecValue,
  RESOURCE_DEFINITIONS,
  resourceSchema,
  stateFromServer,
  toSpecValue,
} from './resources';

const project = definitionFor('loadweaver_project')!;
const policy = definitionFor('loadweaver_policy')!;

describe('resource definitions', () => {
  it('gives every resource id, name, labels, last_plan_id and a project where the kind has one', () => {
    for (const def of RESOURCE_DEFINITIONS) {
      const names = resourceSchema(def).attributes.map((a) => a.name);

      expect(names).toEqual(expect.arrayContaining(['id', 'name', 'labels', 'last_plan_id']));
      expect(names.includes('project')).toBe(
        !['loadweaver_project', 'loadweaver_node_group', 'loadweaver_client_group', 'loadweaver_dns_zone'].includes(
          def.typeName,
        ),
      );
      expect(names.includes('spec')).toBe(def.fields === null);
    }
  });

  it('builds documents from typed attributes and JSON specs', () => {
    expect(
      documentFromState(project, {
        name: 'shop',
        description: 'S',
        default_cpu: '1',
        quota_ports: 3,
        labels: {},
        quota_cpu: null,
      }),
    ).toEqual({
      ok: true,
      resource: {
        apiVersion: 'loadweaver.com/v1',
        kind: 'Project',
        metadata: { name: 'shop' },
        spec: { description: 'S', defaults: { cpu: '1' }, quota: { ports: 3 } },
      },
    });
    expect(
      documentFromState(policy, { name: 'p', project: 'shop', labels: { a: 'b' }, spec: '{"from":[]}' }),
    ).toMatchObject({
      ok: true,
      resource: { kind: 'Policy', metadata: { name: 'p', project: 'shop', labels: { a: 'b' } }, spec: { from: [] } },
    });
    expect(documentFromState(policy, { name: 'p', spec: '[1]' })).toMatchObject({ ok: false, attribute: 'spec' });
    expect(documentFromState(policy, { name: 'p', spec: '{' })).toMatchObject({ ok: false, attribute: 'spec' });
  });

  it('maps issue paths onto attributes', () => {
    expect(attributeForIssue(project, 'spec.quota.cpu')).toBe('quota_cpu');
    expect(attributeForIssue(project, 'spec.defaults.memory')).toBe('default_memory');
    expect(attributeForIssue(project, 'metadata.labels.x')).toBe('labels');
    expect(attributeForIssue(policy, 'spec.rules.0.ports')).toBe('spec');
    expect(attributeForIssue(policy, 'metadata.project')).toBe('project');
  });

  it('keeps the configured spec when the stored one only adds defaults, and shows real drift', () => {
    const prior = {
      id: 'Policy/shop/p',
      name: 'p',
      project: 'shop',
      labels: null,
      spec: '{"from":[{"builtin":"internet"}],"rules":[{"ports":[80]}],"to":[{"group":"web"}]}',
      last_plan_id: 'x',
    };
    const stored = {
      apiVersion: 'loadweaver.com/v1',
      kind: 'Policy',
      metadata: { name: 'p', project: 'shop' },
      spec: {
        mode: 'enforce',
        action: 'allow',
        from: [{ builtin: 'internet' }],
        to: [{ group: 'web' }],
        rules: [{ protocol: 'tcp', ports: [80] }],
      },
    } as unknown as Resource;

    expect(stateFromServer(policy, prior, stored)).toEqual(prior);

    const drifted = { ...stored, spec: { ...(stored.spec as object), mode: 'monitor' } } as Resource;

    expect(JSON.parse(String(stateFromServer(policy, prior, drifted)['spec']))).toMatchObject({ mode: 'monitor' });
    expect(
      stateFromServer(policy, prior, { ...stored, metadata: { ...stored.metadata, labels: { a: 'b' } } })['labels'],
    ).toEqual({ a: 'b' });
  });

  it('converts nested attributes to the spec form and back', () => {
    const vm = definitionFor('loadweaver_virtual_machine')!;
    const disks = vm.fields!.find((f) => f.attribute.name === 'disks')!.attribute;
    const placement = vm.fields!.find((f) => f.attribute.name === 'placement')!.attribute;
    const disk = {
      name: 'root',
      size: '20Gi',
      source: 'image',
      replicas: null,
      cross_site: 'async',
      bus: null,
      cache: null,
    };

    expect(toSpecValue(disks, [disk])).toEqual([{ name: 'root', size: '20Gi', source: 'image', crossSite: 'async' }]);
    expect(fromSpecValue(disks, [{ name: 'root', size: 20, crossSite: 'async', source: 'image' }])).toEqual([
      { ...disk, size: '20' },
    ]);

    // Map values (label keys) are kept as they are; nested objects inside nested objects are converted too.
    const tf = {
      selector: {
        names: null,
        match_labels: { tier_name: 'vm' },
        match_expressions: [{ key: 'loadweaver.com/runtime', operator: 'In', values: ['microvm'] }],
      },
      spread: 'node',
    };
    const spec = {
      selector: {
        matchLabels: { tier_name: 'vm' },
        matchExpressions: [{ key: 'loadweaver.com/runtime', operator: 'In', values: ['microvm'] }],
      },
      spread: 'node',
    };

    expect(toSpecValue(placement, tf)).toEqual(spec);
    expect(fromSpecValue(placement, spec)).toEqual(tf);
    expect(attributeForIssue(vm, 'spec.disks.1.size')).toBe('disks');
    expect(attributeForIssue(vm, 'spec.cpu.vcpus')).toBe('vcpus');
    expect(attributeForIssue(vm, 'spec.cpu.model')).toBe('cpu_model');
    expect(attributeForIssue(vm, 'spec.ha.restartElsewhere')).toBe('ha_restart_elsewhere');
  });

  it('writes canonical JSON like jsonencode', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe('dry-run summary', () => {
  it('lists effects beyond the resource change, truncated', () => {
    const [diag] = summarizePlan({
      id: 'p',
      status: 'pending',
      changes: [
        { action: 'update', kind: 'Policy', name: 'p', project: 'shop' },
        { action: 'unchanged', kind: 'Project', name: 'shop' },
      ],
      networkChanges: Array.from({ length: 12 }, (_, i) => ({ layer: 'filtering', action: 'update', node: `n${i}` })),
      workloadChanges: [{ action: 'move', replica: 'shop/site/web/0', from: 'n1', to: 'n2', methodLabel: 'live' }],
      warnings: [{ message: 'uncached registry', path: 'images' }],
      risk: { shop: ['internet exposure'] },
      diagnostics: [{ level: 'error', message: 'no route', policy: 'p' }],
    });

    expect(diag.summary).toBe('Loadweaver dry-run plan: update Policy shop/p');
    expect(diag.detail).toContain('filtering update on n0');
    expect(diag.detail).toContain('... and 2 more');
    expect(diag.detail).toContain('move shop/site/web/0 from n1 to n2 (live)');
    expect(diag.detail).toContain('images: uncached registry');
    expect(diag.detail).toContain('shop: internet exposure');
    expect(diag.detail).toContain('error: p: no route');
  });

  it('says nothing when the plan only changes the resource itself', () => {
    expect(
      summarizePlan({ id: 'p', status: 'pending', changes: [{ action: 'create', kind: 'Project', name: 'shop' }] }),
    ).toEqual([]);
  });
});
