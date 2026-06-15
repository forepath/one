import type { ExternalImportConfigEntity } from '../entities/external-import-config.entity';
import { ExternalImportProviderId } from '../entities/external-import.enums';
import { ExternalImportProviderFactory } from '../providers/external-import-provider.factory';
import type { ExternalContextImportProvider } from '../providers/external-import-provider.interface';

import { ContextImportOrchestratorService } from './context-import-orchestrator.service';

describe('ContextImportOrchestratorService', () => {
  const factory = new ExternalImportProviderFactory();
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
    factory.registerProvider(provider as unknown as ExternalContextImportProvider);
    provider.runImport.mockResolvedValue({ processedCount: 0, hasMore: false });
    configService.recordRunOutcome.mockResolvedValue(undefined);
  });

  function svc(): ContextImportOrchestratorService {
    return new ContextImportOrchestratorService(factory, configService as never);
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

    expect(provider.runImport).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ id: 'cfg-1' }),
        itemBudget: 10,
      }),
    );
    expect(configService.recordRunOutcome).toHaveBeenCalledWith('cfg-1', null);
  });

  it('runConfigById records null when provider returns only whitespace errorMessage', async () => {
    configService.findEntityWithConnection.mockResolvedValue({
      id: 'cfg-1',
      enabled: true,
      provider: ExternalImportProviderId.ATLASSIAN,
    } as ExternalImportConfigEntity);
    provider.runImport.mockResolvedValue({ processedCount: 1, hasMore: false, errorMessage: ' \n\t ' });

    await svc().runConfigById('cfg-1');

    expect(configService.recordRunOutcome).toHaveBeenCalledWith('cfg-1', null);
  });

  it('runConfigById records failure when provider throws', async () => {
    configService.findEntityWithConnection.mockResolvedValue({
      id: 'cfg-1',
      enabled: true,
      provider: ExternalImportProviderId.ATLASSIAN,
    } as ExternalImportConfigEntity);
    provider.runImport.mockRejectedValue(new Error('network down'));

    await svc().runConfigById('cfg-1');

    expect(configService.recordRunOutcome).toHaveBeenCalledWith('cfg-1', 'network down');
  });

  it('runSchedulerBatch processes enabled configs', async () => {
    configService.findEnabledForSchedulerBatch.mockResolvedValue([
      { id: 'a', provider: ExternalImportProviderId.ATLASSIAN },
      { id: 'b', provider: ExternalImportProviderId.ATLASSIAN },
    ]);

    const n = await svc().runSchedulerBatch(5, 7);

    expect(n).toBe(2);
    expect(provider.runImport).toHaveBeenCalledTimes(2);
    expect(configService.recordRunOutcome).toHaveBeenCalledTimes(2);
  });
});
