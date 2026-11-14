import { hydrateEntitiesBySearchIds, orderItemsBySearchIds, sanitizeListSearch } from './agenstra-search-list.util';

describe('agenstra-search-list.util', () => {
  it('sanitizeListSearch_TrimsAndCapsLength', () => {
    expect(sanitizeListSearch('  hello  ')).toBe('hello');
    expect(sanitizeListSearch('x'.repeat(250))?.length).toBe(200);
    expect(sanitizeListSearch('   ')).toBeUndefined();
  });

  it('hydrateEntitiesBySearchIds_PreservesOpenSearchOrder', async () => {
    const repository = {
      findBy: jest.fn().mockResolvedValue([
        { id: 'b', name: 'Beta' },
        { id: 'a', name: 'Alpha' },
      ]),
    };
    const result = await hydrateEntitiesBySearchIds(repository as never, { ids: ['a', 'b'], total: 2 });

    expect(result?.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('hydrateEntitiesBySearchIds_EmptyHitsFallsThroughToNull', async () => {
    const repository = { findBy: jest.fn() };
    const result = await hydrateEntitiesBySearchIds(repository as never, { ids: [], total: 0 });

    expect(result).toBeNull();
    expect(repository.findBy).not.toHaveBeenCalled();
  });

  it('orderItemsBySearchIds_PreservesRequestedOrder', () => {
    const items = orderItemsBySearchIds(
      [
        { id: '2', label: 'two' },
        { id: '1', label: 'one' },
      ],
      ['1', '2'],
    );

    expect(items.map((item) => item.id)).toEqual(['1', '2']);
  });
});
