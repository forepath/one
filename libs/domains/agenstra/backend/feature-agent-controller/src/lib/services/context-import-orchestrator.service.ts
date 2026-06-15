import { Inject, Injectable, Logger } from '@nestjs/common';

import { ExternalImportProviderFactory } from '../providers/external-import-provider.factory';
import { CONTEXT_IMPORT_PROVIDERS } from '../providers/external-import-provider.tokens';

import { ExternalImportConfigService } from './external-import-config.service';

const DEFAULT_ITEM_BUDGET = 25;

@Injectable()
export class ContextImportOrchestratorService {
  private readonly logger = new Logger(ContextImportOrchestratorService.name);

  constructor(
    @Inject(CONTEXT_IMPORT_PROVIDERS)
    private readonly importProviderFactory: ExternalImportProviderFactory,
    private readonly configService: ExternalImportConfigService,
  ) {}

  async runConfigById(configId: string, itemBudget = DEFAULT_ITEM_BUDGET): Promise<void> {
    const config = await this.configService.findEntityWithConnection(configId);

    if (!config) {
      this.logger.warn(`Import config ${configId} not found`);

      return;
    }

    if (!config.enabled) {
      return;
    }

    const provider = this.importProviderFactory.getProvider(config.provider);
    let recordedError: string | null = null;

    try {
      const result = await provider.runImport({ config, itemBudget });

      recordedError =
        result.errorMessage != null && String(result.errorMessage).trim() !== ''
          ? String(result.errorMessage).trim()
          : null;

      if (recordedError) {
        this.logger.warn(`Import config ${configId}: ${recordedError}`);
      }
    } catch (e: unknown) {
      recordedError = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Import config ${configId}: ${recordedError}`);
    }

    await this.configService.recordRunOutcome(configId, recordedError);
  }

  async runSchedulerBatch(configLimit: number, itemBudget: number): Promise<number> {
    const configs = await this.configService.findEnabledForSchedulerBatch(configLimit);
    let n = 0;

    for (const config of configs) {
      const provider = this.importProviderFactory.getProvider(config.provider);
      let recordedError: string | null = null;

      try {
        const result = await provider.runImport({ config, itemBudget });

        recordedError =
          result.errorMessage != null && String(result.errorMessage).trim() !== ''
            ? String(result.errorMessage).trim()
            : null;

        if (recordedError) {
          this.logger.warn(`Import config ${config.id}: ${recordedError}`);
        }
      } catch (e: unknown) {
        recordedError = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Import config ${config.id}: ${recordedError}`);
      }

      await this.configService.recordRunOutcome(config.id, recordedError);

      n++;
    }

    return n;
  }
}
