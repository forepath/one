import { Test, TestingModule } from '@nestjs/testing';

import { WorkspaceConfigurationOverridesService } from '../services/workspace-configuration-overrides.service';

import { WorkspaceConfigurationOverridesController } from './workspace-configuration-overrides.controller';

describe('WorkspaceConfigurationOverridesController', () => {
  let controller: WorkspaceConfigurationOverridesController;
  let service: jest.Mocked<WorkspaceConfigurationOverridesService>;
  const mockService = {
    getEffectiveSettings: jest.fn(),
    upsertOverride: jest.fn(),
    deleteOverride: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceConfigurationOverridesController],
      providers: [{ provide: WorkspaceConfigurationOverridesService, useValue: mockService }],
    }).compile();

    controller = module.get<WorkspaceConfigurationOverridesController>(WorkspaceConfigurationOverridesController);
    service = module.get(WorkspaceConfigurationOverridesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('lists effective settings', async () => {
    service.getEffectiveSettings.mockResolvedValue([{ settingKey: 'gitToken' } as any]);

    const result = await controller.getConfigurationOverrides();

    expect(result).toHaveLength(1);
    expect(service.getEffectiveSettings).toHaveBeenCalled();
  });

  it('upserts a setting', async () => {
    service.upsertOverride.mockResolvedValue({ settingKey: 'gitToken', value: 'abc' } as any);

    const result = await controller.upsertConfigurationOverride('gitToken', { value: 'abc' });

    expect(result.settingKey).toBe('gitToken');
    expect(service.upsertOverride).toHaveBeenCalledWith('gitToken', 'abc');
  });

  it('deletes a setting', async () => {
    service.deleteOverride.mockResolvedValue(undefined);

    await controller.deleteConfigurationOverride('gitToken');

    expect(service.deleteOverride).toHaveBeenCalledWith('gitToken');
  });
});
