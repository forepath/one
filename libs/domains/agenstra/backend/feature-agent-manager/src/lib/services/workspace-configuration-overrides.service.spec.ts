import { BadRequestException } from '@nestjs/common';

import { WorkspaceConfigurationOverridesRepository } from '../repositories/workspace-configuration-overrides.repository';

import { AgentEnvironmentVariablesService } from './agent-environment-variables.service';
import { WorkspaceConfigurationOverridesService } from './workspace-configuration-overrides.service';

describe('WorkspaceConfigurationOverridesService', () => {
  let service: WorkspaceConfigurationOverridesService;
  let repository: jest.Mocked<WorkspaceConfigurationOverridesRepository>;
  let agentEnvironmentVariablesService: jest.Mocked<AgentEnvironmentVariablesService>;
  const originalEnv = process.env;

  beforeEach(() => {
    repository = {
      findAll: jest.fn(),
      findBySettingKey: jest.fn(),
      upsert: jest.fn(),
      deleteBySettingKey: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceConfigurationOverridesRepository>;
    agentEnvironmentVariablesService = {
      reconcileWorkspaceConfigurationOverrides: jest.fn(),
    } as unknown as jest.Mocked<AgentEnvironmentVariablesService>;
    service = new WorkspaceConfigurationOverridesService(repository, agentEnvironmentVariablesService);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('resolves effective settings preferring overrides over env defaults', async () => {
    process.env.GIT_REPOSITORY_URL = 'https://default.example/repo.git';
    repository.findAll.mockResolvedValue([
      {
        id: '1',
        settingKey: 'gitRepositoryUrl',
        value: 'https://override.example/repo.git',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    const settings = await service.getEffectiveSettings();
    const repoSetting = settings.find((entry) => entry.settingKey === 'gitRepositoryUrl');

    expect(repoSetting).toEqual(
      expect.objectContaining({
        value: 'https://override.example/repo.git',
        source: 'override',
        hasOverride: true,
      }),
    );
  });

  it('upserts override and mutates process.env', async () => {
    repository.upsert.mockResolvedValue({
      id: '1',
      settingKey: 'cursorApiKey',
      value: 'sk-123',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await service.upsertOverride('cursorApiKey', 'sk-123');

    expect(repository.upsert).toHaveBeenCalledWith('cursorApiKey', 'sk-123');
    expect(process.env.CURSOR_API_KEY).toBe('sk-123');
    expect(agentEnvironmentVariablesService.reconcileWorkspaceConfigurationOverrides).toHaveBeenCalledWith({
      CURSOR_API_KEY: 'sk-123',
    });
  });

  it('loads persisted overrides into process.env on module init', async () => {
    repository.findAll.mockResolvedValue([
      {
        id: '1',
        settingKey: 'gitToken',
        value: 'boot-token',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      {
        id: '2',
        settingKey: 'cursorApiKey',
        value: 'boot-cursor-key',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    await service.onModuleInit();

    expect(process.env.GIT_TOKEN).toBe('boot-token');
    expect(process.env.CURSOR_API_KEY).toBe('boot-cursor-key');
  });

  it('deletes override and removes process env value', async () => {
    process.env.GIT_TOKEN = 'old';
    repository.deleteBySettingKey.mockResolvedValue(1);

    await service.deleteOverride('gitToken');

    expect(repository.deleteBySettingKey).toHaveBeenCalledWith('gitToken');
    expect(process.env.GIT_TOKEN).toBeUndefined();
    expect(agentEnvironmentVariablesService.reconcileWorkspaceConfigurationOverrides).toHaveBeenCalledWith({
      GIT_TOKEN: undefined,
    });
  });

  it('rejects unknown setting keys', async () => {
    await expect(service.upsertOverride('unknownKey', 'v')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteOverride('unknownKey')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects autoEnrichEnabledGlobal values other than true or false', async () => {
    await expect(service.upsertOverride('autoEnrichEnabledGlobal', 'maybe')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('normalizes autoEnrichEnabledGlobal to lowercase on upsert', async () => {
    repository.upsert.mockResolvedValue({
      id: '1',
      settingKey: 'autoEnrichEnabledGlobal',
      value: 'false',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await service.upsertOverride('autoEnrichEnabledGlobal', 'FALSE');

    expect(repository.upsert).toHaveBeenCalledWith('autoEnrichEnabledGlobal', 'false');
    expect(process.env.AUTO_ENRICH_ENABLED_GLOBAL).toBe('false');
  });

  it('rejects autoEnrichVectorMaxCosineDistance outside 0..2', async () => {
    await expect(service.upsertOverride('autoEnrichVectorMaxCosineDistance', '3')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.upsertOverride('autoEnrichVectorMaxCosineDistance', '-0.1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.upsertOverride('autoEnrichVectorMaxCosineDistance', 'nan')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts autoEnrichVectorMaxCosineDistance within 0..2', async () => {
    repository.upsert.mockResolvedValue({
      id: '1',
      settingKey: 'autoEnrichVectorMaxCosineDistance',
      value: '0.35',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await service.upsertOverride('autoEnrichVectorMaxCosineDistance', ' 0.35 ');

    expect(repository.upsert).toHaveBeenCalledWith('autoEnrichVectorMaxCosineDistance', '0.35');
    expect(process.env.AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE).toBe('0.35');
  });
});
