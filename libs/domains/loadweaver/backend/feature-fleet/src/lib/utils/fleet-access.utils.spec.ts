import { clusterAccess, isReadOnly, maxRole, roleAtLeast, roleFor, type FleetCaller } from './fleet-access.utils';

const user: FleetCaller = { userId: 'u1', isApiKey: false, isAdmin: false, label: 'fleet:u1' };
const admin: FleetCaller = { userId: 'a', isApiKey: false, isAdmin: true, label: 'fleet:a' };
const active = { state: 'active' as const, readOnlyUntil: null };

describe('fleet access (3.24 / 3.17)', () => {
  it('ranks roles', () => {
    expect(roleAtLeast('operator', 'viewer')).toBe(true);
    expect(roleAtLeast('viewer', 'operator')).toBe(false);
    expect(roleAtLeast(null, 'viewer')).toBe(false);
    expect(maxRole('viewer', 'admin')).toBe('admin');
    expect(maxRole(null, 'viewer')).toBe('viewer');
  });

  it('combines cluster-wide and project grants', () => {
    const access = clusterAccess(
      user,
      [
        { role: 'viewer', project: null },
        { role: 'operator', project: 'shop' },
        { role: 'viewer', project: 'blog' },
      ],
      active,
    );

    expect(access.clusterRole).toBe('viewer');
    // `blog` adds nothing beyond the cluster-wide viewer grant.
    expect([...access.projects.entries()]).toEqual([['shop', 'operator']]);
    expect(roleFor(access, 'shop')).toBe('operator');
    expect(roleFor(access, 'blog')).toBe('viewer');
    expect(roleFor(access)).toBe('viewer');
  });

  it('makes admins admin everywhere and closes retired clusters', () => {
    expect(clusterAccess(admin, [], active).clusterRole).toBe('admin');
    expect(clusterAccess(admin, [], { state: 'retired', readOnlyUntil: null }).clusterRole).toBeNull();
    expect(
      clusterAccess(user, [{ role: 'admin', project: null }], { state: 'retired', readOnlyUntil: null }).clusterRole,
    ).toBeNull();
  });

  it('downgrades every grant to viewer during the read-only grace', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const grace = { state: 'teardown' as const, readOnlyUntil: new Date('2026-10-27T00:00:00Z') };

    expect(isReadOnly(grace, now)).toBe(true);
    expect(isReadOnly({ state: 'active', readOnlyUntil: new Date('2026-10-19T00:00:00Z') }, now)).toBe(false);

    const access = clusterAccess(
      user,
      [
        { role: 'admin', project: null },
        { role: 'admin', project: 'shop' },
      ],
      grace,
      now,
    );

    expect(access).toMatchObject({ clusterRole: 'viewer', readOnly: true });
    expect(roleFor(access, 'shop')).toBe('viewer');
    expect(clusterAccess(admin, [], grace, now).clusterRole).toBe('viewer');
  });
});
