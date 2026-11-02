import { filterBySearch, matchesSearch, normalizeSearch } from './list-search';

describe('list-search', () => {
  it('normalizes the term', () => {
    expect(normalizeSearch('  Prod-EU ')).toBe('prod-eu');
    expect(normalizeSearch(null)).toBe('');
  });

  it('matches case-insensitively over strings, numbers and arrays, skipping empty values', () => {
    expect(matchesSearch('', ['x'])).toBe(true);
    expect(matchesSearch('EU', ['prod-eu'])).toBe(true);
    expect(matchesSearch('42', [42])).toBe(true);
    expect(matchesSearch('web', [null, undefined, ['api', 'web-1']])).toBe(true);
    expect(matchesSearch('nope', ['prod-eu', null, ['a']])).toBe(false);
  });

  it('filters rows and returns the same array for an empty term', () => {
    const rows = [{ name: 'prod-eu' }, { name: 'staging' }];

    expect(filterBySearch(rows, ' ', (r) => [r.name])).toBe(rows);
    expect(filterBySearch(rows, 'stag', (r) => [r.name])).toEqual([{ name: 'staging' }]);
  });
});
