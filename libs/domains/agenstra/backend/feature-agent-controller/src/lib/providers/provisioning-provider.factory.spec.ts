import { Test, TestingModule } from '@nestjs/testing';

import { ProvisioningProviderFactory } from './provisioning-provider.factory';
import { ProvisioningProvider } from './provisioning-provider.interface';

describe('ProvisioningProviderFactory', () => {
  let factory: ProvisioningProviderFactory;
  let mockProvider1: jest.Mocked<ProvisioningProvider>;
  let mockProvider2: jest.Mocked<ProvisioningProvider>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProvisioningProviderFactory],
    }).compile();

    factory = module.get<ProvisioningProviderFactory>(ProvisioningProviderFactory);

    // Create mock providers
    mockProvider1 = {
      getType: jest.fn().mockReturnValue('provider1'),
      getDisplayName: jest.fn().mockReturnValue('Provider 1'),
      getServerTypes: jest.fn().mockResolvedValue([]),
      provisionServer: jest.fn(),
      deleteServer: jest.fn(),
      getServerInfo: jest.fn(),
    };

    mockProvider2 = {
      getType: jest.fn().mockReturnValue('provider2'),
      getDisplayName: jest.fn().mockReturnValue('Provider 2'),
      getServerTypes: jest.fn().mockResolvedValue([]),
      provisionServer: jest.fn(),
      deleteServer: jest.fn(),
      getServerInfo: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerProvider', () => {
    it('should register a provider', () => {
      factory.registerProvider(mockProvider1);

      expect(factory.hasProvider('provider1')).toBe(true);
      expect(factory.getProvider('provider1')).toBe(mockProvider1);
    });

    it('should register multiple providers', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      expect(factory.hasProvider('provider1')).toBe(true);
      expect(factory.hasProvider('provider2')).toBe(true);
      expect(factory.getProvider('provider1')).toBe(mockProvider1);
      expect(factory.getProvider('provider2')).toBe(mockProvider2);
    });

    it('should overwrite existing provider and log warning', () => {
      const loggerWarnSpy = jest.spyOn(factory['logger'], 'warn').mockImplementation();
      const loggerLogSpy = jest.spyOn(factory['logger'], 'log').mockImplementation();

      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider1); // Register same provider again

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        "Provider with type 'provider1' is already registered. Overwriting existing provider.",
      );
      expect(loggerLogSpy).toHaveBeenCalledWith('Registered provisioning provider: provider1');
      expect(factory.hasProvider('provider1')).toBe(true);

      loggerWarnSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });
  });

  describe('getProvider', () => {
    it('should get a registered provider', () => {
      factory.registerProvider(mockProvider1);

      const provider = factory.getProvider('provider1');

      expect(provider).toBe(mockProvider1);
    });

    it('should throw error if provider is not found', () => {
      expect(() => factory.getProvider('nonexistent')).toThrow(
        "Provisioning provider with type 'nonexistent' not found. Available types: none",
      );
    });
  });

  describe('hasProvider', () => {
    it('should return true if provider is registered', () => {
      factory.registerProvider(mockProvider1);

      expect(factory.hasProvider('provider1')).toBe(true);
    });

    it('should return false if provider is not registered', () => {
      expect(factory.hasProvider('nonexistent')).toBe(false);
    });
  });

  describe('getRegisteredTypes', () => {
    it('should return empty array when no providers are registered', () => {
      expect(factory.getRegisteredTypes()).toEqual([]);
    });

    it('should return array of registered provider types', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      const types = factory.getRegisteredTypes();

      expect(types).toContain('provider1');
      expect(types).toContain('provider2');
      expect(types.length).toBe(2);
    });
  });

  describe('getAllProviders', () => {
    it('should return empty array when no providers are registered', () => {
      expect(factory.getAllProviders()).toEqual([]);
    });

    it('should return array of all registered providers', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      const providers = factory.getAllProviders();

      expect(providers).toContain(mockProvider1);
      expect(providers).toContain(mockProvider2);
      expect(providers.length).toBe(2);
    });
  });
});
