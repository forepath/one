import {
  AGENSTRA_SEARCH_ENTITY_TYPES,
  AgenstraNotificationPublisher,
  AgenstraSearchIndexService,
  AutonomousRunOrchestratorService,
  ContextImportOrchestratorService,
  ExternalImportConfigService,
  FilterRulesService,
  FilterRulesSyncService,
  isAgenstraSearchEntityType,
  KnowledgeEmbeddingIndexService,
  OpencodeConfigSyncTargetsService,
  OpencodeLayerFilesService,
  OpencodeProvidersCatalogService,
  OpencodeMcpServersCatalogService,
} from '@forepath/agenstra/backend/feature-agent-controller';
import {
  EMAIL_DELIVER_JOB_NAME,
  EmailDeliveryService,
  enqueueUnitJob,
  resolveEmailDeliverJobPayload,
  resolveWebhookDeliverJobPayload,
  UPDATE_CHECK_JOB_NAME,
  UpdateCheckService,
  WebhookDeliveryRetentionService,
  WebhookDeliveryService,
  WEBHOOK_DELIVER_JOB_NAME,
  WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
  type EmailDeliverJobPayload,
  type WebhookDeliverJobPayload,
} from '@forepath/shared/backend';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

import {
  CONTROLLER_QUEUE_NAME,
  ControllerJobName,
  getAutonomousTicketBatchSize,
  getContextImportConfigBatch,
  getContextImportItemBudget,
  getFilterRulesSyncBatchSize,
  getKnowledgeEmbeddingPageBatchSize,
  getOpencodeConfigSyncBatchSize,
  getOpencodeLayerFilesSyncBatchSize,
  getSearchReindexBatchSize,
} from '../job-registry';

@Processor(CONTROLLER_QUEUE_NAME, {
  concurrency: parseInt(process.env.QUEUE_WORKER_CONCURRENCY ?? '5', 10),
  lockDuration: 600_000,
})
export class ControllerJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(ControllerJobsProcessor.name);

  constructor(
    @InjectQueue(CONTROLLER_QUEUE_NAME) private readonly controllerQueue: Queue,
    private readonly contextImportOrchestrator: ContextImportOrchestratorService,
    private readonly contextImportConfigService: ExternalImportConfigService,
    private readonly knowledgeEmbeddingIndex: KnowledgeEmbeddingIndexService,
    private readonly filterRulesSync: FilterRulesSyncService,
    private readonly filterRulesService: FilterRulesService,
    private readonly autonomousOrchestrator: AutonomousRunOrchestratorService,
    private readonly webhookDeliveryService: WebhookDeliveryService,
    private readonly webhookDeliveryRetentionService: WebhookDeliveryRetentionService,
    private readonly emailDeliveryService: EmailDeliveryService,
    private readonly updateCheckService: UpdateCheckService,
    private readonly searchIndex: AgenstraSearchIndexService,
    private readonly notificationPublisher: AgenstraNotificationPublisher,
    private readonly opencodeProvidersCatalog: OpencodeProvidersCatalogService,
    private readonly opencodeMcpServersCatalog: OpencodeMcpServersCatalogService,
    private readonly opencodeConfigSyncTargets: OpencodeConfigSyncTargetsService,
    private readonly opencodeLayerFiles: OpencodeLayerFilesService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case ControllerJobName.CONTEXT_IMPORT_COORDINATOR:
        await this.runContextImportCoordinator();
        break;
      case ControllerJobName.CONTEXT_IMPORT_UNIT:
        await this.contextImportOrchestrator.runConfigById(
          (job.data as { configId: string }).configId,
          getContextImportItemBudget(),
        );
        break;
      case ControllerJobName.KNOWLEDGE_EMBEDDING_COORDINATOR:
        await this.runKnowledgeEmbeddingCoordinator();
        break;

      case ControllerJobName.KNOWLEDGE_EMBEDDING_UNIT: {
        const data = job.data as { clientId: string; nodeId: string; title: string; content: string };

        await this.knowledgeEmbeddingIndex.reindexPage(data.clientId, data.nodeId, data.title, data.content);
        break;
      }

      case ControllerJobName.FILTER_RULES_SYNC_COORDINATOR:
        await this.runFilterRulesSyncCoordinator();
        break;
      case ControllerJobName.FILTER_RULES_SYNC_UNIT:
        await this.filterRulesSync.processTargetById((job.data as { targetId: string }).targetId);
        break;
      case ControllerJobName.FILTER_RULES_RECONCILE:
        await this.filterRulesService.reconcileAllGlobalRules();
        break;
      case ControllerJobName.OPENCODE_CONFIG_SYNC_COORDINATOR:
        await this.runOpencodeConfigSyncCoordinator();
        break;
      case ControllerJobName.OPENCODE_CONFIG_SYNC_UNIT:
        await this.opencodeConfigSyncTargets.processTargetById((job.data as { targetId: string }).targetId);
        break;
      case ControllerJobName.OPENCODE_LAYER_FILES_SYNC_COORDINATOR:
        await this.runOpencodeLayerFilesSyncCoordinator();
        break;
      case ControllerJobName.OPENCODE_LAYER_FILES_SYNC_UNIT:
        await this.opencodeLayerFiles.processTargetById((job.data as { targetId: string }).targetId);
        break;
      case ControllerJobName.AUTONOMOUS_TICKET_COORDINATOR:
        await this.runAutonomousTicketCoordinator();
        break;
      case ControllerJobName.AUTONOMOUS_TICKET_UNIT:
        await this.autonomousOrchestrator.tryStartRunForCandidate(
          job.data as { ticket_id: string; client_id: string; agent_id: string },
        );
        break;
      case ControllerJobName.SEARCH_REINDEX_COORDINATOR:
        await this.runSearchReindexCoordinator();
        break;
      case ControllerJobName.SEARCH_REINDEX_UNIT:
        await this.runSearchReindexUnit(job.data as { entityType: string; offset: number; limit: number });
        break;
      case ControllerJobName.SEARCH_INDEX_SYNC_UNIT:
        await this.runSearchIndexSyncUnit(
          job.data as {
            entityType: string;
            id: string;
            action: 'upsert' | 'delete';
            document?: Record<string, unknown>;
          },
        );
        break;
      case WEBHOOK_DELIVER_JOB_NAME:
        await this.webhookDeliveryService.deliver(resolveWebhookDeliverJobPayload(job));
        break;
      case EMAIL_DELIVER_JOB_NAME:
        await this.emailDeliveryService.deliver(resolveEmailDeliverJobPayload(job as Job<EmailDeliverJobPayload>));
        break;
      case WEBHOOK_DELIVERY_RETENTION_COORDINATOR:
        await this.webhookDeliveryRetentionService.applyRetentionForAllEndpoints();
        break;
      case ControllerJobName.UPDATE_CHECK:
      case UPDATE_CHECK_JOB_NAME:
        await this.updateCheckService.runCheck();
        break;
      case ControllerJobName.OPENCODE_PROVIDERS_REFRESH:
        await this.opencodeProvidersCatalog.refreshFromModelsDev();
        break;
      case ControllerJobName.OPENCODE_MCP_SERVERS_REFRESH:
        await this.opencodeMcpServersCatalog.refreshFromOfficialRegistry();
        break;
      default:
        this.logger.warn(`Unknown controller job name: ${job.name}`);
    }
  }

  private async runContextImportCoordinator(): Promise<void> {
    const configs = await this.contextImportConfigService.findEnabledForSchedulerBatch(getContextImportConfigBatch());

    for (const config of configs) {
      await enqueueUnitJob({
        queue: this.controllerQueue,
        jobName: ControllerJobName.CONTEXT_IMPORT_UNIT,
        payload: { configId: config.id },
        jobIdNamespace: 'context-import:config',
        jobIdParts: [config.id],
      });
    }
  }

  private async runKnowledgeEmbeddingCoordinator(): Promise<void> {
    const batchSize = getKnowledgeEmbeddingPageBatchSize();
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pages = await this.knowledgeEmbeddingIndex.findPageIdsBatch(offset, batchSize);

      if (pages.length === 0) {
        break;
      }

      for (const page of pages) {
        await enqueueUnitJob({
          queue: this.controllerQueue,
          jobName: ControllerJobName.KNOWLEDGE_EMBEDDING_UNIT,
          payload: page,
          jobIdNamespace: 'knowledge:page',
          jobIdParts: [page.clientId, page.nodeId],
        });
      }

      offset += pages.length;

      if (pages.length < batchSize) {
        break;
      }
    }
  }

  private async runSearchReindexCoordinator(): Promise<void> {
    if (!this.searchIndex.isEnabled()) {
      return;
    }

    this.notificationPublisher.publish('search.reindex.started', {
      entityTypes: [...AGENSTRA_SEARCH_ENTITY_TYPES],
      startedAt: new Date().toISOString(),
    });

    try {
      const batchSize = getSearchReindexBatchSize();

      for (const entityType of AGENSTRA_SEARCH_ENTITY_TYPES) {
        await enqueueUnitJob({
          queue: this.controllerQueue,
          jobName: ControllerJobName.SEARCH_REINDEX_UNIT,
          payload: { entityType, offset: 0, limit: batchSize },
          jobIdNamespace: 'search-reindex',
          jobIdParts: [entityType, 0],
        });
      }

      this.notificationPublisher.publish('search.reindex.completed', {
        entityTypes: [...AGENSTRA_SEARCH_ENTITY_TYPES],
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.notificationPublisher.publish('search.reindex.failed', {
        error: (error as Error).message,
        failedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private async runSearchReindexUnit(data: { entityType: string; offset: number; limit: number }): Promise<void> {
    if (!isAgenstraSearchEntityType(data.entityType)) {
      this.logger.warn(`Unknown search entity type for reindex: ${data.entityType}`);

      return;
    }

    try {
      const result = await this.searchIndex.reindexBatch(data.entityType, data.offset, data.limit);

      if (result.hasMore) {
        const nextOffset = data.offset + data.limit;

        await enqueueUnitJob({
          queue: this.controllerQueue,
          jobName: ControllerJobName.SEARCH_REINDEX_UNIT,
          payload: { entityType: data.entityType, offset: nextOffset, limit: data.limit },
          jobIdNamespace: 'search-reindex',
          jobIdParts: [data.entityType, nextOffset],
        });
      }
    } catch (error) {
      this.notificationPublisher.publish('search.reindex.failed', {
        entityType: data.entityType,
        offset: data.offset,
        error: (error as Error).message,
        failedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private async runSearchIndexSyncUnit(data: {
    entityType: string;
    id: string;
    action: 'upsert' | 'delete';
    document?: Record<string, unknown>;
  }): Promise<void> {
    if (!isAgenstraSearchEntityType(data.entityType)) {
      return;
    }

    try {
      if (data.action === 'delete') {
        await this.searchIndex.delete(data.entityType, data.id);

        return;
      }

      if (!data.document) {
        throw new Error('Missing document for search index upsert sync');
      }

      await this.searchIndex.upsert(data.entityType, {
        ...(data.document as { id: string }),
        id: data.id,
        entityType: data.entityType,
      });
    } catch (error) {
      this.notificationPublisher.publish('search.document.sync_failed', {
        entityType: data.entityType,
        id: data.id,
        action: data.action,
        error: (error as Error).message,
        failedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private async runFilterRulesSyncCoordinator(): Promise<void> {
    const targetIds = await this.filterRulesSync.findPendingTargetIds(getFilterRulesSyncBatchSize());

    for (const targetId of targetIds) {
      await enqueueUnitJob({
        queue: this.controllerQueue,
        jobName: ControllerJobName.FILTER_RULES_SYNC_UNIT,
        payload: { targetId },
        jobIdNamespace: 'filter-rules:target',
        jobIdParts: [targetId],
      });
    }
  }

  private async runOpencodeConfigSyncCoordinator(): Promise<void> {
    const targetIds = await this.opencodeConfigSyncTargets.findPendingTargetIds(getOpencodeConfigSyncBatchSize());

    for (const targetId of targetIds) {
      await enqueueUnitJob({
        queue: this.controllerQueue,
        jobName: ControllerJobName.OPENCODE_CONFIG_SYNC_UNIT,
        payload: { targetId },
        jobIdNamespace: 'opencode-config:target',
        jobIdParts: [targetId],
      });
    }
  }

  private async runOpencodeLayerFilesSyncCoordinator(): Promise<void> {
    const targetIds = await this.opencodeLayerFiles.findPendingTargetIds(getOpencodeLayerFilesSyncBatchSize());

    for (const targetId of targetIds) {
      await enqueueUnitJob({
        queue: this.controllerQueue,
        jobName: ControllerJobName.OPENCODE_LAYER_FILES_SYNC_UNIT,
        payload: { targetId },
        jobIdNamespace: 'opencode-layer-files:target',
        jobIdParts: [targetId],
      });
    }
  }

  private async runAutonomousTicketCoordinator(): Promise<void> {
    const candidates = await this.autonomousOrchestrator.findCandidateIds(getAutonomousTicketBatchSize());

    for (const candidate of candidates) {
      await enqueueUnitJob({
        queue: this.controllerQueue,
        jobName: ControllerJobName.AUTONOMOUS_TICKET_UNIT,
        payload: candidate,
        jobIdNamespace: 'autonomous-ticket',
        jobIdParts: [candidate.ticket_id],
      });
    }
  }
}
