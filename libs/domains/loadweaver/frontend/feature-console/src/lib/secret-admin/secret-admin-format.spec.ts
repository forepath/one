import { HttpErrorResponse } from '@angular/common/http';
import type { AccessMe, SecretSummary } from '@forepath/loadweaver/frontend/data-access-console';

import {
  filterSecrets,
  inUseUsages,
  mayManageSecrets,
  mayWriteSecretName,
  rolloutRefs,
  SECRET_NAME_PATTERN,
  secretProjects,
  secretReference,
  staleUsages,
  usageLabel,
} from './secret-admin-format';

const me = (patch: Partial<AccessMe> = {}): AccessMe => ({ userId: 'u1', clusterRole: null, projects: {}, ...patch });

const secret = (patch: Partial<SecretSummary> = {}): SecretSummary => ({
  project: 'shop',
  name: 'db-password',
  version: 3,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-29T00:00:00Z',
  updatedBy: 'alice@example.test',
  reserved: false,
  usedBy: [],
  ...patch,
});

describe('secret administration format (3.40)', () => {
  it('lets project admins / operators and cluster admins manage secrets, nobody else', () => {
    expect(mayManageSecrets(me({ projects: { shop: 'operator' } }), 'shop')).toBe(true);
    expect(mayManageSecrets(me({ projects: { shop: 'admin' } }), 'shop')).toBe(true);
    expect(mayManageSecrets(me({ clusterRole: 'cluster-admin' }), 'shop')).toBe(true);
    expect(mayManageSecrets(me({ projects: { shop: 'developer' } }), 'shop')).toBe(false);
    expect(mayManageSecrets(me({ projects: { shop: 'viewer' } }), 'shop')).toBe(false);
    expect(mayManageSecrets(me({ clusterRole: 'infra-operator' }), 'shop')).toBe(false);
    expect(mayManageSecrets(me({ projects: { other: 'admin' } }), 'shop')).toBe(false);
    expect(mayManageSecrets(null, 'shop')).toBe(false);
    // Cluster-wide page: anyone who manages secrets somewhere (fleet: the cluster-wide grant's project role).
    expect(mayManageSecrets(me({ projects: { a: 'viewer', b: 'operator' } }), null)).toBe(true);
    expect(mayManageSecrets(me({ projects: { a: 'developer' } }), null)).toBe(false);
    expect(mayManageSecrets(me({ allProjects: 'operator' }), null)).toBe(true);
    expect(mayManageSecrets(me({ allProjects: 'viewer' }), null)).toBe(false);
  });

  it('keeps lw- names for cluster admins', () => {
    expect(mayWriteSecretName(me({ projects: { shop: 'admin' } }), 'lw-volume-key')).toBe(false);
    expect(mayWriteSecretName(me({ clusterRole: 'cluster-admin' }), 'lw-volume-key')).toBe(true);
    expect(mayWriteSecretName(me({ projects: { shop: 'admin' } }), 'db-password')).toBe(true);
  });

  it('offers the projects the caller may write', () => {
    expect(secretProjects(me({ projects: { b: 'operator', a: 'admin', c: 'viewer' } }), ['x'])).toEqual(['a', 'b']);
    expect(secretProjects(me({ clusterRole: 'cluster-admin' }), ['z', 'y'])).toEqual(['y', 'z']);
    expect(secretProjects(null, ['a'])).toEqual([]);
  });

  it('validates names like the relay path', () => {
    for (const name of ['db-password', 'DB_PASSWORD', 'tls.key', 'a'])
      expect(SECRET_NAME_PATTERN.test(name)).toBe(true);
    for (const name of ['', '.hidden', '-x', 'a/b', 'a b', 'x'.repeat(254)])
      expect(SECRET_NAME_PATTERN.test(name)).toBe(false);
  });

  it('finds resources on an older version and builds the roll-out refresh list once per resource', () => {
    const s = secret({
      usedBy: [
        { kind: 'Deployment', project: 'shop', name: 'api', pinnedVersion: 2 },
        { kind: 'Deployment', project: 'shop', name: 'api', pinnedVersion: 1 },
        { kind: 'Deployment', project: 'shop', name: 'web', pinnedVersion: 3 },
        { kind: 'VirtualMachine', project: 'shop', name: 'vm1', pinnedVersion: null },
      ],
    });

    expect(staleUsages(s).map((u) => u.name)).toEqual(['api', 'api']);
    expect(rolloutRefs(staleUsages(s))).toEqual([{ kind: 'Deployment', name: 'api', project: 'shop' }]);
    expect(usageLabel(s.usedBy[0], 3)).toBe('Deployment shop/api (v2)');
    expect(usageLabel(s.usedBy[2], 3)).toBe('Deployment shop/web');
    expect(
      usageLabel({
        kind: 'GitConnection',
        project: 'shop',
        name: '141549e4-8012-4637-bf54-b32b0bb88a85',
        pinnedVersion: null,
      }),
    ).toBe('Git connection (shop)');
  });

  it('reads the referencing resources from a 409 only', () => {
    const usedBy = [{ kind: 'Deployment', project: 'shop', name: 'api', pinnedVersion: 3 }];

    expect(inUseUsages(new HttpErrorResponse({ status: 409, error: { message: 'secret is in use', usedBy } }))).toEqual(
      usedBy,
    );
    expect(inUseUsages(new HttpErrorResponse({ status: 403, error: { message: 'no' } }))).toBeNull();
    expect(inUseUsages(new Error('x'))).toBeNull();
  });

  it('filters by name, project, reference and referencing resources', () => {
    const rows = [
      secret(),
      secret({
        project: 'blog',
        name: 'smtp',
        usedBy: [{ kind: 'Deployment', project: 'blog', name: 'mailer', pinnedVersion: 1 }],
      }),
    ];

    expect(filterSecrets(rows, 'mailer').map((s) => s.name)).toEqual(['smtp']);
    expect(filterSecrets(rows, 'secret://shop/').map((s) => s.name)).toEqual(['db-password']);
    expect(filterSecrets(rows, '')).toHaveLength(2);
    expect(secretReference(rows[0])).toBe('secret://shop/db-password');
  });
});
