import { RegistrarProviderRegistry } from './registrar-provider.registry';

describe('RegistrarProviderRegistry', () => {
  it('creates registered plugins and rejects unknown ids', async () => {
    const registry = new RegistrarProviderRegistry();
    const records: unknown[] = [];

    registry.register<{ token: string }>({
      id: 'test',
      displayName: 'Test',
      create: (config) => ({
        id: 'test',
        listDs: async () => [],
        setDs: async (domain, ds) => void records.push({ domain, ds, token: config.token }),
      }),
    });

    await registry.create('test', { token: 't' }).setDs('example.com', []);

    expect(records).toEqual([{ domain: 'example.com', ds: [], token: 't' }]);
    expect(registry.list()).toEqual([{ id: 'test', displayName: 'Test' }]);
    expect(() => registry.create('nope', {})).toThrow('unknown registrar nope');
  });
});
