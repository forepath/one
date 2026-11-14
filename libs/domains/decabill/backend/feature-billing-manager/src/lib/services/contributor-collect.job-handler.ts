import { runWithTenantId } from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';

import { ContributorJobRunsRepository } from '../repositories/contributor-job-runs.repository';

import { ContributorJobRegistryService } from './contributor-job-registry.service';

const GENERIC_JOB_ERROR = 'Job failed';

@Injectable()
export class ContributorCollectJobHandler {
  private readonly logger = new Logger(ContributorCollectJobHandler.name);

  constructor(
    private readonly jobRegistry: ContributorJobRegistryService,
    private readonly jobRunsRepository: ContributorJobRunsRepository,
  ) {}

  async processTenant(tenantId: string, now: Date = new Date()): Promise<void> {
    if (!isContributorCollectEnabled()) {
      return;
    }

    await runWithTenantId(tenantId, async () => {
      for (const registered of this.jobRegistry.list()) {
        try {
          if (registered.definition.isEnabled && !registered.definition.isEnabled()) {
            continue;
          }

          const last = await this.jobRunsRepository.findByIdentity(
            registered.source,
            registered.sourceKey,
            registered.definition.key,
          );

          if (last?.lastFinishedAt) {
            const elapsed = now.getTime() - new Date(last.lastFinishedAt).getTime();

            if (elapsed < registered.definition.intervalMs) {
              continue;
            }
          }

          const startedAt = now;

          await this.jobRunsRepository.upsertRun({
            source: registered.source,
            sourceKey: registered.sourceKey,
            jobKey: registered.definition.key,
            lastStartedAt: startedAt,
            lastFinishedAt: last?.lastFinishedAt ?? null,
            lastError: null,
          });

          try {
            await registered.definition.run({
              tenantId,
              now,
              source: registered.source,
              sourceKey: registered.sourceKey,
            });
            await this.jobRunsRepository.upsertRun({
              source: registered.source,
              sourceKey: registered.sourceKey,
              jobKey: registered.definition.key,
              lastStartedAt: startedAt,
              lastFinishedAt: new Date(),
              lastError: null,
            });
          } catch (error: unknown) {
            this.logger.warn(
              `Contributor job ${registered.source}/${registered.sourceKey}/${registered.definition.key} failed`,
            );
            await this.jobRunsRepository.upsertRun({
              source: registered.source,
              sourceKey: registered.sourceKey,
              jobKey: registered.definition.key,
              lastStartedAt: startedAt,
              lastFinishedAt: new Date(),
              lastError: GENERIC_JOB_ERROR,
            });
            void error;
          }
        } catch (error: unknown) {
          this.logger.warn(
            `Contributor job dispatch failed for ${registered.source}/${registered.sourceKey}/${registered.definition.key}`,
          );
          void error;
        }
      }
    });
  }
}

export function isContributorCollectEnabled(): boolean {
  const raw = process.env.BILLING_CONTRIBUTOR_COLLECT_ENABLED;

  if (raw === undefined || raw.trim() === '') {
    return true;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return true;
}
