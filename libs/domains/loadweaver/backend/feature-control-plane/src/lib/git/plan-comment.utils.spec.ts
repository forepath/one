import {
  layerOf,
  md,
  PLAN_COMMENT_MARKER,
  renderPlanComment,
  renderReply,
  type CommentPlan,
} from './plan-comment.utils';

const change = (
  action: 'create' | 'update' | 'delete',
  kind: string,
  name: string,
  project: string | null = 'shop',
) => ({
  action,
  kind,
  name,
  project,
  baseGeneration: 0,
  before: null,
  after: null,
});

const plan = (over: Partial<CommentPlan> = {}): CommentPlan => ({
  id: '6f1c1b0e-0000-4000-8000-000000000001',
  status: 'pending',
  changes: [
    change('create', 'Deployment', 'api'),
    change('update', 'Policy', 'web-to-api'),
    change('delete', 'DnsRecord', 'old'),
    change('update', 'IpPool', 'public', null),
  ],
  networkChanges: [{ layer: 'filtering', action: 'add', node: 'n1', summary: 'allows web → api on 8080' }],
  workloadChanges: [{ action: 'start', replica: 'shop/api/api-0', to: 'n1' }],
  warnings: [
    {
      level: 'warning',
      project: 'shop',
      deployment: 'api',
      path: 'services.api.image',
      message: 'docker.io is not mirrored',
    },
    { level: 'warning', project: 'shop', deployment: 'api', message: 'unacknowledged pin: api on n1', pin: true },
    {
      level: 'warning',
      path: 'git-conflict',
      kind: 'Policy',
      name: 'web-to-api',
      message: 'Policy shop/web-to-api was changed outside Git since the last sync',
    },
    { level: 'warning', path: 'dns', message: 'zone example.com has no NS <b>' },
  ],
  failureAnalysis: {
    nPlusOne: false,
    findings: [
      { scope: { kind: 'node', name: 'n1' }, kind: 'deployment', subject: 'shop/api', reason: 'single replica' },
      { scope: { kind: 'node', name: 'n2' }, kind: 'capacity', subject: 'n2', reason: 'no room for n1’s replicas' },
    ],
  },
  risk: { shop: ['unacknowledged pins'] },
  error: null,
  ...over,
});

describe('plan comment (3.30)', () => {
  it('renders every section with links, per layer, and the drift / locks of the PR', () => {
    const text = renderPlanComment({
      scope: 'shop',
      headSha: '0123456789abcdef',
      plan: plan(),
      approvals: { needed: ['shop'], given: [] },
      locksByOthers: [
        { scope: 'DnsRecord/shop/old', holder: 'pull request #3 (https://github.com/acme/infra/pull/3)' },
      ],
      ahead: [
        { commit: 'fedcba9876543210', state: 'pending', planId: 'aaaaaaaa-0000-4000-8000-000000000000', reason: null },
      ],
      inconsistent: [{ planId: 'bbbbbbbb-0000-4000-8000-000000000000', error: 'node n3 unreachable' }],
      consoleUrl: 'https://lw.example.com/',
    });

    expect(text.startsWith(PLAN_COMMENT_MARKER)).toBe(true);
    expect(text).toContain('### Loadweaver plan: `shop` at `01234567`');
    expect(text).toContain('needs an approval for `shop`');
    expect(text).toContain(
      '[Plan in the console](https://lw.example.com/activity/plans/6f1c1b0e-0000-4000-8000-000000000001)',
    );
    expect(text).toContain(
      '[Map overlay](https://lw.example.com/observe/topology?mode=plan&plan=6f1c1b0e-0000-4000-8000-000000000001)',
    );
    expect(text).toContain('#### Changes (4)');

    for (const layer of ['**Deployments**', '**Policies and groups**', '**DNS**', '**IPAM**'])
      expect(text).toContain(layer);

    expect(text).toContain('- `+` create Deployment `shop/api`');
    expect(text).toContain('- `-` delete DnsRecord `shop/old`');
    expect(text).toContain('`n1`: allows web → api on 8080');
    expect(text).toContain('**replicas**: 1 start, 0 stop, 0 move');
    expect(text).toContain('#### Pins (1)');
    expect(text).toContain('`loadweaver apply --confirm`');
    expect(text).toContain('#### Failure analysis (1)');
    expect(text).toContain('#### Quota and capacity');
    expect(text).toContain('(N+1)');
    expect(text).toContain('`shop` is risky: unacknowledged pins');
    expect(text).toContain('#### Image scan and policies (1)');
    expect(text).toContain('#### Other warnings (1)');
    expect(text).toContain('zone example.com has no NS &lt;b&gt;');
    expect(text).toContain('**default branch ahead of cluster**: `fedcba98` is pending (plan `aaaaaaaa`)');
    expect(text).toContain('was changed outside Git since the last sync');
    expect(text).toContain('plan `bbbbbbbb` failed to roll back (node n3 unreachable)');
    expect(text).toContain('#### Locked by others (1)');
    expect(text).toContain('`DnsRecord/shop/old` by pull request #3');
    expect(text).not.toContain('<b>');
  });

  it('shows why there is no plan, and a no-changes plan without links', () => {
    const failed = renderPlanComment({
      scope: 'cluster',
      headSha: 'abc',
      plan: null,
      failure: 'shop/leak.yaml:3: GitHub token (github-token)\n```',
    });

    expect(failed).toContain(':x: **No plan**');
    expect(failed).toContain('shop/leak.yaml:3');
    expect((failed.match(/```/g) ?? []).length % 2).toBe(0);

    expect(renderPlanComment({ scope: 'cluster', headSha: 'abc', plan: null })).toContain('**No changes**');
  });

  it('shows results, applied plans and its own locks', () => {
    const text = renderPlanComment({
      scope: 'shop',
      headSha: 'abc',
      plan: plan({ status: 'applied' }),
      locked: false,
      result: 'Applied plan 6f1c1b0e. The pull request was merged.',
    });

    expect(text).toContain(':rocket: **Applied**');
    expect(text).toContain('> Applied plan 6f1c1b0e. The pull request was merged.');
    expect(text).toContain('Plan `6f1c1b0e-0000-4000-8000-000000000001`');
    expect(
      renderPlanComment({
        scope: 's',
        headSha: 'a',
        plan: plan({ warnings: [], failureAnalysis: null, risk: {} }),
        locked: true,
      }),
    ).toContain('holds the locks');
  });

  it('lists volume copies a plan adds (M6 gate)', () => {
    const text = renderPlanComment({
      scope: 'shop',
      headSha: 'abc',
      plan: plan({ workloadChanges: [{ action: 'copy', volume: 'shop/db/data', to: 'n2', copy: 'sync' }] }),
    });

    expect(text).toContain('**replicas**: 0 start, 0 stop, 0 move; **volume copies added**: 1');
    expect(text).toContain('- volume `shop/db/data`: copy added on `n2`');
  });

  it('caps long lists and the whole comment, with notes', () => {
    const many = plan({
      changes: Array.from({ length: 400 }, (_, i) => change('create', 'Deployment', `svc-${i}`)),
      warnings: Array.from({ length: 400 }, (_, i) => ({
        level: 'warning',
        path: 'dns',
        message: `w${i} ${'x'.repeat(200)}`,
      })),
    });
    const text = renderPlanComment({ scope: 'shop', headSha: 'abc', plan: many });

    expect(text).toContain('… and 375 more (see the plan)');

    const small = renderPlanComment({ scope: 'shop', headSha: 'abc', plan: many }, 3000);

    expect(small.length).toBeLessThanOrEqual(3000);
    expect(small).toContain('truncated');
  });

  it('escapes text from plans and providers', () => {
    expect(md('a|b `c` <script> @team\nnext')).toBe("a\\|b 'c' &lt;script&gt; @​team next");
    expect(md('x'.repeat(400), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(layerOf('BgpPeer')).toBe('BGP');
    expect(layerOf('WorkloadGroup')).toBe('Policies and groups');
    expect(layerOf('Site')).toBe('Cluster, sites, nodes and projects');
    expect(layerOf('Wallboard')).toBe('Other');
  });

  it('renders replies with a mention only for valid logins', () => {
    expect(renderReply('ops', 'apply', 'refused', ['check `ci` is failure'])).toBe(
      "@ops `loadweaver apply`: refused\n\n- check 'ci' is failure",
    );
    expect(renderReply('evil user\n@all', 'apply', 'x')).toBe('You `loadweaver apply`: x');
  });
});
