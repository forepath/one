import { LOADWEAVER_API_VERSION } from './metadata';
import { parseResource, RESOURCE_KIND_NAMES, resourceJsonSchema } from './resource';

const policy = (spec: Record<string, unknown>, project: string | null = 'shop') => ({
  apiVersion: LOADWEAVER_API_VERSION,
  kind: 'Policy',
  metadata: { name: 'web-to-db', ...(project ? { project } : {}) },
  spec,
});

describe('resources', () => {
  it('parses a group-to-group allow policy and applies defaults', () => {
    const result = parseResource(
      policy({ from: [{ group: 'web' }], to: [{ group: 'db' }], rules: [{ ports: [5432] }] }),
    );

    expect(result.ok).toBe(true);

    if (result.ok && result.resource.kind === 'Policy') {
      const spec = result.resource.spec as { mode: string; action: string; rules: { protocol: string }[] };

      expect(spec.mode).toBe('enforce');
      expect(spec.action).toBe('allow');
      expect(spec.rules[0].protocol).toBe('tcp');
    }
  });

  it('takes egress addresses for workloads leaving the cluster only', () => {
    const egress = (extra: Record<string, unknown>) =>
      parseResource(
        policy({
          from: [{ group: 'api' }],
          to: [{ builtin: 'internet' }],
          rules: [{ ports: [443] }],
          egress: { pools: ['egress-v4', 'egress-v6'], reverseDns: 'out.example.com' },
          ...extra,
        }),
      ).ok;

    expect(egress({})).toBe(true);
    expect(egress({ to: [{ cidr: '192.0.2.0/24' }] })).toBe(true);
    expect(egress({ to: [{ group: 'db' }] })).toBe(false);
    expect(egress({ from: [{ builtin: 'cluster' }] })).toBe(false);
    expect(egress({ egress: { pools: [] } })).toBe(false);
    expect(egress({ egress: { pools: ['a'], reverseDns: '*.example.com' } })).toBe(false);
  });

  it('rejects deny between groups (allow-only SG semantics)', () => {
    const result = parseResource(
      policy({ action: 'deny', from: [{ group: 'web' }], to: [{ group: 'db' }], rules: [{ ports: [5432] }] }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0].message).toContain('deny is only allowed for L7');
  });

  it('allows deny at L7 and rejects hostname sources and mixed destinations', () => {
    expect(
      parseResource(
        policy({
          action: 'deny',
          from: [{ group: 'web' }],
          to: [{ host: '*.evil.example' }],
          rules: [{ ports: [443] }],
        }),
      ).ok,
    ).toBe(true);
    expect(parseResource(policy({ from: [{ host: 'a.example' }], to: [{ group: 'db' }], rules: [{}] })).ok).toBe(false);
    expect(
      parseResource(policy({ from: [{ group: 'web' }], to: [{ host: 'a.example' }, { group: 'db' }], rules: [{}] })).ok,
    ).toBe(false);
  });

  it('validates rules, CIDRs and peers', () => {
    expect(parseResource(policy({ from: [{ cidr: '10.0.0.1/8' }], to: [{ group: 'db' }], rules: [{}] })).ok).toBe(
      false,
    );
    expect(
      parseResource(
        policy({ from: [{ cidr: '2001:db8::/32' }], to: [{ group: 'db' }], rules: [{ protocol: 'icmp', ports: [1] }] }),
      ).ok,
    ).toBe(false);
    expect(
      parseResource(
        policy({ from: [{ builtin: 'internet' }], to: [{ group: 'web' }], rules: [{ protocol: 'udp', http: {} }] }),
      ).ok,
    ).toBe(false);
    expect(
      parseResource(
        policy({ from: [{ builtin: 'internet' }], to: [{ group: 'web' }], rules: [{ ports: ['9000-8000'] }] }),
      ).ok,
    ).toBe(false);
    expect(
      parseResource(policy({ from: [{ group: 'web', cidr: '10.0.0.0/8' }], to: [{ group: 'db' }], rules: [{}] })).ok,
    ).toBe(false);
  });

  it('enforces resource scope', () => {
    expect(parseResource(policy({ from: [{ group: 'a' }], to: [{ group: 'b' }], rules: [{}] }, null)).ok).toBe(true);
    expect(
      parseResource({
        apiVersion: LOADWEAVER_API_VERSION,
        kind: 'WorkloadGroup',
        metadata: { name: 'web' },
        spec: { selector: {} },
      }).ok,
    ).toBe(false);
    expect(
      parseResource({
        apiVersion: LOADWEAVER_API_VERSION,
        kind: 'Site',
        metadata: { name: 'fra1', project: 'shop' },
        spec: {},
      }).ok,
    ).toBe(false);
    expect(
      parseResource({ apiVersion: LOADWEAVER_API_VERSION, kind: 'Site', metadata: { name: 'fra1' }, spec: {} }).ok,
    ).toBe(true);
  });

  it('rejects unknown kinds, versions and malformed documents', () => {
    expect(parseResource({ apiVersion: 'v0', kind: 'Site' })).toEqual({
      ok: false,
      issues: [expect.objectContaining({ path: 'apiVersion' })],
    });
    expect(parseResource({ apiVersion: LOADWEAVER_API_VERSION, kind: 'Nope' })).toEqual({
      ok: false,
      issues: [expect.objectContaining({ path: 'kind' })],
    });
    expect(parseResource('text').ok).toBe(false);
  });

  it('requires at least one pod and service pool on the cluster', () => {
    const cluster = (network: Record<string, unknown>) => ({
      apiVersion: LOADWEAVER_API_VERSION,
      kind: 'Cluster',
      metadata: { name: 'c' },
      spec: { network },
    });

    expect(parseResource(cluster({})).ok).toBe(false);
    expect(parseResource(cluster({ podPoolV6: 'fd00:10::/48', servicePoolV6: 'fd00:20::/108' })).ok).toBe(true);
  });

  it('publishes a JSON Schema for every kind', () => {
    for (const k of RESOURCE_KIND_NAMES) {
      const schema = resourceJsonSchema(k);

      expect(schema.$id).toBe(`https://loadweaver.com/schemas/v1/${k}.json`);
      expect(schema.type).toBe('object');
    }
  });
});
