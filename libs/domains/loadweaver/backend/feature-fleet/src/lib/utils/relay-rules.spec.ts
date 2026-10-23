import type { FleetClusterAccess } from './fleet-access.utils';
import {
  authorizeRelay,
  authorizeSocketNamespace,
  NEVER_RELAYED,
  normalizeRelayPath,
  RELAY_RULES,
} from './relay-rules';

const access = (
  clusterRole: FleetClusterAccess['clusterRole'],
  projects: Record<string, 'viewer' | 'operator' | 'admin'> = {},
  readOnly = false,
): FleetClusterAccess => ({ clusterRole, projects: new Map(Object.entries(projects)), readOnly });
const PLAN = '0b7c6a52-3f7a-4f43-9d1e-2b9a4f0c1d2e';

describe('relay allow-list (3.24)', () => {
  it('lets viewers read and refuses their changes', () => {
    expect(authorizeRelay('GET', 'overview', {}, access('viewer'))).toMatchObject({ allowed: true, role: 'viewer' });
    expect(authorizeRelay('GET', `plans/${PLAN}`, {}, access('viewer')).allowed).toBe(true);
    expect(authorizeRelay('POST', 'plans', {}, access('viewer'))).toMatchObject({ allowed: false, status: 403 });
    expect(authorizeRelay('POST', `plans/${PLAN}/apply`, {}, access('operator')).allowed).toBe(true);
  });

  it('keeps cluster administration for admins', () => {
    expect(authorizeRelay('PUT', 'cluster/members/u1', {}, access('operator'))).toMatchObject({ allowed: false });
    expect(authorizeRelay('PUT', 'cluster/members/u1', {}, access('admin')).allowed).toBe(true);
    expect(authorizeRelay('GET', 'audit', {}, access('operator')).allowed).toBe(false);
    expect(authorizeRelay('POST', 'updates/rollouts', {}, access('admin')).allowed).toBe(true);
  });

  it('never relays secrets, personal or join endpoints', () => {
    for (const [method, path] of [
      ['GET', 'projects/shop/secrets'],
      ['PUT', 'projects/shop/secrets/db'],
      ['GET', 'vpn/devices'],
      ['GET', 'git/accounts'],
      ['GET', 'registry/token'],
      ['POST', 'nodes/join'],
      ['GET', 'install/install.sh'],
      ['GET', 'join-tokens'],
      ['POST', 'join-tokens'],
      ['DELETE', `join-tokens/${PLAN}`],
    ])
      expect(authorizeRelay(method, path, {}, access('admin'))).toMatchObject({ allowed: false, status: 404 });
  });

  it('keeps approvals and acceptances native: never relayed for any role (M1)', () => {
    for (const [method, path] of [
      ['POST', `plans/${PLAN}/approve`],
      ['POST', 'projects/shop/acceptances'],
      ['POST', `backups/deletions/${PLAN}/approve`],
      ['POST', `backups/platform/cutovers/${PLAN}/approve`],
      ['POST', `updates/rollouts/${PLAN}/approve`],
    ])
      expect(authorizeRelay(method, path, {}, access('admin'))).toMatchObject({ allowed: false, status: 404 });
    expect(
      RELAY_RULES.some((r) => r.path.test(`plans/${PLAN}/approve`) || r.path.test('projects/shop/acceptances')),
    ).toBe(false);
    // Cancel / pause stay available.
    expect(authorizeRelay('POST', `backups/deletions/${PLAN}/cancel`, {}, access('admin')).allowed).toBe(true);
    expect(authorizeRelay('POST', `updates/rollouts/${PLAN}/pause`, {}, access('admin')).allowed).toBe(true);
  });

  it('requires admin for replica files and backup contents (M5)', () => {
    for (const [method, path] of [
      ['GET', 'live/files'],
      ['GET', 'live/files/content'],
      ['PUT', 'live/files/content'],
      ['POST', 'live/files/copy'],
      ['DELETE', 'live/files'],
      ['GET', `backups/${PLAN}/download`],
      ['GET', `backups/${PLAN}/archive`],
    ]) {
      expect(authorizeRelay(method, path, {}, access('operator'))).toMatchObject({
        allowed: false,
        status: 403,
        reason: 'needs the admin role',
      });
      expect(authorizeRelay(method, path, {}, access('admin')).allowed).toBe(true);
      expect(authorizeRelay(method, path, {}, access(null, { shop: 'admin' })).allowed).toBe(false);
    }
  });

  it('checks the hard exclusions before any rule', () => {
    for (const path of ['secrets', 'projects/shop/secrets/db', 'join-tokens', 'nodes/join', 'install/x', 'x/approve'])
      expect(NEVER_RELAYED.some((p) => p.test(path))).toBe(true);
    expect(NEVER_RELAYED.some((p) => p.test('plans'))).toBe(false);
  });

  it('forwards only allow-listed parameters on project-filtered lists', () => {
    const projectOnly = access(null, { shop: 'viewer' });

    expect(
      authorizeRelay('GET', 'plans', { project: 'shop', status: 'pending', limit: '5' }, projectOnly).allowed,
    ).toBe(true);
    expect(authorizeRelay('GET', 'plans', { project: 'shop', x0: '1' }, projectOnly)).toMatchObject({
      allowed: false,
      status: 400,
    });
    expect(authorizeRelay('GET', 'backups/restores', { project: 'shop', resource: 'db' }, projectOnly)).toMatchObject({
      status: 400,
    });
  });

  it('applies project grants only on project routes', () => {
    const projectOnly = access(null, { shop: 'operator' });

    expect(authorizeRelay('GET', 'projects/shop/usage', {}, projectOnly)).toMatchObject({
      allowed: true,
      project: 'shop',
    });
    expect(authorizeRelay('GET', 'projects/other/usage', {}, projectOnly).allowed).toBe(false);
    expect(authorizeRelay('GET', 'plans', { project: 'shop' }, projectOnly).allowed).toBe(true);
    // Without the filter the list would show other projects of the service user.
    expect(authorizeRelay('GET', 'plans', {}, projectOnly)).toMatchObject({
      allowed: false,
      reason: 'needs the viewer role',
    });
    expect(authorizeRelay('GET', 'overview', {}, projectOnly)).toMatchObject({
      allowed: false,
      reason: 'needs a cluster-wide grant',
    });
    expect(authorizeRelay('GET', 'plans', { project: 'Bad Name' }, projectOnly)).toMatchObject({ status: 400 });
    expect(authorizeRelay('GET', 'plans', { project: ['shop', 'other'] }, projectOnly)).toMatchObject({ status: 400 });
    // A project grant above the cluster role counts on its project.
    expect(authorizeRelay('POST', 'projects/shop/incidents', {}, access('viewer', { shop: 'operator' })).allowed).toBe(
      true,
    );
  });

  it('allows only reads during the read-only grace', () => {
    const grace = access('viewer', {}, true);

    expect(authorizeRelay('GET', 'overview', {}, grace).allowed).toBe(true);
    expect(authorizeRelay('POST', 'dashboards/query', {}, grace).allowed).toBe(true);
    expect(authorizeRelay('POST', 'plans', {}, grace)).toMatchObject({
      allowed: false,
      reason: 'the cluster is in its read-only grace period',
    });
  });

  it('refuses unsafe paths before matching', () => {
    expect(normalizeRelayPath('/overview/')).toBe('overview');
    for (const path of ['../admin', 'plans/../cluster/members', 'plans//x', 'plans%2F..', 'a\\b', '', 'x'.repeat(1100)])
      expect(normalizeRelayPath(path)).toBeNull();
    expect(authorizeRelay('GET', 'backups/%2e%2e', {}, access('admin'))).toMatchObject({ status: 400 });
  });

  it('has no rule that matches a secrets path', () => {
    expect(RELAY_RULES.some((r) => r.path.test('projects/shop/secrets'))).toBe(false);
  });

  it('relays virtual machines: reads for viewers, power / snapshots / imports for operators (3.35)', () => {
    expect(
      authorizeRelay('GET', 'virtual-machines', { project: 'shop' }, access(null, { shop: 'viewer' })).allowed,
    ).toBe(true);
    expect(
      authorizeRelay('GET', 'projects/shop/virtual-machines/db1', {}, access(null, { shop: 'viewer' })).allowed,
    ).toBe(true);
    expect(authorizeRelay('GET', 'projects/shop/virtual-machines/db1/snapshots', {}, access('viewer')).allowed).toBe(
      true,
    );
    expect(authorizeRelay('POST', 'projects/shop/virtual-machines/db1/reboot', {}, access('viewer')).allowed).toBe(
      false,
    );
    expect(
      authorizeRelay('POST', 'projects/shop/virtual-machines/db1/reboot', {}, access(null, { shop: 'operator' }))
        .allowed,
    ).toBe(true);
    expect(authorizeRelay('POST', 'projects/shop/virtual-machines/db1/snapshots', {}, access('operator')).allowed).toBe(
      true,
    );
    expect(authorizeRelay('POST', 'projects/shop/virtual-machines/db1/explode', {}, access('admin')).allowed).toBe(
      false,
    );
    expect(authorizeRelay('POST', 'projects/shop/vm-images/import', {}, access('operator')).allowed).toBe(true);
    expect(authorizeRelay('GET', 'projects/shop/vm-images', {}, access('viewer')).allowed).toBe(true);
    expect(authorizeSocketNamespace('consoles', access('viewer')).allowed).toBe(false);
    expect(authorizeSocketNamespace('consoles', access('operator')).allowed).toBe(true);
  });

  it('opens socket namespaces for cluster-wide grants only', () => {
    expect(authorizeSocketNamespace('plans', access('viewer')).allowed).toBe(true);
    expect(authorizeSocketNamespace('terminals', access('viewer')).allowed).toBe(false);
    expect(authorizeSocketNamespace('terminals', access('operator')).allowed).toBe(true);
    expect(authorizeSocketNamespace('plans', access(null, { shop: 'admin' })).allowed).toBe(false);
    expect(authorizeSocketNamespace('exec', access('admin')).allowed).toBe(false);
    expect(authorizeSocketNamespace('__proto__', access('admin')).allowed).toBe(false);
  });
});
