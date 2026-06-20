import {
  instantiateResolvedProvider,
  ProviderExportContractError,
  resolveProviderExport,
  resolveProviderMetadata,
} from './resolve-provider-export';

describe('resolveProviderExport', () => {
  it('prefers createProvider for plugin packages', () => {
    const createProvider = jest.fn();

    const resolved = resolveProviderExport<{ getType(): string }>(
      { createProvider },
      { entry: { specifier: '@forepath/foo' } },
    );

    expect(resolved.kind).toBe('createProvider');
    expect(resolved.createProvider).toBe(createProvider);
  });

  it('uses named class export from entry alias', () => {
    class CustomProvider {
      getType(): string {
        return 'custom';
      }
    }

    const resolved = resolveProviderExport<{ getType(): string }>(
      { CustomProvider },
      { entry: { specifier: '@forepath/foo', classExport: 'CustomProvider' } },
    );

    expect(resolved.kind).toBe('class');
    expect(resolved.providerClass).toBe(CustomProvider);
  });

  it('rejects generic provider exports for plugin packages', () => {
    class GenericProvider {
      getType(): string {
        return 'generic';
      }
    }

    expect(() =>
      resolveProviderExport({ provider: GenericProvider }, { entry: { specifier: '@forepath/foo' } }),
    ).toThrow(ProviderExportContractError);
  });

  it('allows generic provider exports for test fixtures', () => {
    class FixtureProvider {
      getType(): string {
        return 'fixture';
      }
    }

    const resolved = resolveProviderExport(
      { provider: FixtureProvider },
      { entry: { specifier: '@forepath/test/fixture' }, allowTestFixtureExports: true },
    );

    expect(resolved.kind).toBe('testFixture');
  });
});

describe('resolveProviderMetadata', () => {
  it('returns metadata when export is valid', () => {
    expect(
      resolveProviderMetadata({
        providerMetadata: { id: 'hetzner', displayName: 'Hetzner Cloud' },
      }),
    ).toEqual({ id: 'hetzner', displayName: 'Hetzner Cloud' });
  });

  it('returns undefined when metadata export is missing', () => {
    expect(resolveProviderMetadata({})).toBeUndefined();
  });
});

describe('instantiateResolvedProvider', () => {
  it('invokes createProvider factory', async () => {
    const instance = { getType: () => 'factory' };
    const createProvider = jest.fn().mockResolvedValue(instance);
    const moduleRef = { create: jest.fn() } as never;

    const result = await instantiateResolvedProvider({ kind: 'createProvider', createProvider }, moduleRef);

    expect(result).toBe(instance);
    expect(createProvider).toHaveBeenCalledWith(moduleRef);
  });
});
