import type { AccessMe } from '@forepath/loadweaver/frontend/data-access-console';

import {
  administersSomething,
  approvalsAvailable,
  atLeastRole,
  favouritesAvailable,
  hasAnyRole,
  mayGrantProjectAdmin,
  projectRoleOf,
} from './access-format';

const me = (overrides: Partial<AccessMe> = {}): AccessMe => ({
  userId: 'u1',
  clusterRole: null,
  projects: {},
  ...overrides,
});

describe('access format', () => {
  it('treats cluster admins as admins of every project', () => {
    expect(projectRoleOf(me({ clusterRole: 'cluster-admin' }), 'shop')).toBe('admin');
    expect(projectRoleOf(me({ clusterRole: 'auditor' }), 'shop')).toBeNull();
    expect(projectRoleOf(me({ projects: { shop: 'developer' } }), 'shop')).toBe('developer');
    expect(atLeastRole('operator', 'operator')).toBe(true);
    expect(atLeastRole('developer', 'operator')).toBe(false);
    expect(atLeastRole(null, 'viewer')).toBe(false);
  });

  it('decides who sees the access and wallboard views', () => {
    expect(hasAnyRole(null)).toBe(false);
    expect(hasAnyRole(me())).toBe(false);
    expect(hasAnyRole(me({ projects: { shop: 'viewer' } }))).toBe(true);
    expect(hasAnyRole(me({ clusterRole: 'auditor' }))).toBe(true);
    expect(administersSomething(me({ clusterRole: 'auditor', projects: { shop: 'operator' } }))).toBe(false);
    expect(administersSomething(me({ projects: { shop: 'admin' } }))).toBe(true);
    expect(administersSomething(me({ clusterRole: 'cluster-admin' }))).toBe(true);
  });

  it('lets cluster admins and the project creator manage project admins', () => {
    const settings = {
      project: 'shop',
      approvalMode: 'developers' as const,
      developerExec: false,
      recordTerminals: false,
      createdBy: 'u1',
    };

    expect(mayGrantProjectAdmin(me({ projects: { shop: 'admin' } }), settings)).toBe(true);
    expect(mayGrantProjectAdmin(me({ userId: 'u2', projects: { shop: 'admin' } }), settings)).toBe(false);
    expect(mayGrantProjectAdmin(me({ userId: 'u2', clusterRole: 'cluster-admin' }), null)).toBe(true);
  });

  it('fleet mode (3.24): cluster-wide grants give a role in every project; approvals only when the cluster trusts the fleet', () => {
    expect(projectRoleOf(me({ clusterRole: 'infra-operator', allProjects: 'operator' }), 'shop')).toBe('operator');
    expect(projectRoleOf(me({ allProjects: 'viewer', projects: { shop: 'admin' } }), 'shop')).toBe('admin');
    expect(approvalsAvailable(false, null)).toBe(true);
    expect(approvalsAvailable(true, me({ fleetApprovals: false }))).toBe(false);
    expect(approvalsAvailable(true, me({ fleetApprovals: true }))).toBe(true);
    expect(approvalsAvailable(true, null)).toBe(false);
    // Search favourites (2026-10-27): the person's, also during the read-only grace.
    expect(favouritesAvailable(false, null)).toBe(true);
    expect(favouritesAvailable(true, me({ fleetIdentity: true, fleetApprovals: false }))).toBe(true);
    expect(favouritesAvailable(true, me({ fleetIdentity: false }))).toBe(false);
    expect(favouritesAvailable(true, null)).toBe(false);
  });
});
