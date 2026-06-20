import { registerDynamicProviderMetadata, registerDynamicProviders } from './register-dynamic-providers';

describe('registerDynamicProviders', () => {
  it('registers all loaded instances', async () => {
    const register = jest.fn();
    const instances = [{ getType: () => 'a' }, { getType: () => 'b' }];

    await registerDynamicProviders({
      envKey: 'DYNAMIC_AGENT_PROVIDERS',
      criticality: 'optional',
      register,
      dynamicLoader: {
        loadInstances: jest.fn().mockResolvedValue(instances),
      },
    });

    expect(register).toHaveBeenCalledTimes(2);
  });
});

describe('registerDynamicProviderMetadata', () => {
  it('registers metadata records from loader', async () => {
    const register = jest.fn();
    const metadata = [{ id: 'custom', displayName: 'Custom' }];

    await registerDynamicProviderMetadata({
      envKey: 'DYNAMIC_BILLING_PROVIDER_METADATA',
      criticality: 'optional',
      register,
      dynamicLoader: {
        loadMetadata: jest.fn().mockResolvedValue(metadata),
      },
    });

    expect(register).toHaveBeenCalledWith(metadata[0]);
  });
});
