import { ProviderRegistry } from '@forepath/shared/backend/util-extension-core';

import type { ExternalImportConfigEntity } from '../entities/external-import-config.entity';
import { ExternalImportProviderId } from '../entities/external-import.enums';
import type { ExternalContextImportProvider } from '@forepath/agenstra/backend/util-plugin-host';

import { ContextImportOrchestratorService } from './context-import-orchestrator.service';

describe('ContextImportOrchestratorService', () => {
  const registry = new ProviderRegistry<ExternalContextImportProvider>();
  const configService = {
    findEntityWithConnection: jest.fn(),
    recordRunOutcome: jest.fn(),
    findEnabledForSchedulerBatch: jest.fn(),
  };
  const provider = {
    getType: () => ExternalImportProviderId.ATLASSIAN,
    runImport: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    registry.register(ExternalImportProviderId.ATLASSIAN, provider as unknown as ExternalContextImportProvider);
    provider.runImport.mockResolvedValue({ processedCount: 0, hasMore: false });
    configService.recordRunOutcome.mockResolvedValue(undefined);
  });

  function svc(): ContextImportOrchestratorService {
    return new ContextImportOrchestratorService(registry, configService as never);
  }

  it('runConfigById returns early when config is missing', async () => {
    configService.findEntityWithConnection.mockResolvedValue(null);

    await svc().runConfigById('missing-id');

    expect(provider.runImport).not.toHaveBeenCalled();
    expect(configService.recordRunOutcome).not.toHaveBeenCalled();
  });

  it('runConfigById skips when config disabled', async () => {
    configService.findEntityWithConnection.mockResolvedValue({
      id: 'cfg-1',
      enabled: false,
      provider: ExternalImportProviderId.ATLASSIAN,
    } as ExternalImportConfigEntity);

    await svc().runConfigById('cfg-1');

    expect(provider.runImport).not.toHaveBeenCalled();
  });

  it('runConfigById invokes provider and records outcome', async () => {
    configService.findEntityWithConnection.mockResolvedValue({
      id: 'cfg-1',
      enabled: true,
      provider: ExternalImportProviderId.ATLASSIAN,
    } as ExternalImportConfigEntity);

    await svc().runConfigById('cfg-1', 10);

    expect(provider.runImport).toHaveBeenCalledWith({
      config: expect.objectContaining({ id: 'cfg-1' }),
      itemBudget: 10,
    });
    expect(configService.recordRunOutcome).toHaveBeenCalledWith('cfg-1', null);
  });

  it('runConfigById records provider errorMessage', async () => {
    configService.findEntityWithConnection.mockResolvedValue({
      id: 'cfg-1',
      enabled: true,
      provider: ExternalImportProviderId.ATLASSIAN,
    } as ExternalImportConfigEntity);
    provider.runImport.mockResolvedValue({ processedCount: 0, hasMore: false, errorMessage: 'sync failed' });

    await svc().runConfigById('cfg-1');

    expect(configService.recordRunOutcome).toHaveBeenCalledWith('cfg-1', 'sync failed');
  });

  it('runConfigById records thrown errors', async () => {
    configService.findEntityWithConnection.mockResolvedValue({
      id: 'cfg-1',
      enabled: true,
      provider: ExternalImportProviderId.ATLASSIAN,
    } as ExternalImportConfigEntity);
    provider.runImport.mockRejectedValue(new Error('boom'));

    await svc().runConfigById('cfg-1');

    expect(configService.recordRunOutcome).toHaveBeenCalledWith('cfg-1', 'boom');
  });

  it('runSchedulerBatch processes enabled configs', async () => {
    configService.findEnabledForSchedulerBatch.mockResolvedValue([
      { id: 'cfg-1', enabled: true, provider: ExternalImportProviderId.ATLASSIAN },
      { id: 'cfg-2', enabled: true, provider: ExternalImportProviderId.ATLASSIAN },
    ]);

    const count = await svc().runSchedulerBatch(2, 5);

    expect(count).toBe(2);
    expect(provider.runImport).toHaveBeenCalledTimes(2);
    expect(configService.recordRunOutcome).toHaveBeenCalledTimes(2);
  });
});
