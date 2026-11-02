import { consoleObjectPath, matchActions, rankResults, searchDocuments } from './search.utils';

describe('global search', () => {
  it('turns entities into scoped documents without secrets', () => {
    const docs = searchDocuments({
      resources: [
        { kind: 'Cluster', name: 'cluster', project: null, spec: {} },
        { kind: 'Project', name: 'shop', project: null, spec: { description: 'Online shop' } },
        { kind: 'Deployment', name: 'store', project: 'shop', spec: { compose: 'secret: hunter2' } },
        { kind: 'NodeGroup', name: 'edge', project: null, spec: {} },
      ],
      services: [{ project: 'shop', deployment: 'store', service: 'web', hosts: ['shop.example.com'] }],
      nodes: [{ name: 'n1', site: 'fra1' }],
      plans: [
        { id: 'abcdef12-0000-0000-0000-000000000000', status: 'applied', projects: ['shop'], createdAt: new Date() },
      ],
      alerts: [{ id: 'a1', title: 'Node n1 is down', project: null }],
    });

    expect(docs.map((d) => [d.id, d.project])).toEqual([
      ['Project:/shop', 'shop'],
      ['Deployment:shop/store', 'shop'],
      ['NodeGroup:/edge', null],
      ['Service:shop/store/web', 'shop'],
      ['Node:n1', null],
      ['Plan:abcdef12-0000-0000-0000-000000000000', 'shop'],
      ['Alert:a1', null],
    ]);
    expect(docs.find((d) => d.kind === 'Service')).toMatchObject({
      link: '/observe/health/service/shop/store/web',
      text: 'web store shop shop.example.com',
    });
    expect(JSON.stringify(docs)).not.toContain('hunter2');
    // Plans: no id in the title (D11, LW-21); the name carries it for the link / copy.
    expect(docs.find((d) => d.kind === 'Plan')).toMatchObject({
      title: 'Plan shop (applied)',
      name: 'abcdef12-0000-0000-0000-000000000000',
    });
  });

  it('offers actions the caller may do', () => {
    const context = {
      nodes: ['n1', 'n2'],
      services: [{ project: 'shop', deployment: 'store', service: 'api' }],
      projects: ['shop'],
      canManageNodes: true,
      canPlan: true,
    };

    expect(matchActions('drain node n2', context)).toEqual([
      { title: 'Drain node n2', kind: 'api', request: { method: 'POST', path: '/nodes/n2/drain' } },
    ]);
    expect(matchActions('drain', { ...context, canManageNodes: false })).toEqual([]);
    expect(matchActions('create', context)).toEqual([{ title: 'Create plan', kind: 'navigate', link: '/create' }]);
    expect(matchActions('logs api', context)[0]).toMatchObject({
      title: 'Logs of shop/store/api',
      link: '/observe/logs?project=shop&deployment=store&service=api',
    });
    expect(matchActions('health of sh', context)).toEqual([
      { title: 'Health of shop', kind: 'navigate', link: '/observe/health/project/shop' },
    ]);
    expect(matchActions('', context)).toEqual([]);
  });

  it('ranks favourites, then recent items, then relevance', () => {
    const hits = [
      { id: 'a', score: 9 },
      { id: 'b', score: 5 },
      { id: 'c', score: 1 },
      { id: 'd', score: 3 },
    ];

    expect(
      rankResults(
        hits,
        new Set(['c']),
        new Map([
          ['d', 2],
          ['b', 1],
        ]),
      ).map((h) => h.id),
    ).toEqual(['c', 'd', 'b', 'a']);
  });

  it('links resources to the console object pages (3.37)', () => {
    expect(consoleObjectPath('Deployment', 'store', 'shop')).toBe('/resources/deployment/shop/store');
    expect(consoleObjectPath('NodeGroup', 'edge', null)).toBe('/resources/nodegroup/-/edge');
    expect(consoleObjectPath('Node', 'n1', null)).toBe('/resources/node/n1');
    expect(consoleObjectPath('Project', 'shop', null)).toBe('/resources/project/shop');
    expect(consoleObjectPath('Site', 'fra 1', null)).toBe('/resources/site/fra%201');
  });
});
