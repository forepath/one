import type { SearchResult } from '@forepath/loadweaver/frontend/data-access-console';

import {
  flattenSections,
  searchActionRequest,
  searchActionRoute,
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
    expect(searchResultRoute(result('Deployment:shop/web', 'Deployment'))).toBe(
      '/resources/Deployment/web?project=shop',
    );
    expect(searchResultRoute(result('Site:/fra1', 'Site'))).toBe('/resources/Site/fra1');
    expect(searchResultRoute(result('Project:/shop', 'Project'))).toBe('/resources/Project/shop');
    expect(searchResultRoute(result('Service:shop/web/api', 'Service'))).toBe('/health/service/shop/web/api');
    expect(searchResultRoute(result('Node:n1', 'Node', { link: '/nodes/n1' }))).toBe('/nodes/n1');
    expect(searchResultRoute(result('Plan:abc', 'Plan', { link: '/plans/abc' }))).toBe('/plans/abc');
  });

  it('describes actions', () => {
    expect(searchActionRoute({ title: 'Create plan', kind: 'navigate', link: '/plans/new' })).toBe('/resources/new');
    expect(searchActionRoute({ title: 'Health of shop', kind: 'navigate', link: '/health/project/shop' })).toBe(
      '/health/project/shop',
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
      actions: [{ title: 'Logs of shop/web/api', kind: 'navigate', link: '/logs' }],
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
});
