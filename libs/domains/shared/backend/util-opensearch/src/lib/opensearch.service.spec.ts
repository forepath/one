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
});
