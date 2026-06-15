import { Test, TestingModule } from '@nestjs/testing';

import { ExternalImportProviderFactory } from './external-import-provider.factory';
import type { ExternalContextImportProvider } from './external-import-provider.interface';

describe('ExternalImportProviderFactory', () => {
  let factory: ExternalImportProviderFactory;
  let mockProvider1: jest.Mocked<ExternalContextImportProvider>;
  let mockProvider2: jest.Mocked<ExternalContextImportProvider>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExternalImportProviderFactory],
    }).compile();

    factory = module.get<ExternalImportProviderFactory>(ExternalImportProviderFactory);

    mockProvider1 = {
      getType: jest.fn().mockReturnValue('provider1'),
      runImport: jest.fn(),
    };

    mockProvider2 = {
      getType: jest.fn().mockReturnValue('provider2'),
      runImport: jest.fn(),
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
    });

    it('should overwrite existing provider and log warning', () => {
      const loggerWarnSpy = jest.spyOn(factory['logger'], 'warn').mockImplementation();
      const loggerLogSpy = jest.spyOn(factory['logger'], 'log').mockImplementation();

      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider1);

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        "Import provider 'provider1' is already registered. Overwriting existing provider.",
      );
      expect(loggerLogSpy).toHaveBeenCalledWith('Registered external import provider: provider1');

      loggerWarnSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });
  });

  describe('getProvider', () => {
    it('should get a registered provider', () => {
      factory.registerProvider(mockProvider1);

      expect(factory.getProvider('provider1')).toBe(mockProvider1);
    });

    it('should throw if provider is not found', () => {
      expect(() => factory.getProvider('nonexistent')).toThrow(
        "Import provider 'nonexistent' is not registered. Available: none",
      );
    });
  });

  describe('hasProvider', () => {
    it('should return false if provider is not registered', () => {
      expect(factory.hasProvider('nonexistent')).toBe(false);
    });
  });

  describe('getRegisteredProviderIds', () => {
    it('should return empty array when no providers are registered', () => {
      expect(factory.getRegisteredProviderIds()).toEqual([]);
    });

    it('should return registered ids', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      expect(factory.getRegisteredProviderIds()).toEqual(['provider1', 'provider2']);
    });
  });

  describe('getAllProviders', () => {
    it('should return all registered providers', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      expect(factory.getAllProviders()).toEqual([mockProvider1, mockProvider2]);
    });
  });
});
