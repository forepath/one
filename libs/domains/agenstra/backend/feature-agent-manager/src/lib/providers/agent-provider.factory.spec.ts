import { Test, TestingModule } from '@nestjs/testing';

import { AgentProviderFactory } from './agent-provider.factory';
import { AgentProvider } from './agent-provider.interface';

describe('AgentProviderFactory', () => {
  let factory: AgentProviderFactory;
  let mockProvider1: jest.Mocked<AgentProvider>;
  let mockProvider2: jest.Mocked<AgentProvider>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AgentProviderFactory],
    }).compile();

    factory = module.get<AgentProviderFactory>(AgentProviderFactory);

    // Create mock providers
    mockProvider1 = {
      getType: jest.fn().mockReturnValue('provider1'),
      getDisplayName: jest.fn().mockReturnValue('Provider 1'),
      getCapabilities: jest.fn().mockReturnValue({
        supportsChat: true,
        supportsStreaming: false,
        supportsToolEvents: false,
        supportsQuestions: false,
      }),
      getDockerImage: jest.fn().mockReturnValue('image1:latest'),
      getVirtualWorkspaceDockerImage: jest.fn().mockReturnValue('image1-virtual-workspace:latest'),
      getSshConnectionDockerImage: jest.fn().mockReturnValue('image1-ssh-connection:latest'),
      sendMessage: jest.fn(),
      sendInitialization: jest.fn(),
      toParseableStrings: jest.fn(),
      toUnifiedResponse: jest.fn(),
      getModelsListCommand: jest.fn(),
      toModelsList: jest.fn(),
    };

    mockProvider2 = {
      getType: jest.fn().mockReturnValue('provider2'),
      getDisplayName: jest.fn().mockReturnValue('Provider 2'),
      getCapabilities: jest.fn().mockReturnValue({
        supportsChat: true,
        supportsStreaming: false,
        supportsToolEvents: false,
        supportsQuestions: false,
      }),
      getDockerImage: jest.fn().mockReturnValue('image2:latest'),
      getVirtualWorkspaceDockerImage: jest.fn().mockReturnValue('image2-virtual-workspace:latest'),
      getSshConnectionDockerImage: jest.fn().mockReturnValue('image2-ssh-connection:latest'),
      sendMessage: jest.fn(),
      sendInitialization: jest.fn(),
      toParseableStrings: jest.fn(),
      toUnifiedResponse: jest.fn(),
      getModelsListCommand: jest.fn(),
      toModelsList: jest.fn(),
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
      expect(loggerLogSpy).toHaveBeenCalledWith('Registered agent provider: provider1');
      expect(factory.hasProvider('provider1')).toBe(true);

      loggerWarnSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });

    it('should log registration', () => {
      const loggerLogSpy = jest.spyOn(factory['logger'], 'log').mockImplementation();

      factory.registerProvider(mockProvider1);

      expect(loggerLogSpy).toHaveBeenCalledWith('Registered agent provider: provider1');

      loggerLogSpy.mockRestore();
    });
  });

  describe('getProvider', () => {
    it('should return registered provider', () => {
      factory.registerProvider(mockProvider1);

      const provider = factory.getProvider('provider1');

      expect(provider).toBe(mockProvider1);
    });

    it('should throw error if provider not found', () => {
      expect(() => factory.getProvider('nonexistent')).toThrow(
        "Agent provider with type 'nonexistent' not found. Available types: none",
      );
    });

    it('should throw error with available types when provider not found', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      expect(() => factory.getProvider('nonexistent')).toThrow(
        "Agent provider with type 'nonexistent' not found. Available types: provider1, provider2",
      );
    });
  });

  describe('hasProvider', () => {
    it('should return false for unregistered provider', () => {
      expect(factory.hasProvider('provider1')).toBe(false);
    });

    it('should return true for registered provider', () => {
      factory.registerProvider(mockProvider1);

      expect(factory.hasProvider('provider1')).toBe(true);
    });

    it('should return false after provider is overwritten but still registered', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider1);

      expect(factory.hasProvider('provider1')).toBe(true);
    });
  });

  describe('getRegisteredTypes', () => {
    it('should return empty array when no providers registered', () => {
      expect(factory.getRegisteredTypes()).toEqual([]);
    });

    it('should return array of registered provider types', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      const types = factory.getRegisteredTypes();

      expect(types).toHaveLength(2);
      expect(types).toContain('provider1');
      expect(types).toContain('provider2');
    });

    it('should return types in registration order', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      const types = factory.getRegisteredTypes();

      expect(types[0]).toBe('provider1');
      expect(types[1]).toBe('provider2');
    });
  });
});
