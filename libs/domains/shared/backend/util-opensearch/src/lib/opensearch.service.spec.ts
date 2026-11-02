import { OpenSearchService } from './opensearch.service';

describe('OpenSearchService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('isEnabled_FalseWhenDisabled', () => {
    process.env['OPENSEARCH_ENABLED'] = 'false';
    const service = new OpenSearchService();

    expect(service.isEnabled()).toBe(false);
  });

  it('indexName_UsesConfiguredPrefix', () => {
    process.env['OPENSEARCH_INDEX_PREFIX'] = 'decabill';
    const service = new OpenSearchService();

    expect(service.indexName('subscriptions')).toBe('decabill-subscriptions');
  });

  it('ping_ReturnsFalseWhenDisabled', async () => {
    process.env['OPENSEARCH_ENABLED'] = 'false';
    const service = new OpenSearchService();

    await expect(service.ping()).resolves.toBe(false);
  });

  it('count_ReturnsZeroWhenDisabled', async () => {
    process.env['OPENSEARCH_ENABLED'] = 'false';
    const service = new OpenSearchService();

    await expect(service.count('idx', { clientId: 'c1' })).resolves.toBe(0);
  });

  it('count_UsesFilterOnlyQueryWithoutTextMatching', async () => {
    process.env['OPENSEARCH_ENABLED'] = 'true';
    const service = new OpenSearchService();
    const countMock = jest.fn().mockResolvedValue({ body: { count: 7 } });

    (service as unknown as { client: unknown }).client = { count: countMock };

    await expect(service.count('idx', { clientId: 'c1', agentId: 'a1' })).resolves.toBe(7);
    expect(countMock).toHaveBeenCalledWith({
      index: 'idx',
      body: {
        query: {
          bool: {
            must: [{ match_all: {} }],
            filter: [{ term: { clientId: 'c1' } }, { term: { agentId: 'a1' } }],
          },
        },
      },
    });
  });

  it('bulkAppend_CreatesDocumentsAndCountsRejected', async () => {
    process.env['OPENSEARCH_ENABLED'] = 'true';
    const service = new OpenSearchService();
    const bulk = jest
      .fn()
      .mockResolvedValue({ body: { errors: true, items: [{ create: {} }, { create: { error: { type: 'x' } } }] } });

    (service as unknown as { client: unknown }).client = { bulk };

    await expect(service.bulkAppend('logs-1', [{ a: 1 }, { a: 2 }])).resolves.toBe(1);
    expect(bulk).toHaveBeenCalledWith({
      refresh: false,
      body: [{ create: { _index: 'logs-1' } }, { a: 1 }, { create: { _index: 'logs-1' } }, { a: 2 }],
    });
  });

  it('searchRaw_ReturnsSortValues', async () => {
    process.env['OPENSEARCH_ENABLED'] = 'true';
    const service = new OpenSearchService();
    const search = jest.fn().mockResolvedValue({
      body: { hits: { total: { value: 1 }, hits: [{ _id: 'x', _source: { m: 'hi' }, sort: [1, 'x'] }] } },
    });

    (service as unknown as { client: unknown }).client = { search };

    await expect(service.searchRaw('logs-*', { size: 1 })).resolves.toEqual({
      total: 1,
      hits: [{ id: 'x', source: { m: 'hi' }, sort: [1, 'x'] }],
    });
    expect(search).toHaveBeenCalledWith({
      index: 'logs-*',
      body: { size: 1 },
      ignore_unavailable: true,
      allow_no_indices: true,
    });
  });

  it('deleteIndices_RefusesWildcards', async () => {
    process.env['OPENSEARCH_ENABLED'] = 'true';
    const service = new OpenSearchService();

    (service as unknown as { client: unknown }).client = { indices: { delete: jest.fn() } };

    await expect(service.deleteIndices(['logs-*'])).rejects.toThrow('exact index names');
  });
});
