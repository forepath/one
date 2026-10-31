import type { SearchResult } from '@forepath/loadweaver/frontend/data-access-console';

import {
  flattenSections,
  paletteGroups,
  parsePaletteQuery,
  scopedResults,
  searchActionRequest,
  searchActionRoute,
  searchKindLabel,
  searchResultStatus,
  searchResultTitle,
  searchResultRoute,
  searchSections,
  splitItem,
} from './search-format';

function result(id: string, kind: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return { id, kind, title: id, project: null, link: '/x', favourite: false, ...overrides };
}

describe('search format', () => {
  it('maps index links to console routes', () => {
    expect(splitItem('Deployment:shop/web')).toEqual({ kind: 'Deployment', key: 'shop/web' });
    expect(searchResultRoute(result('Deployment:shop/web', 'Deployment'))).toBe('/resources/deployment/shop/web');
    expect(searchResultRoute(result('Site:/fra1', 'Site'))).toBe('/resources/site/fra1');
    expect(searchResultRoute(result('Project:/shop', 'Project'))).toBe('/resources/project/shop');
    expect(searchResultRoute(result('Service:shop/web/api', 'Service'))).toBe('/observe/health/service/shop/web/api');
    expect(searchResultRoute(result('Node:n1', 'Node', { link: '/resources/node/n1' }))).toBe('/resources/node/n1');
    expect(searchResultRoute(result('Plan:abc', 'Plan', { link: '/activity/plans/abc' }))).toBe('/activity/plans/abc');
  });

  it('describes actions', () => {
    expect(searchActionRoute({ title: 'Create plan', kind: 'navigate', link: '/create' })).toBe('/create');
    expect(searchActionRoute({ title: 'Health of shop', kind: 'navigate', link: '/observe/health/project/shop' })).toBe(
      '/observe/health/project/shop',
    );
    expect(
      searchActionRequest({ title: 'Drain', kind: 'api', request: { method: 'post', path: '/nodes/n2/drain' } }),
    ).toBe('POST /nodes/n2/drain');
  });

  it('groups actions, favourites and kinds for a query', () => {
    const sections = searchSections({
      query: 'web',
      results: [
        result('Deployment:shop/web', 'Deployment', { favourite: true }),
        result('Node:web1', 'Node'),
        result('Deployment:blog/web', 'Deployment'),
        result('Node:web2', 'Node'),
      ],
      actions: [{ title: 'Logs of shop/web/api', kind: 'navigate', link: '/observe/logs' }],
      favourites: ['Deployment:shop/web'],
      recent: [],
    });

    expect(sections.map((s) => s.id)).toEqual(['actions', 'favourites', 'kind:Node', 'kind:Deployment']);
    expect(flattenSections(sections).map((e) => e.id)).toEqual([
      'action:0:Logs of shop/web/api',
      'result:Deployment:shop/web',
      'result:Node:web1',
      'result:Node:web2',
      'result:Deployment:blog/web',
    ]);
  });

  it('shows recent items and the other favourites without a query', () => {
    const sections = searchSections({
      query: ' ',
      results: [],
      actions: [],
      favourites: ['Node:n1', 'Deployment:shop/web'],
      recent: [result('Node:n1', 'Node')],
    });

    expect(sections.map((s) => [s.id, s.entries.map((e) => e.id)])).toEqual([
      ['recent', ['result:Node:n1']],
      ['favourites', ['favourite:Deployment:shop/web']],
    ]);
  });

  it('parses palette scope tokens and builds groups with "go to tab" commands', () => {
    expect(parsePaletteQuery('in:project/shop kind:VM web')).toEqual({ text: 'web', project: 'shop', kind: 'VM' });
    expect(parsePaletteQuery('db')).toEqual({ text: 'db', project: null, kind: null });

    const vm = result('VirtualMachine:shop/db1', 'VirtualMachine');
    const other = { ...result('Deployment:prod/web', 'Deployment'), project: 'prod' };

    expect(
      scopedResults([{ ...vm, project: 'shop' }, other], parsePaletteQuery('in:shop kind:vm')).map((r) => r.id),
    ).toEqual(['VirtualMachine:shop/db1']);

    const groups = paletteGroups([], [{ id: 'logs', label: 'Logs', icon: 'journal-text' }], 'lo', {
      tabs: 'Go to tab',
      goToTab: 'Tab',
      favourite: '★',
      action: 'Action',
    });

    expect(groups).toEqual([
      {
        id: 'tabs',
        label: 'Go to tab',
        items: [
          {
            id: 'tab:logs',
            label: 'Logs',
            icon: 'journal-text',
            badge: 'Tab',
            data: { type: 'tab', id: 'tab:logs', tab: 'logs' },
          },
        ],
      },
    ]);
    expect(
      paletteGroups([], [{ id: 'logs', label: 'Logs', icon: 'x' }], 'web', {
        tabs: '',
        goToTab: '',
        favourite: '',
        action: '',
      }),
    ).toEqual([]);
  });
});

describe('search titles and kind labels (D7 / D11, LW-21)', () => {
  it('labels sections and results by translated kind, plans without id but with a status', () => {
    expect(searchKindLabel('WorkloadGroup')).toBe('Groups');
    expect(searchKindLabel('BackupPolicy')).toBe('Backup policies');
    expect(searchKindLabel('SomeNewKind')).toBe('Some new kind');
    expect(searchResultTitle({ kind: 'AlertRule', name: 'cpu', project: 'shop', title: 'Alert rule shop/cpu' })).toBe(
      'Alert rule shop/cpu',
    );
    expect(searchResultTitle({ kind: 'Project', name: 'shop', project: 'shop', title: 'Project shop' })).toBe(
      'Project shop',
    );
    const plan = { kind: 'Plan', name: 'f0e18301-0000', project: 'shop', title: 'Plan f0e18301 (pending)' };

    expect(searchResultTitle(plan)).toBe('Plan shop');
    expect(searchResultStatus(plan)).toBe('pending');
    expect(searchResultStatus({ kind: 'Node', title: 'Node n1 (x)' })).toBeNull();
    // Older servers without `name`: their title.
    expect(searchResultTitle({ kind: 'Deployment', project: 'shop', title: 'Deployment shop/web' })).toBe(
      'Deployment shop/web',
    );
    // … with the readable kind instead of the identifier (LW-21 round 2).
    expect(searchResultTitle({ kind: 'BackupPolicy', project: 'shop', title: 'BackupPolicy shop/nightly' })).toBe(
      'Backup policy shop/nightly',
    );
    expect(searchResultTitle({ kind: 'Alert', title: 'Node n1 is down' })).toBe('Node n1 is down');
  });
});
