import { ProviderRegistry } from './provider-registry';

interface TestProvider {
  getType(): string;
}

describe('ProviderRegistry', () => {
  it('registers and resolves providers by id', () => {
    const registry = new ProviderRegistry<TestProvider>();
    const provider: TestProvider = { getType: () => 'demo' };

    registry.register('demo', provider);

    expect(registry.getProvider('demo')).toBe(provider);
    expect(registry.hasProvider('demo')).toBe(true);
    expect(registry.getRegisteredIds()).toEqual(['demo']);
  });

  it('throws when provider id is missing', () => {
    const registry = new ProviderRegistry<TestProvider>();

    expect(() => registry.getProvider('missing')).toThrow(/not found/);
  });
});
