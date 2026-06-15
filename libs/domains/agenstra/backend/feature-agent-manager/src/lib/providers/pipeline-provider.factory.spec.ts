import { Test, TestingModule } from '@nestjs/testing';

import { PipelineProviderFactory } from './pipeline-provider.factory';
import { PipelineProvider } from './pipeline-provider.interface';

describe('PipelineProviderFactory', () => {
  let factory: PipelineProviderFactory;
  let mockProvider1: jest.Mocked<PipelineProvider>;
  let mockProvider2: jest.Mocked<PipelineProvider>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PipelineProviderFactory],
    }).compile();

    factory = module.get<PipelineProviderFactory>(PipelineProviderFactory);

    // Create mock providers
    mockProvider1 = {
      getType: jest.fn().mockReturnValue('github'),
      getDisplayName: jest.fn().mockReturnValue('GitHub Actions'),
      listRepositories: jest.fn(),
      listBranches: jest.fn(),
      listWorkflows: jest.fn(),
      triggerWorkflow: jest.fn(),
      getRunStatus: jest.fn(),
      getRunLogs: jest.fn(),
      listRunJobs: jest.fn(),
      getJobLogs: jest.fn(),
      cancelRun: jest.fn(),
    };

    mockProvider2 = {
      getType: jest.fn().mockReturnValue('gitlab'),
      getDisplayName: jest.fn().mockReturnValue('GitLab CI/CD'),
      listRepositories: jest.fn(),
      listBranches: jest.fn(),
      listWorkflows: jest.fn(),
      triggerWorkflow: jest.fn(),
      getRunStatus: jest.fn(),
      getRunLogs: jest.fn(),
      listRunJobs: jest.fn(),
      getJobLogs: jest.fn(),
      cancelRun: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerProvider', () => {
    it('should register a provider', () => {
      factory.registerProvider(mockProvider1);

      expect(factory.hasProvider('github')).toBe(true);
      expect(factory.getProvider('github')).toBe(mockProvider1);
    });

    it('should register multiple providers', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      expect(factory.hasProvider('github')).toBe(true);
      expect(factory.hasProvider('gitlab')).toBe(true);
      expect(factory.getProvider('github')).toBe(mockProvider1);
      expect(factory.getProvider('gitlab')).toBe(mockProvider2);
    });

    it('should overwrite existing provider and log warning', () => {
      const loggerWarnSpy = jest.spyOn(factory['logger'], 'warn').mockImplementation();
      const loggerLogSpy = jest.spyOn(factory['logger'], 'log').mockImplementation();

      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider1); // Register same provider again

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        "Provider with type 'github' is already registered. Overwriting existing provider.",
      );
      expect(loggerLogSpy).toHaveBeenCalledWith('Registered pipeline provider: github');
      expect(factory.hasProvider('github')).toBe(true);

      loggerWarnSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });

    it('should log registration', () => {
      const loggerLogSpy = jest.spyOn(factory['logger'], 'log').mockImplementation();

      factory.registerProvider(mockProvider1);

      expect(loggerLogSpy).toHaveBeenCalledWith('Registered pipeline provider: github');

      loggerLogSpy.mockRestore();
    });
  });

  describe('getProvider', () => {
    it('should return registered provider', () => {
      factory.registerProvider(mockProvider1);

      const provider = factory.getProvider('github');

      expect(provider).toBe(mockProvider1);
    });

    it('should throw error if provider not found', () => {
      expect(() => factory.getProvider('nonexistent')).toThrow(
        "Pipeline provider with type 'nonexistent' not found. Available types: none",
      );
    });

    it('should throw error with available types when provider not found', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      expect(() => factory.getProvider('nonexistent')).toThrow(
        "Pipeline provider with type 'nonexistent' not found. Available types: github, gitlab",
      );
    });
  });

  describe('hasProvider', () => {
    it('should return false for unregistered provider', () => {
      expect(factory.hasProvider('github')).toBe(false);
    });

    it('should return true for registered provider', () => {
      factory.registerProvider(mockProvider1);

      expect(factory.hasProvider('github')).toBe(true);
    });

    it('should return true after provider is overwritten', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider1);

      expect(factory.hasProvider('github')).toBe(true);
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
      expect(types).toContain('github');
      expect(types).toContain('gitlab');
    });

    it('should return types in registration order', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      const types = factory.getRegisteredTypes();

      expect(types[0]).toBe('github');
      expect(types[1]).toBe('gitlab');
    });
  });

  describe('getAllProviders', () => {
    it('should return empty array when no providers registered', () => {
      expect(factory.getAllProviders()).toEqual([]);
    });

    it('should return array of all registered providers', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      const providers = factory.getAllProviders();

      expect(providers).toHaveLength(2);
      expect(providers).toContain(mockProvider1);
      expect(providers).toContain(mockProvider2);
    });

    it('should return providers in registration order', () => {
      factory.registerProvider(mockProvider1);
      factory.registerProvider(mockProvider2);

      const providers = factory.getAllProviders();

      expect(providers[0]).toBe(mockProvider1);
      expect(providers[1]).toBe(mockProvider2);
    });
  });
});
