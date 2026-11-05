import { Injectable, Logger } from '@nestjs/common';

import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';

import { BillingSearchIndexService } from './billing-search-index.service';
import {
  BILLING_SEARCH_ENTITY_TYPES,
  BILLING_SEARCH_REINDEX_BATCH_SIZE,
  type BillingSearchEntityType,
} from './billing-search.types';

export interface SearchReindexUnitPayload {
  tenantId: string;
  entityType: BillingSearchEntityType;
  offset?: number;
  limit?: number;
}

export interface SearchIndexSyncUnitPayload {
  tenantId: string;
  entityType: BillingSearchEntityType;
  id: string;
  action: 'upsert' | 'delete';
  document?: Record<string, unknown>;
}

@Injectable()
export class SearchReindexJobHandler {
  private readonly logger = new Logger(SearchReindexJobHandler.name);

  constructor(
    private readonly billingSearchIndexService: BillingSearchIndexService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
  ) {}

  listEntityTypes(): BillingSearchEntityType[] {
    return [...BILLING_SEARCH_ENTITY_TYPES];
  }

  publishReindexStarted(tenantId: string): void {
    this.billingNotificationPublisher.publish('search.reindex.started', {
      tenantId,
      entityTypes: this.listEntityTypes(),
      startedAt: new Date().toISOString(),
    });
  }

  publishReindexCompleted(tenantId: string, entityTypeCount: number): void {
    this.billingNotificationPublisher.publish('search.reindex.completed', {
      tenantId,
      entityTypeCount,
      entityTypes: this.listEntityTypes(),
      completedAt: new Date().toISOString(),
    });
  }

  publishReindexFailed(tenantId: string, message: string): void {
    this.billingNotificationPublisher.publish('search.reindex.failed', {
      tenantId,
      message,
      error: message,
      failedAt: new Date().toISOString(),
    });
  }

  async processReindexUnit(
    payload: SearchReindexUnitPayload,
  ): Promise<{ processed: number; hasMore: boolean; nextOffset: number }> {
    const offset = payload.offset ?? 0;
    const limit = payload.limit ?? BILLING_SEARCH_REINDEX_BATCH_SIZE;
    const result = await this.billingSearchIndexService.reindexBatch(payload.entityType, offset, limit);

    this.logger.debug(
      `Reindexed ${result.processed} ${payload.entityType} docs for tenant ${payload.tenantId} at offset ${offset}`,
    );

    return {
      processed: result.processed,
      hasMore: result.hasMore,
      nextOffset: offset + result.processed,
    };
  }

  async processSyncUnit(payload: SearchIndexSyncUnitPayload): Promise<void> {
    try {
      if (payload.action === 'delete') {
        await this.billingSearchIndexService.delete(payload.entityType, payload.id);

        return;
      }

      if (!payload.document || typeof payload.document['id'] !== 'string') {
        this.logger.warn(`search-index-sync.unit missing document for ${payload.entityType}/${payload.id}`);

        return;
      }

      await this.billingSearchIndexService.upsert(payload.entityType, {
        ...(payload.document as { id: string; tenantId: string; entityType: BillingSearchEntityType }),
        id: payload.id,
        tenantId: payload.tenantId,
        entityType: payload.entityType,
      });
    } catch (error) {
      this.billingNotificationPublisher.publish('search.document.sync_failed', {
        tenantId: payload.tenantId,
        entityType: payload.entityType,
        id: payload.id,
        action: payload.action,
        error: (error as Error).message,
        failedAt: new Date().toISOString(),
      });
      throw error;
    }
  }
}
