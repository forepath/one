import { policySpecSchema } from '@forepath/loadweaver/shared/util-model';

import type { ParsedDeployment } from '../utils/workload-planning.utils';
import {
  crossProjectReferences,
  exposureIssues,
  planRisk,
  poolRightIssues,
  quotaIssues,
  quotaShares,
  specHash,
  type ProjectUsage,
} from './plan-access.utils';

const policy = (project: string, name: string, spec: Record<string, unknown>) => ({
  kind: 'Policy',
  name,
  project,
  spec: { rules: [{ ports: [443] }], ...spec },
});

describe('plan access checks (3.17)', () => {
  it('finds policies reaching other projects, bound to their spec', () => {
    const spec = { from: [{ group: 'web' }], to: [{ group: 'db', project: 'data' }], rules: [{ ports: [5432] }] };
    const refs = crossProjectReferences([
      { action: 'create', kind: 'Policy', name: 'web-db', project: 'shop', after: { spec } },
      { action: 'delete', kind: 'Policy', name: 'old', project: 'shop', after: null },
    ]);

    expect(refs).toEqual([
      { project: 'shop', policy: 'web-db', peer: 'data', specHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
    // The hash is of the parsed spec, so defaults don't change it.
    expect(refs[0].specHash).toBe(specHash(policySpecSchema.parse(spec)));
  });

  it('only lets projects reference exposed groups of other projects', () => {
    expect(
      exposureIssues([
        { kind: 'WorkloadGroup', name: 'db', project: 'data', spec: { selector: { names: ['db'] } } },
        { kind: 'WorkloadGroup', name: 'api', project: 'data', spec: { selector: { names: ['api'] }, exposed: true } },
        policy('shop', 'a', { from: [{ group: 'web' }], to: [{ group: 'db', project: 'data' }] }),
        policy('shop', 'b', { from: [{ group: 'web' }], to: [{ group: 'api', project: 'data' }] }),
        policy('shop', 'c', { from: [{ group: 'web' }], to: [{ group: 'nope', project: 'data' }] }),
      ]),
    ).toEqual(['Policy shop/a: group data/db is not exposed', 'Policy shop/c: group data/nope does not exist']);
  });

  it('rejects plans over quota and egress from pools the project may not use', () => {
    const usage = new Map<string, ProjectUsage>([
      ['shop', { cpuMillis: 4500, memoryBytes: 9 * 1024 ** 3, storageBytes: 10 * 1024 ** 3, publicIps: 2, ports: 1 }],
    ]);
    const project = {
      kind: 'Project',
      name: 'shop',
      project: null,
      spec: { quota: { cpu: '4', memory: '8g', publicIps: 2 } },
    };

    expect(quotaIssues(usage, [project], ['shop'])).toEqual([
      'project shop: CPU 4.5 exceeds the quota of 4',
      'project shop: memory 9 GiB exceeds the quota of 8 GiB',
    ]);
    expect(quotaIssues(usage, [project], [])).toEqual([]);
    expect(quotaShares(usage, [project])).toEqual([
      { project: 'shop', resource: 'cpu', used: 4500, limit: 4000, share: 1.125 },
      { project: 'shop', resource: 'memory', used: 9 * 1024 ** 3, limit: 8 * 1024 ** 3, share: 1.125 },
      { project: 'shop', resource: 'public IPs', used: 2, limit: 2, share: 1 },
    ]);
    expect(
      poolRightIssues([
        {
          kind: 'IpPool',
          name: 'pub',
          project: null,
          spec: { cidrs: ['203.0.113.0/28'], nodeGroup: 'edge', failover: 'none', projects: ['blog'] },
        },
        policy('shop', 'out', { from: [{ group: 'web' }], to: [{ builtin: 'internet' }], egress: { pools: ['pub'] } }),
      ]),
    ).toEqual(['Policy shop/out: project shop may not use IP pool pub']);
  });

  it('marks pins and internet exposure as risky', () => {
    const parsed = [
      { project: 'shop', name: 'site', compose: { services: [{ http: [{ host: 'shop.example.com' }], ports: [] }] } },
    ] as unknown as ParsedDeployment[];

    expect(
      planRisk(
        [
          { action: 'update', kind: 'Deployment', name: 'site', project: 'shop', after: { spec: {} } },
          {
            action: 'create',
            kind: 'Policy',
            name: 'out',
            project: 'blog',
            after: { spec: { from: [{ group: 'web' }], to: [{ builtin: 'internet' }], rules: [{ ports: [443] }] } },
          },
        ],
        [{ pin: true, project: 'data' }],
        parsed,
      ),
    ).toEqual({ data: ['unacknowledged pins'], shop: ['internet exposure'], blog: ['internet exposure'] });
  });
});
