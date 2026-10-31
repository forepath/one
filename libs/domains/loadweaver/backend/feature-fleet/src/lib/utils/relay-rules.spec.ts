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

  it("relays a node's platform components as a viewer read like the node (2026-10-30)", () => {
    expect(authorizeRelay('GET', 'nodes/lw-devnode-1/platform', {}, access('viewer'))).toMatchObject({
      allowed: true,
      role: 'viewer',
    });
    expect(authorizeRelay('POST', 'nodes/lw-devnode-1/platform', {}, access('admin')).allowed).toBe(false);
    expect(authorizeRelay('GET', 'nodes/lw-devnode-1/platform', {}, access(null, { shop: 'admin' })).allowed).toBe(
      false,
    );
  });

  it('relays Workspace drafts and dry-run previews like plans (3.36)', () => {
    expect(authorizeRelay('GET', 'drafts', { status: 'open' }, access('viewer')).allowed).toBe(true);
    expect(authorizeRelay('GET', `drafts/${PLAN}`, {}, access('viewer')).allowed).toBe(true);

    for (const [method, path] of [
      ['POST', 'drafts'],
      ['PATCH', `drafts/${PLAN}`],
      ['POST', `drafts/${PLAN}/preview`],
      ['POST', `drafts/${PLAN}/submit`],
      ['POST', `drafts/${PLAN}/discard`],
      ['POST', 'topology/preview'],
    ]) {
      expect(authorizeRelay(method, path, {}, access('viewer'))).toMatchObject({ allowed: false, status: 403 });
      expect(authorizeRelay(method, path, {}, access('operator')).allowed).toBe(true);
      expect(authorizeRelay(method, path, {}, access('operator', {}, true)).allowed).toBe(false);
    }

    expect(authorizeRelay('DELETE', `drafts/${PLAN}`, {}, access('admin')).allowed).toBe(false);
  });

  it('relays the Workspace / plans for project grants only with the signed identity claim (full parity)', () => {
    const projectOperator = access(null, { shop: 'operator' });

    for (const [method, path] of [
      ['GET', 'resources'],
      ['GET', 'topology'],
      ['GET', 'schemas/Deployment'],
      ['GET', 'drafts'],
      ['POST', 'drafts'],
      ['PATCH', `drafts/${PLAN}`],
      ['POST', `drafts/${PLAN}/submit`],
      ['POST', 'topology/preview'],
      ['POST', 'plans'],
      ['POST', `plans/${PLAN}/apply`],
      ['POST', 'backups/now'],
    ])
      expect(authorizeRelay(method, path, {}, projectOperator)).toMatchObject({ allowed: true, needsClaim: true });

    // Never more than the grant: project viewers read, but don't change.
    expect(authorizeRelay('GET', 'topology', {}, access(null, { shop: 'viewer' }))).toMatchObject({ needsClaim: true });
    expect(authorizeRelay('POST', 'drafts', {}, access(null, { shop: 'viewer' }))).toMatchObject({ allowed: false });
    // Cluster-wide grants need no claim; the read-only grace still blocks changes.
    expect(authorizeRelay('POST', 'drafts', {}, access('operator'))).not.toHaveProperty('needsClaim');
    expect(authorizeRelay('POST', 'drafts', {}, access(null, { shop: 'operator' }, true)).allowed).toBe(false);
    // Cluster-wide only routes stay so.
    expect(authorizeRelay('POST', `nodes/n1/drain`, {}, projectOperator).allowed).toBe(false);
  });

  it('relays Git connection administration for cluster-wide admins without a claim (full parity)', () => {
    for (const [method, path] of [
      ['POST', 'git/connections'],
      ['PATCH', `git/connections/${PLAN}`],
      ['DELETE', `git/connections/${PLAN}`],
      ['GET', `git/connections/${PLAN}/webhook-secret`],
      ['POST', `git/connections/${PLAN}/webhook-secret/rotate`],
      ['POST', `git/connections/${PLAN}/host-key/reset`],
      ['POST', `git/connections/${PLAN}/test`],
      ['POST', `git/connections/${PLAN}/sync`],
      ['POST', `git/connections/${PLAN}/export`],
    ]) {
      const decision = authorizeRelay(method, path, {}, access('admin'));

      expect(decision.allowed).toBe(true);
      expect(decision).not.toHaveProperty('needsClaim');
      expect(authorizeRelay(method, path, {}, access('operator')).allowed).toBe(false);
    }

    expect(authorizeRelay('GET', 'git/sops/recipient', {}, access('viewer')).allowed).toBe(true);

    for (const [method, path] of [
      ['GET', 'admin/webhooks'],
      ['GET', 'admin/webhooks/event-types'],
      ['GET', `admin/webhooks/${PLAN}/deliveries`],
      ['POST', 'admin/webhooks'],
      ['PUT', `admin/webhooks/${PLAN}`],
      ['DELETE', `admin/webhooks/${PLAN}`],
      ['POST', `admin/webhooks/${PLAN}/test`],
      ['GET', 'updates/announcements'],
      ['GET', 'updates/announcements/status'],
      ['POST', 'updates/announcements/check'],
    ]) {
      expect(authorizeRelay(method, path, {}, access('admin')).allowed).toBe(true);
      expect(authorizeRelay(method, path, {}, access('operator')).allowed).toBe(false);
      expect(authorizeRelay(method, path, {}, access(null, { shop: 'admin' })).allowed).toBe(false);
    }
    // Access import, etcd snapshot download and bundle upload: cluster-wide admins (2026-10-27).
    for (const [method, path] of [
      ['POST', 'access/import'],
      ['GET', 'backups/platform/etcd/etcd-20261027t101500z'],
      ['POST', 'updates/bundles'],
    ]) {
      expect(authorizeRelay(method, path, {}, access('admin')).allowed).toBe(true);
      expect(authorizeRelay(method, path, {}, access('operator')).allowed).toBe(false);
      expect(authorizeRelay(method, path, {}, access(null, { shop: 'admin' })).allowed).toBe(false);
    }
    expect(authorizeRelay('GET', 'backups/platform/etcd/other', {}, access('admin')).allowed).toBe(false);
  });

  it('relays Git connections for project grants only as the signed person (3.41)', () => {
    const projectAdmin = access(null, { shop: 'admin' });
    const projectViewer = access(null, { shop: 'viewer' });

    for (const [method, path] of [
      ['GET', 'git/connections'],
      ['GET', `git/connections/${PLAN}`],
      ['GET', `git/connections/${PLAN}/commits`],
      ['POST', 'git/connections'],
      ['PATCH', `git/connections/${PLAN}`],
      ['DELETE', `git/connections/${PLAN}`],
      ['GET', `git/connections/${PLAN}/webhook-secret`],
      ['POST', `git/connections/${PLAN}/webhook-secret/rotate`],
      ['POST', `git/connections/${PLAN}/sync`],
    ])
      expect(authorizeRelay(method, path, {}, projectAdmin)).toMatchObject({ allowed: true, needsClaim: true });

    // Project viewers read (the cluster lists what the person may see), but never manage.
    expect(authorizeRelay('GET', 'git/connections', {}, projectViewer)).toMatchObject({
      allowed: true,
      needsClaim: true,
    });
    expect(authorizeRelay('POST', 'git/connections', {}, projectViewer)).toMatchObject({ allowed: false, status: 403 });
    expect(authorizeRelay('PATCH', `git/connections/${PLAN}`, {}, access(null, { shop: 'operator' })).allowed).toBe(
      false,
    );
    // Cluster-wide viewers read without a claim (as natively: auditors see every connection), but don't manage.
    expect(authorizeRelay('GET', 'git/connections', {}, access('viewer'))).not.toHaveProperty('needsClaim');
    expect(authorizeRelay('POST', 'git/connections', {}, access('operator')).allowed).toBe(false);
    // The read-only grace blocks changes.
    expect(authorizeRelay('POST', 'git/connections', {}, access(null, { shop: 'admin' }, true)).allowed).toBe(false);
  });

  it('relays linked Git accounts per fleet person: always with the claim, any grant (3.41)', () => {
    for (const grant of [access('admin'), access('viewer'), access(null, { shop: 'viewer' })])
      for (const [method, path] of [
        ['GET', 'git/accounts'],
        ['POST', 'git/accounts/github/authorize'],
        ['POST', 'git/accounts/gitlab/authorize'],
        ['GET', 'git/accounts/pending/abcdefghijklmnop_-12'],
        ['DELETE', 'git/accounts/pending/abcdefghijklmnop_-12'],
        ['POST', 'git/accounts/confirm'],
        ['DELETE', `git/accounts/${PLAN}`],
      ])
        expect(authorizeRelay(method, path, {}, grant)).toMatchObject({ allowed: true, needsClaim: true });

    expect(authorizeRelay('POST', 'git/accounts/github/authorize', {}, access('viewer'))).toMatchObject({
      rule: { consoleReturn: true },
    });
    // The OAuth callback stays on the cluster's public URL; unknown providers / malformed nonces aren't relayed.
    expect(authorizeRelay('GET', 'git/accounts/github/callback', {}, access('admin')).allowed).toBe(false);
    expect(authorizeRelay('POST', 'git/accounts/gitea/authorize', {}, access('admin')).allowed).toBe(false);
    expect(authorizeRelay('GET', 'git/accounts/pending/short', {}, access('admin')).allowed).toBe(false);
    expect(authorizeRelay('GET', 'git/accounts', {}, access(null))).toMatchObject({ allowed: false });
  });

  it('relays certificate upload / delete at the operator level, cluster-wide (3.41)', () => {
    for (const method of ['PUT', 'DELETE']) {
      expect(authorizeRelay(method, 'certificates/shop-tls', {}, access('operator'))).toMatchObject({
        allowed: true,
        role: 'operator',
      });
      expect(authorizeRelay(method, 'certificates/shop-tls', {}, access('viewer'))).toMatchObject({ status: 403 });
      expect(authorizeRelay(method, 'certificates/shop-tls', {}, access(null, { shop: 'admin' }))).toMatchObject({
        allowed: false,
        reason: 'needs a cluster-wide grant',
      });
      expect(authorizeRelay(method, 'certificates/shop-tls', {}, access('operator', {}, true)).allowed).toBe(false);
    }
  });

  it('relays the integrations hub: status for admins, tests for operators, cluster-wide (3.41)', () => {
    expect(authorizeRelay('GET', 'integrations', {}, access('admin')).allowed).toBe(true);
    expect(authorizeRelay('GET', 'integrations', {}, access('operator'))).toMatchObject({ status: 403 });
    expect(authorizeRelay('POST', 'integrations/test', {}, access('operator')).allowed).toBe(true);
    expect(authorizeRelay('POST', 'integrations/test', {}, access('viewer'))).toMatchObject({ status: 403 });
    expect(authorizeRelay('POST', 'integrations/test', {}, access(null, { shop: 'admin' })).allowed).toBe(false);
    expect(authorizeRelay('PUT', 'integrations', {}, access('admin'))).toMatchObject({ status: 404 });
  });

  it('keeps cluster administration for admins', () => {
    expect(authorizeRelay('PUT', 'cluster/members/u1', {}, access('operator'))).toMatchObject({ allowed: false });
    expect(authorizeRelay('PUT', 'cluster/members/u1', {}, access('admin')).allowed).toBe(true);
    expect(authorizeRelay('GET', 'audit', {}, access('operator')).allowed).toBe(false);
    expect(authorizeRelay('POST', 'updates/rollouts', {}, access('admin')).allowed).toBe(true);
  });

  it('never relays personal, node-agent join or installer endpoints', () => {
    for (const [method, path] of [
      ['GET', 'vpn/devices'],
      ['GET', 'registry/token'],
      ['POST', 'nodes/join'],
      ['GET', 'install/install.sh'],
    ])
      expect(authorizeRelay(method, path, {}, access('admin'))).toMatchObject({ allowed: false, status: 404 });
  });

  it('relays the recovery kit as the signed person for cluster-wide admins only (2026-10-30)', () => {
    for (const path of ['backups/keys/2/kit', 'backups/keys/2/kit/shares/1', 'backups/keys/2/kit/confirm']) {
      const allowed = authorizeRelay('POST', path, {}, access('admin'));

      expect(allowed).toMatchObject({ allowed: true, role: 'admin', project: null, needsClaim: true });
      expect(allowed.allowed && allowed.rule.secret).toBe(true);
      expect(authorizeRelay('POST', path, {}, access('operator'))).toMatchObject({
        allowed: false,
        status: 403,
        reason: 'needs the admin role',
      });
      expect(authorizeRelay('POST', path, {}, access(null, { shop: 'admin' }))).toMatchObject({
        allowed: false,
        status: 403,
        reason: 'needs a cluster-wide grant',
      });
      expect(authorizeRelay('POST', path, {}, access('admin', {}, true))).toMatchObject({
        allowed: false,
        status: 403,
      });
      expect(authorizeRelay('GET', path, {}, access('admin'))).toMatchObject({ allowed: false, status: 404 });
    }
    for (const path of ['backups/keys/x/kit', 'backups/keys/2/kit/shares/x', 'backups/keys/2/kit/other'])
      expect(authorizeRelay('POST', path, {}, access('admin'))).toMatchObject({ allowed: false, status: 404 });
  });

  it('relays join tokens for cluster-wide admins only (2026-10-26)', () => {
    for (const [method, path] of [
      ['GET', 'join-tokens'],
      ['POST', 'join-tokens'],
      ['DELETE', `join-tokens/${PLAN}`],
    ]) {
      expect(authorizeRelay(method, path, {}, access('admin'))).toMatchObject({ allowed: true, role: 'admin' });
      expect(authorizeRelay(method, path, {}, access('operator'))).toMatchObject({
        allowed: false,
        status: 403,
        reason: 'needs the admin role',
      });
      expect(authorizeRelay(method, path, {}, access(null, { shop: 'admin' }))).toMatchObject({
        allowed: false,
        reason: 'needs a cluster-wide grant',
      });
      expect(authorizeRelay(method, path, {}, access('viewer', {}, true))).toMatchObject({
        allowed: false,
        status: 403,
      });
    }
    expect(authorizeRelay('DELETE', 'join-tokens/not-a-uuid', {}, access('admin'))).toMatchObject({ status: 404 });
    expect(authorizeRelay('PUT', 'join-tokens', {}, access('admin'))).toMatchObject({ status: 404 });
  });

  it('relays the admin actions the console offers (2026-10-26)', () => {
    for (const [method, path] of [
      ['POST', 'backups/keys/2/escrow'],
      ['GET', 'backups/platform/dr-info'],
      ['POST', 'backups/platform/postgres/restores'],
      ['DELETE', `backups/platform/postgres/restores/${PLAN}`],
      ['POST', 'backups/platform/opensearch/restore'],
      ['POST', 'posture/integrations'],
      ['POST', 'posture/integrations/test'],
      ['PATCH', `posture/integrations/${PLAN}`],
      ['DELETE', `posture/integrations/${PLAN}`],
      ['POST', `posture/integrations/${PLAN}/test`],
      ['POST', `posture/integrations/${PLAN}/sync`],
      ['PUT', 'posture/certificates'],
      ['POST', 'wallboards'],
      ['DELETE', `wallboards/${PLAN}`],
      ['POST', 'imports/node-1/discover'],
      ['PUT', 'imports/node-1/selection'],
      ['POST', 'imports/node-1/plan'],
      ['DELETE', 'imports/node-1'],
    ]) {
      expect(authorizeRelay(method, path, {}, access('admin')).allowed).toBe(true);
      expect(authorizeRelay(method, path, {}, access('operator'))).toMatchObject({ allowed: false, status: 403 });
      expect(authorizeRelay(method, path, {}, access(null, { shop: 'admin' })).allowed).toBe(false);
    }
  });

  it('relays the global search for cluster-wide grants only', () => {
    expect(authorizeRelay('GET', 'search', { q: 'db', limit: '10' }, access('viewer')).allowed).toBe(true);
    expect(authorizeRelay('GET', 'search', { q: 'db' }, access(null, { shop: 'admin' }))).toMatchObject({
      allowed: false,
      reason: 'needs a cluster-wide grant',
    });
  });

  it('relays search favourites / recents per person: always with the claim, cluster-wide grants (2026-10-27)', () => {
    for (const [method, path] of [
      ['GET', 'search/favorites'],
      ['PUT', 'search/favorites/Deployment%3Ashop%2Fweb'],
      ['DELETE', 'search/favorites/Node:n2'],
      ['POST', 'search/recent'],
    ]) {
      expect(authorizeRelay(method, path, {}, access('viewer'))).toMatchObject({ allowed: true, needsClaim: true });
      expect(authorizeRelay(method, path, {}, access('admin'))).toMatchObject({ allowed: true, needsClaim: true });
      expect(authorizeRelay(method, path, {}, access('viewer', {}, true))).toMatchObject({ allowed: true });
      expect(authorizeRelay(method, path, {}, access(null, { shop: 'admin' })).allowed).toBe(false);
    }

    // Encoded characters only in a favourite's item, and only `%2F` / `%3A`.
    expect(normalizeRelayPath('search/favorites/Deployment%3Ashop%2Fweb')).toBe(
      'search/favorites/Deployment%3Ashop%2Fweb',
    );
    expect(normalizeRelayPath('search/favorites/Node%3An1%2E%2E')).toBeNull();
    expect(normalizeRelayPath('search/favorites/x%2F..%2Fsecrets/y')).toBeNull();
    expect(normalizeRelayPath('projects/shop%2Fsecrets')).toBeNull();
  });

  it('relays saved views per person like favourites: always with the claim (3.37)', () => {
    for (const [method, path] of [
      ['GET', 'views'],
      ['POST', 'views'],
      ['PATCH', `views/${PLAN}`],
      ['DELETE', `views/${PLAN}`],
    ]) {
      expect(authorizeRelay(method, path, {}, access('viewer'))).toMatchObject({ allowed: true, needsClaim: true });
      expect(authorizeRelay(method, path, {}, access('admin'))).toMatchObject({ allowed: true, needsClaim: true });
      expect(authorizeRelay(method, path, {}, access(null, { shop: 'admin' })).allowed).toBe(false);
    }

    expect(authorizeRelay('GET', 'views', { scope: 'contents' }, access('viewer'))).toMatchObject({ allowed: true });
    expect(authorizeRelay('PUT', `views/${PLAN}`, {}, access('admin')).allowed).toBe(false);
    expect(authorizeRelay('DELETE', 'views/not-a-uuid', {}, access('admin')).allowed).toBe(false);
  });

  it('streams the release bundle upload for cluster-wide admins (2026-10-27)', () => {
    const decision = authorizeRelay('POST', 'updates/bundles', {}, access('admin'));

    expect(decision).toMatchObject({ allowed: true });
    expect(decision.allowed && decision.rule.stream).toBe(true);
    expect(RELAY_RULES.filter((r) => r.stream)).toHaveLength(1);
    expect(authorizeRelay('POST', 'updates/bundles', {}, access('operator')).allowed).toBe(false);
  });

  it('relays approvals as approval rules (signed identity, 3.24): any grant for plans / deletions, admin for cut-overs / rollouts', () => {
    expect(authorizeRelay('POST', `plans/${PLAN}/approve`, {}, access(null, { shop: 'operator' }))).toMatchObject({
      allowed: true,
      rule: { approval: true },
    });
    expect(authorizeRelay('POST', `backups/deletions/${PLAN}/approve`, {}, access('viewer')).allowed).toBe(true);
    expect(authorizeRelay('POST', `plans/${PLAN}/approve`, {}, access(null))).toMatchObject({ allowed: false });
    expect(authorizeRelay('POST', 'projects/shop/acceptances', {}, access(null, { shop: 'operator' }))).toMatchObject({
      allowed: true,
      project: 'shop',
      rule: { approval: true },
    });
    expect(authorizeRelay('POST', 'projects/shop/acceptances', {}, access(null, { other: 'admin' })).allowed).toBe(
      false,
    );
    expect(authorizeRelay('POST', `backups/platform/cutovers/${PLAN}/approve`, {}, access('operator')).allowed).toBe(
      false,
    );
    expect(authorizeRelay('POST', `backups/platform/cutovers/${PLAN}/approve`, {}, access('admin')).allowed).toBe(true);
    expect(authorizeRelay('POST', `updates/rollouts/${PLAN}/approve`, {}, access('admin')).allowed).toBe(true);
    // Not during the read-only grace, and never the cluster's trust anchor.
    expect(authorizeRelay('POST', `plans/${PLAN}/approve`, {}, access('admin', {}, true)).allowed).toBe(false);
    for (const [method, path] of [
      ['GET', 'trusted-fleets'],
      ['PUT', 'trusted-fleets/fleet-1'],
      ['DELETE', 'trusted-fleets/fleet-1'],
    ])
      expect(authorizeRelay(method, path, {}, access('admin'))).toMatchObject({ allowed: false, status: 404 });
    // Cancel / pause stay ordinary rules.
    expect(authorizeRelay('POST', `backups/deletions/${PLAN}/cancel`, {}, access('admin'))).not.toMatchObject({
      rule: { approval: true },
    });
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
    expect(NEVER_RELAYED).toHaveLength(3);
    for (const path of ['nodes/join', 'install/x', 'trusted-fleets/fleet-1'])
      expect(NEVER_RELAYED.some((p) => p.test(path))).toBe(true);
    for (const path of [
      'plans',
      'join-tokens',
      'backups/keys/1/escrow',
      'backups/keys/1/kit',
      'backups/keys/1/kit/shares/2',
      'backups/keys/1/kit/confirm',
      `plans/${PLAN}/approve`,
      'projects/shop/secrets',
    ])
      expect(NEVER_RELAYED.some((p) => p.test(path))).toBe(false);
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

  it('relays project secrets as the signed person for project writers and cluster admins (2026-10-29)', () => {
    for (const [method, path] of [
      ['GET', 'projects/shop/secrets'],
      ['GET', 'projects/shop/secrets/names'],
      ['PUT', 'projects/shop/secrets/db-password'],
      ['DELETE', 'projects/shop/secrets/db.password_2'],
    ]) {
      for (const who of [access(null, { shop: 'operator' }), access(null, { shop: 'admin' }), access('admin')])
        expect(authorizeRelay(method, path, {}, who)).toMatchObject({
          allowed: true,
          project: 'shop',
          needsClaim: true,
        });
      for (const who of [access(null, { shop: 'viewer' }), access('viewer'), access(null, { other: 'admin' })])
        expect(authorizeRelay(method, path, {}, who)).toMatchObject({ allowed: false, status: 403 });
    }
    expect(authorizeRelay('GET', 'secrets', { project: 'shop' }, access(null, { shop: 'operator' }))).toMatchObject({
      allowed: true,
      needsClaim: true,
    });
    expect(authorizeRelay('GET', 'secrets', { other: 'x' }, access('admin'))).toMatchObject({ status: 400 });
    // Reading a value or the version history is no route; neither is any other verb.
    for (const [method, path] of [
      ['GET', 'projects/shop/secrets/db-password'],
      ['POST', 'projects/shop/secrets'],
      ['PATCH', 'projects/shop/secrets/db-password'],
      ['PUT', 'projects/shop/secrets/.hidden'],
    ])
      expect(authorizeRelay(method, path, {}, access('admin'))).toMatchObject({ allowed: false, status: 404 });
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
    // The VM image catalog (3.42): read-only, any grant (a project's too), no identity claim needed.
    for (const grant of [access('viewer'), access(null, { shop: 'viewer' }), access('viewer', {}, true)])
      for (const path of ['vm-images/catalog', 'vm-images/catalog/upstream'])
        expect(authorizeRelay('GET', path, {}, grant)).toMatchObject({ allowed: true, role: 'viewer' });
    expect(authorizeRelay('GET', 'vm-images/catalog', {}, access(null, { shop: 'viewer' }))).not.toHaveProperty(
      'needsClaim',
    );
    expect(authorizeRelay('GET', 'vm-images/catalog', {}, access(null)).allowed).toBe(false);
    expect(authorizeRelay('POST', 'vm-images/catalog', {}, access('admin')).allowed).toBe(false);
    expect(authorizeRelay('GET', 'vm-images/catalog/ubuntu/versions', {}, access('admin')).allowed).toBe(false);
    expect(authorizeSocketNamespace('consoles', access('viewer')).allowed).toBe(false);
    expect(authorizeSocketNamespace('consoles', access('operator')).allowed).toBe(true);
  });

  it('opens socket namespaces for cluster-wide grants only', () => {
    expect(authorizeSocketNamespace('plans', access('viewer')).allowed).toBe(true);
    expect(authorizeSocketNamespace('terminals', access('viewer')).allowed).toBe(false);
    expect(authorizeSocketNamespace('terminals', access('operator')).allowed).toBe(true);
    // Project grants: the person-scoped streams with the signed claim (the cluster filters events), nothing else.
    expect(authorizeSocketNamespace('plans', access(null, { shop: 'viewer' }))).toEqual({
      allowed: true,
      needsClaim: true,
    });
    expect(authorizeSocketNamespace('topology', access(null, { shop: 'admin' }))).toEqual({
      allowed: true,
      needsClaim: true,
    });
    expect(authorizeSocketNamespace('plans', access('viewer'))).toEqual({ allowed: true });
    expect(authorizeSocketNamespace('logs', access(null, { shop: 'admin' })).allowed).toBe(false);
    expect(authorizeSocketNamespace('terminals', access(null, { shop: 'admin' })).allowed).toBe(false);
    expect(authorizeSocketNamespace('exec', access('admin')).allowed).toBe(false);
    expect(authorizeSocketNamespace('__proto__', access('admin')).allowed).toBe(false);
  });
});
