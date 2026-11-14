import { buildScopedSearchBody, clampSearchPagination, sanitizeSearchQuery } from './opensearch-query.util';

describe('opensearch-query.util', () => {
  it('sanitizeSearchQuery_EscapesReservedOperators', () => {
    expect(sanitizeSearchQuery('foo:bar +baz')).toContain('\\:');
    expect(sanitizeSearchQuery('foo:bar +baz')).toContain('\\+');
  });

  it('clampSearchPagination_BoundsSizeAndFrom', () => {
    expect(clampSearchPagination(1000, -5)).toEqual({ size: 100, from: 0 });
    expect(clampSearchPagination(10, 20)).toEqual({ size: 10, from: 20 });
  });

  it('buildScopedSearchBody_InjectsMandatoryFilters', () => {
    const body = buildScopedSearchBody({
      query: 'acme',
      fields: ['name', 'email'],
      filters: { tenantId: 't1', userId: 'u1' },
      from: 0,
      size: 10,
    });

    expect(body).toMatchObject({
      from: 0,
      size: 10,
      query: {
        bool: {
          filter: [{ term: { tenantId: 't1' } }, { term: { userId: 'u1' } }],
        },
      },
    });

    const must = (body as { query: { bool: { must: unknown[] } } }).query.bool.must;

    expect(must).toHaveLength(1);
    expect(must[0]).toMatchObject({
      bool: {
        minimum_should_match: 1,
      },
    });
  });

  it('buildScopedSearchBody_IncludesWildcardShouldClauses', () => {
    const body = buildScopedSearchBody({
      query: '42',
      fields: ['number', 'id'],
      from: 0,
      size: 10,
    });
    const should = (
      body as {
        query: { bool: { must: Array<{ bool: { should: unknown[] } }> } };
      }
    ).query.bool.must[0].bool.should;

    expect(should.some((clause) => 'simple_query_string' in (clause as object))).toBe(true);
    expect(
      should.some(
        (clause) =>
          'wildcard' in (clause as object) &&
          'number.keyword' in (clause as { wildcard: Record<string, unknown> }).wildcard,
      ),
    ).toBe(true);
  });
});
