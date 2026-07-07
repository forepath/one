import { normalizeAllowedServerTypeIds, normalizeProviderServerTypes } from './server-type-list.utils';

describe('server-type-list.utils', () => {
  it('normalizeProviderServerTypes passes through arrays', () => {
    const result = normalizeProviderServerTypes([
      { id: 'cpx11', name: 'CPX11', cores: 2, memory: 4, disk: 80, priceMonthly: 4.51 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('cpx11');
    expect(result[0]?.name).toBe('CPX11');
  });

  it('normalizeProviderServerTypes unwraps numeric-keyed objects', () => {
    const result = normalizeProviderServerTypes({
      '0': { id: 'cpx11', name: 'CPX11', cores: 2, memory: 4, disk: 80 },
      '1': { id: 'cax21', name: 'CAX21', cores: 4, memory: 8, disk: 160 },
    });

    expect(result.map((st) => st.id)).toEqual(['cpx11', 'cax21']);
  });

  it('normalizeAllowedServerTypeIds unwraps numeric-keyed id objects', () => {
    expect(normalizeAllowedServerTypeIds({ '0': 'cpx11', '1': 'cax21' })).toEqual(['cpx11', 'cax21']);
  });
});
