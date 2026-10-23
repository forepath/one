import {
  approvalNeeded,
  canReadProject,
  canReadProjectSensitive,
  mayGrant,
  planRequirements,
  projectRole,
  validApproval,
  type AccessCaller,
} from './access.utils';

const caller = (extra: Partial<AccessCaller> = {}): AccessCaller => ({
  userId: 'u1',
  isApiKey: false,
  projects: new Map(),
  ...extra,
});

describe('access rules (3.17)', () => {
  it('derives project roles and read rights', () => {
    const admin = caller({ clusterRole: 'cluster-admin' });
    const dev = caller({ projects: new Map([['shop', 'developer']]) });

    expect(projectRole(admin, 'shop')).toBe('admin');
    expect(projectRole(dev, 'shop')).toBe('developer');
    expect(projectRole(dev, 'blog')).toBeUndefined();
    expect(canReadProject(dev, 'blog')).toBe(false);
    // Infra operators see project resources (they run the nodes) but not logs or secrets.
    expect(canReadProject(caller({ clusterRole: 'infra-operator' }), 'shop')).toBe(true);
    expect(canReadProjectSensitive(caller({ clusterRole: 'infra-operator' }), 'shop')).toBe(false);
    expect(canReadProjectSensitive(caller({ clusterRole: 'auditor' }), 'shop')).toBe(true);
  });

  it('follows Agenstra grant rules', () => {
    const projectAdmin = caller({ projects: new Map([['shop', 'admin']]) });

    expect(mayGrant(projectAdmin, 'shop', 'someone', 'operator', undefined)).toBe(true);
    expect(mayGrant(projectAdmin, 'shop', 'someone', 'admin', undefined)).toBe(false);
    // Can't touch another admin.
    expect(mayGrant(projectAdmin, 'shop', 'someone', null, 'admin')).toBe(false);
    expect(mayGrant(caller({ projects: new Map([['shop', 'operator']]) }), 'shop', null, 'viewer', undefined)).toBe(
      false,
    );
    // The creator and cluster admins assign anything.
    expect(mayGrant(caller({ userId: 'creator' }), 'shop', 'creator', 'admin', undefined)).toBe(true);
    expect(mayGrant(caller({ clusterRole: 'cluster-admin' }), 'shop', null, 'admin', 'admin')).toBe(true);
  });

  it('knows what a plan needs and when it needs an approval', () => {
    expect(
      planRequirements([
        { action: 'update', kind: 'Deployment', project: 'shop' },
        { action: 'unchanged', kind: 'Policy', project: 'blog' },
        { action: 'create', kind: 'NodeGroup', project: null },
      ]),
    ).toEqual({ cluster: 'infra', projects: ['shop'] });
    expect(planRequirements([{ action: 'update', kind: 'Project', project: null }]).cluster).toBe('admin');

    expect(approvalNeeded('developers', 'developer', false)).toBe(true);
    expect(approvalNeeded('developers', 'operator', true)).toBe(false);
    expect(approvalNeeded('risky', 'operator', true)).toBe(true);
    expect(approvalNeeded('risky', 'operator', false)).toBe(false);
    expect(approvalNeeded('everyone', 'admin', false)).toBe(true);

    expect(validApproval({ userId: 'op', role: 'operator' }, 'dev')).toBe(true);
    expect(validApproval({ userId: 'dev', role: 'operator' }, 'dev')).toBe(false);
    expect(validApproval({ userId: 'x', role: 'developer' }, 'dev')).toBe(false);
  });
});
