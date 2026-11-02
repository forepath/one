import { DEFAULT_LOG_RETENTION_DAYS } from '@forepath/loadweaver/shared/util-model';

import { expiredIndices, logIndex, logQuery, logScope } from './logs.service';

const NOW = new Date('2026-10-18T12:00:00Z');

describe('log store rules (3.14)', () => {
  it('names indices per source and day, and expires them by retention', () => {
    expect(logIndex('loadweaver-logs', 'firewall', NOW)).toBe('loadweaver-logs-firewall-2026-10-18');
    expect(
      expiredIndices(
        [
          'loadweaver-logs-firewall-2026-10-09',
          'loadweaver-logs-firewall-2026-10-12',
          'loadweaver-logs-container-2026-10-01',
          'other-index',
        ],
        'loadweaver-logs',
        DEFAULT_LOG_RETENTION_DAYS,
        NOW,
      ),
    ).toEqual(['loadweaver-logs-firewall-2026-10-09']);
  });

  it('scopes by access: projects for members, platform logs for cluster roles', () => {
    expect(logScope({ isApiKey: true, clusterRole: 'cluster-admin', projects: new Map() })).toEqual({
      all: true,
      platform: true,
      projects: [],
    });
    expect(
      logScope({ isApiKey: false, clusterRole: 'infra-operator', projects: new Map([['shop', 'viewer']]) }),
    ).toEqual({
      all: false,
      platform: true,
      projects: ['shop'],
    });

    const query = logQuery(
      { project: 'shop', text: 'error', sources: ['container'] },
      { all: false, platform: false, projects: ['shop'] },
      NOW,
    ) as {
      bool: { filter: Record<string, unknown>[]; must: unknown[] };
    };

    expect(query.bool.filter).toEqual(
      expect.arrayContaining([
        { range: { at: { gte: '2026-10-18T11:00:00.000Z', lte: '2026-10-18T12:00:00.000Z' } } },
        { terms: { source: ['container'] } },
        { term: { 'labels.project': 'shop' } },
        { bool: { should: [{ terms: { 'labels.project': ['shop'] } }], minimum_should_match: 1 } },
      ]),
    );
    expect(query.bool.must).toEqual([{ simple_query_string: { query: 'error', fields: ['message'] } }]);
    expect(() => logQuery({ from: 'nope' }, { all: true, platform: true, projects: [] }, NOW)).toThrow(
      'invalid time range',
    );
  });
});
