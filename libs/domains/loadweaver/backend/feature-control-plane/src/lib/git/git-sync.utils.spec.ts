import { createHmac } from 'node:crypto';

import { parseResourceDocuments, type Resource } from '@forepath/loadweaver/shared/util-model';

import { carrierOf, touchedConnections } from './git-scope.service';
import {
  collectGitResources,
  commitStateOf,
  commitStatusOf,
  consoleBaseUrl,
  diffAgainstCluster,
  inScope,
  limitDiff,
  newWebhookSalt,
  payloadMatchesRepo,
  pushSender,
  replaceResourceDocument,
  resourceKey,
  verifyWebhook,
  webhookDeliveryId,
  webhookEvent,
  webhookSecret,
  type ClusterRow,
} from './git-sync.utils';

const group = (name: string, project: string, labels: Record<string, string> = { app: name }) =>
  `apiVersion: loadweaver.com/v1\nkind: WorkloadGroup\nmetadata: { name: ${name}, project: ${project} }\nspec:\n  selector: { matchLabels: { app: ${labels['app']} } }\n`;

function resources(text: string): Resource[] {
  const parsed = parseResourceDocuments(text);

  if (parsed.ok === false) throw new Error(JSON.stringify(parsed.issues));

  return parsed.resources;
}

function row(resource: Resource, generation = 1): ClusterRow {
  return {
    kind: resource.kind,
    name: resource.metadata.name,
    project: resource.metadata.project ?? null,
    generation,
    body: {
      labels: resource.metadata.labels ?? {},
      annotations: resource.metadata.annotations ?? {},
      spec: resource.spec,
    },
  };
}

describe('git sync utils', () => {
  describe('scope rule', () => {
    it('project connections carry only their project; the cluster one the rest', () => {
      const own = new Set(['shop']);

      expect(inScope({ project: 'shop' }, { project: 'shop', ownConnections: own })).toBe(true);
      expect(inScope({ project: 'blog' }, { project: 'shop', ownConnections: own })).toBe(false);
      expect(inScope({ project: null }, { project: 'shop', ownConnections: own })).toBe(false);
      expect(inScope({ project: null }, { project: null, ownConnections: own })).toBe(true);
      expect(inScope({ project: 'blog' }, { project: null, ownConnections: own })).toBe(true);
      expect(inScope({ project: 'shop' }, { project: null, ownConnections: own })).toBe(false);
    });

    it('finds the connection carrying a change, and the touched connections', () => {
      const connections = [
        { id: 'c', project: null },
        { id: 's', project: 'shop' },
      ];

      expect(carrierOf('shop', connections)?.id).toBe('s');
      expect(carrierOf('blog', connections)?.id).toBe('c');
      expect(carrierOf(null, connections)?.id).toBe('c');
      expect(carrierOf('blog', [{ id: 's', project: 'shop' }])).toBeNull();
      expect(
        touchedConnections(
          [
            { action: 'update', project: 'shop' },
            { action: 'unchanged', project: null },
            { action: 'create', project: 'shop' },
          ],
          connections,
        ).map((c) => c.id),
      ).toEqual(['s']);
    });
  });

  it('collects resources per file and reports invalid documents and duplicates with their file', () => {
    const ok = collectGitResources([
      { path: 'shop/a.yaml', text: `${group('a', 'shop')}---\n${group('b', 'shop')}` },
      { path: 'shop/c.yaml', text: group('c', 'shop') },
    ]);

    expect(ok.issues).toEqual([]);
    expect(ok.resources.map((r) => [r.resource.metadata.name, r.path])).toEqual([
      ['a', 'shop/a.yaml'],
      ['b', 'shop/a.yaml'],
      ['c', 'shop/c.yaml'],
    ]);

    const bad = collectGitResources([
      { path: 'x.yaml', text: group('a', 'shop') },
      { path: 'y.yaml', text: group('a', 'shop') },
      { path: 'z.yaml', text: 'apiVersion: loadweaver.com/v1\nkind: Nope\nmetadata: { name: n }\nspec: {}\n' },
    ]);

    expect(bad.issues).toHaveLength(2);
    expect(bad.issues[0]).toBe('y.yaml: WorkloadGroup/shop/a is also defined in x.yaml');
    expect(bad.issues[1]).toMatch(/^z\.yaml \(document 1\)/);
  });

  describe('diff against the cluster', () => {
    const [a, b, c] = resources(`${group('a', 'shop')}---\n${group('b', 'shop')}---\n${group('c', 'shop')}`);
    const [b2] = resources(group('b', 'shop', { app: 'b2' }));
    const clusterRow: ClusterRow = { kind: 'Cluster', name: 'default', project: null, generation: 1, body: {} };

    it('splits changed, unchanged and deletions (never the cluster or nodes)', () => {
      const diff = diffAgainstCluster(
        [
          { resource: a, path: 'a.yaml' },
          { resource: b2, path: 'b.yaml' },
        ],
        [row(a), row(b), row(c), clusterRow],
        [],
      );

      expect(diff.unchanged.map((r) => r.resource.metadata.name)).toEqual(['a']);
      expect(diff.changed.map((r) => r.resource.metadata.name)).toEqual(['b']);
      expect(diff.deletions.map((r) => r.name)).toEqual(['c']);
      // First sync: nothing is "changed outside Git" yet.
      expect(diff.conflicts).toEqual([]);
    });

    it('warns about resources changed or created outside Git since the last sync', () => {
      const states = [
        { kind: 'WorkloadGroup', projectKey: 'shop', name: 'a', path: 'a.yaml', generation: 1 },
        { kind: 'WorkloadGroup', projectKey: 'shop', name: 'b', path: 'b.yaml', generation: 1 },
      ];
      const diff = diffAgainstCluster(
        [
          { resource: a, path: 'a.yaml' },
          { resource: b2, path: 'b.yaml' },
        ],
        // b changed in the UI (generation 2), c created outside Git.
        [row(a), row(b, 2), row(c)],
        states,
      );

      expect(diff.conflicts).toEqual([
        expect.objectContaining({
          level: 'warning',
          path: 'git-conflict',
          kind: 'WorkloadGroup',
          name: 'b',
          project: 'shop',
        }),
        expect.objectContaining({ path: 'git-conflict', name: 'c', message: expect.stringContaining('deletes it') }),
      ]);

      // b changed only in Git: no conflict.
      expect(diffAgainstCluster([{ resource: b2, path: 'b.yaml' }], [row(b)], [states[1]]).conflicts).toEqual([]);
    });
  });

  it('maps plan states to commit states and statuses', () => {
    expect(commitStateOf('pending', false)).toBe('pending');
    expect(commitStateOf('pending', true)).toBe('approved');
    expect(commitStateOf('applying', false)).toBe('applying');
    expect(commitStateOf('applied', false)).toBe('applied');
    expect(commitStateOf('rolled-back', false)).toBe('failed');
    expect(commitStateOf('rollback-failed', false)).toBe('failed');
    expect(commitStateOf('discarded', false)).toBe('discarded');

    expect(commitStatusOf('pending', 'abcdef1234', null)).toEqual({
      state: 'pending',
      description: 'plan abcdef12 waits for approval / apply',
    });
    expect(commitStatusOf('applied', 'abcdef1234').state).toBe('success');
    expect(commitStatusOf('no-changes', null).state).toBe('success');
    expect(commitStatusOf('discarded', 'p').state).toBe('error');
    expect(commitStatusOf('rejected', null, 'x'.repeat(300))).toEqual({
      state: 'failure',
      description: expect.stringMatching(/^rejected: x+\.\.\.$/),
    });
    expect(commitStatusOf('rejected', null, 'x'.repeat(300)).description.length).toBeLessThanOrEqual(140);
  });

  describe('write-back of one document in a multi-document file', () => {
    const file = `# shop groups\n${group('a', 'shop')}---\n# keep me\n${group('b', 'shop')}`;
    const [b2] = resources(group('b', 'shop', { app: 'b2' }));

    it('replaces only the resource and keeps the other documents with their comments', () => {
      const next = replaceResourceDocument(file, resourceKey('WorkloadGroup', 'shop', 'b'), b2) as string;

      expect(next).toContain('# shop groups');
      expect(
        resources(next).map((r) => [
          r.metadata.name,
          (r.spec as { selector: { matchLabels: Record<string, string> } }).selector.matchLabels['app'],
        ]),
      ).toEqual([
        ['a', 'a'],
        ['b', 'b2'],
      ]);
    });

    it('appends new resources, removes deleted ones, and drops an emptied file', () => {
      const [c] = resources(group('c', 'shop'));
      const added = replaceResourceDocument(file, resourceKey('WorkloadGroup', 'shop', 'c'), c) as string;

      expect(resources(added).map((r) => r.metadata.name)).toEqual(['a', 'b', 'c']);

      const removed = replaceResourceDocument(file, resourceKey('WorkloadGroup', 'shop', 'a'), null) as string;

      expect(resources(removed).map((r) => r.metadata.name)).toEqual(['b']);
      expect(removed).toContain('# keep me');
      expect(replaceResourceDocument(group('a', 'shop'), resourceKey('WorkloadGroup', 'shop', 'a'), null)).toBeNull();
      expect(
        resources(replaceResourceDocument('', resourceKey('WorkloadGroup', 'shop', 'c'), c) as string),
      ).toHaveLength(1);
    });
  });

  describe('webhooks', () => {
    const secret = webhookSecret(
      'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
      '6f1c1b0e-0000-4000-8000-000000000001',
    );
    const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
    const hmac = createHmac('sha256', secret).update(body).digest('hex');

    it('derives a stable secret per connection', () => {
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(
        webhookSecret('MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=', '6f1c1b0e-0000-4000-8000-000000000001'),
      ).toBe(secret);
      expect(
        webhookSecret('MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=', '6f1c1b0e-0000-4000-8000-000000000002'),
      ).not.toBe(secret);
    });

    it('verifies GitHub / Gitea signatures and GitLab tokens', () => {
      expect(verifyWebhook({ 'x-hub-signature-256': `sha256=${hmac}` }, body, secret)).toBe(true);
      expect(verifyWebhook({ 'x-gitea-signature': hmac }, body, secret)).toBe(true);
      expect(verifyWebhook({ 'x-gitlab-token': secret }, body, secret)).toBe(true);
      expect(verifyWebhook({ 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` }, body, secret)).toBe(false);
      expect(verifyWebhook({ 'x-hub-signature-256': `sha256=${hmac}` }, Buffer.from('{}'), secret)).toBe(false);
      expect(verifyWebhook({ 'x-gitlab-token': 'wrong' }, body, secret)).toBe(false);
      expect(verifyWebhook({}, body, secret)).toBe(false);
    });

    it('tells pushes (with their branch), pull requests and pings apart', () => {
      expect(webhookEvent({ 'x-github-event': 'push' }, { ref: 'refs/heads/main' })).toEqual({
        kind: 'push',
        branch: 'main',
      });
      expect(webhookEvent({ 'x-gitea-event': 'push' }, { ref: 'refs/tags/v1' })).toEqual({
        kind: 'push',
        branch: null,
      });
      expect(webhookEvent({ 'x-gitlab-event': 'Push Hook' }, { ref: 'refs/heads/dev' })).toEqual({
        kind: 'push',
        branch: 'dev',
      });
      expect(webhookEvent({ 'x-github-event': 'pull_request' }, {})).toEqual({ kind: 'pull-request' });
      expect(webhookEvent({ 'x-gitlab-event': 'Merge Request Hook' }, {})).toEqual({ kind: 'pull-request' });
      expect(webhookEvent({ 'x-github-event': 'ping' }, {})).toEqual({ kind: 'ping' });
      expect(webhookEvent({}, {})).toEqual({ kind: 'other' });
    });
    it('rotates: a salt changes the secret, no salt is the original derivation', () => {
      const key = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';
      const id = '6f1c1b0e-0000-4000-8000-000000000001';
      const salt = newWebhookSalt();

      expect(webhookSecret(key, id, null)).toBe(secret);
      expect(webhookSecret(key, id, salt)).not.toBe(secret);
      expect(webhookSecret(key, id, salt)).toBe(webhookSecret(key, id, salt));
      expect(newWebhookSalt()).not.toBe(salt);
      expect(salt).toMatch(/^[0-9a-f]{48}$/);
    });

    it('reads delivery ids (replay protection), only well-formed', () => {
      expect(webhookDeliveryId({ 'x-github-delivery': '72d3162e-cc78-11e3-81ab-4c9367dc0958' })).toBe(
        '72d3162e-cc78-11e3-81ab-4c9367dc0958',
      );
      expect(webhookDeliveryId({ 'x-gitlab-event-uuid': 'abc-123' })).toBe('abc-123');
      expect(webhookDeliveryId({ 'x-github-delivery': 'a b' })).toBeNull();
      expect(webhookDeliveryId({})).toBeNull();
    });

    it('ignores deliveries about another repository (L4)', () => {
      expect(payloadMatchesRepo('github', { repository: { full_name: 'Acme/Infra' } }, 'acme/infra')).toBe(true);
      expect(payloadMatchesRepo('github', { repository: { full_name: 'acme/other' } }, 'acme/infra')).toBe(false);
      expect(payloadMatchesRepo('github', {}, 'acme/infra')).toBe(false);
      expect(payloadMatchesRepo('gitea', { repository: { full_name: 'acme/infra' } }, 'acme/infra')).toBe(true);
      expect(
        payloadMatchesRepo('gitlab', { project: { path_with_namespace: 'group/sub/infra' } }, 'group/sub/infra'),
      ).toBe(true);
      expect(payloadMatchesRepo('gitlab', { repository: { full_name: 'group/infra' } }, 'group/infra')).toBe(false);
      expect(payloadMatchesRepo('git', {}, 'a/b')).toBe(true);
    });

    it('reads the pusher of a push (hints only)', () => {
      expect(pushSender({ sender: { id: 42 }, after: 'a'.repeat(40) })).toEqual({
        userIds: ['42'],
        after: 'a'.repeat(40),
      });
      expect(pushSender({ user_id: 7, checkout_sha: 'b'.repeat(40) })).toEqual({
        userIds: ['7'],
        after: 'b'.repeat(40),
      });
      expect(pushSender({ sender: { id: 'x;y' } })).toEqual({ userIds: [], after: null });
    });
  });

  describe('plan bot helpers (3.30)', () => {
    it('limits a diff to one project or one path (deletions by their synced file)', () => {
      const git = [
        ...resources(group('api', 'shop')).map((r) => ({ resource: r, path: 'shop/api.yaml' })),
        ...resources(group('web', 'blog')).map((r) => ({ resource: r, path: 'blog/web.yaml' })),
      ];
      const [oldShop] = resources(group('old', 'shop'));
      const [oldBlog] = resources(group('gone', 'blog'));
      const states = [
        { kind: 'WorkloadGroup', projectKey: 'shop', name: 'old', path: 'shop/old.yaml', generation: 2 },
        { kind: 'WorkloadGroup', projectKey: 'blog', name: 'gone', path: 'blog/gone.yaml', generation: 1 },
      ];
      const diff = diffAgainstCluster(git, [row(oldShop, 3), row(oldBlog, 1)], states);

      expect(diff.conflicts).toHaveLength(1);

      const shop = limitDiff(diff, states, { project: 'shop' });

      expect(shop.changed.map((c) => c.resource.metadata.name)).toEqual(['api']);
      expect(shop.deletions.map((d) => d.name)).toEqual(['old']);
      expect(shop.conflicts).toHaveLength(1);

      const blog = limitDiff(diff, states, { path: 'blog' });

      expect(blog.changed.map((c) => c.resource.metadata.name)).toEqual(['web']);
      expect(blog.deletions.map((d) => d.name)).toEqual(['gone']);
      expect(blog.conflicts).toEqual([]);
      expect(limitDiff(diff, states)).toBe(diff);
    });

    it('recognizes comment events and the console URL', () => {
      expect(webhookEvent({ 'x-github-event': 'issue_comment' }, {})).toEqual({ kind: 'comment' });
      expect(webhookEvent({ 'x-gitlab-event': 'Note Hook' }, {})).toEqual({ kind: 'comment' });
      expect(
        consoleBaseUrl({
          LOADWEAVER_CONSOLE_URL: 'https://console.example.com/',
          LOADWEAVER_PUBLIC_URL: 'https://api',
        }),
      ).toBe('https://console.example.com');
      expect(consoleBaseUrl({ LOADWEAVER_PUBLIC_URL: 'https://lw.example.com' })).toBe('https://lw.example.com');
      expect(consoleBaseUrl({ LOADWEAVER_CONSOLE_URL: 'javascript:alert(1)' })).toBeNull();
      expect(consoleBaseUrl({})).toBeNull();
    });
  });
});
