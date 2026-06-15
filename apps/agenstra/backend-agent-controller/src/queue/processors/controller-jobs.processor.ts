import {
  AutonomousRunOrchestratorService,
  ContextImportOrchestratorService,
  ExternalImportConfigService,
  FilterRulesService,
  FilterRulesSyncService,
  KnowledgeEmbeddingIndexService,
} from '@forepath/agenstra/backend/feature-agent-controller';
import { enqueueUnitJob } from '@forepath/shared/backend';
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
      case ControllerJobName.AUTONOMOUS_TICKET_COORDINATOR:
        await this.runAutonomousTicketCoordinator();
        break;
      case ControllerJobName.AUTONOMOUS_TICKET_UNIT:
        await this.autonomousOrchestrator.tryStartRunForCandidate(
          job.data as { ticket_id: string; client_id: string; agent_id: string },
        );
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
