import { buildCoordinatorJobId } from '@forepath/shared/backend';

/** Central registry for agent-controller BullMQ queues, job names, and coordinator schedules. */

export const CONTROLLER_QUEUE_NAME = 'agent-controller';

export const ControllerJobName = {
  CONTEXT_IMPORT_COORDINATOR: 'context-import.coordinator',
  CONTEXT_IMPORT_UNIT: 'context-import.unit',
  KNOWLEDGE_EMBEDDING_COORDINATOR: 'knowledge-embedding.coordinator',
  KNOWLEDGE_EMBEDDING_UNIT: 'knowledge-embedding.unit',
  FILTER_RULES_SYNC_COORDINATOR: 'filter-rules-sync.coordinator',
  FILTER_RULES_SYNC_UNIT: 'filter-rules-sync.unit',
  FILTER_RULES_RECONCILE: 'filter-rules-sync.reconcile',
  AUTONOMOUS_TICKET_COORDINATOR: 'autonomous-ticket.coordinator',
  AUTONOMOUS_TICKET_UNIT: 'autonomous-ticket.unit',
} as const;

export type ControllerJobName = (typeof ControllerJobName)[keyof typeof ControllerJobName];

export interface ControllerRepeatableJobDefinition {
  name: ControllerJobName;
  coordinatorJobId: string;
  everyMs: number;
  disabled?: boolean;
}

function parseIntervalMs(envKey: string, fallback: number): number {
  const parsed = parseInt(process.env[envKey] ?? String(fallback), 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getControllerRepeatableJobs(): ControllerRepeatableJobDefinition[] {
  const knowledgeInterval = parseIntervalMs('KNOWLEDGE_EMBEDDINGS_REINDEX_INTERVAL_MS', 3_600_000);
  const contextImportInterval = parseIntervalMs('CONTEXT_IMPORT_SCHEDULER_INTERVAL_MS', 120_000);
  const jobs: ControllerRepeatableJobDefinition[] = [
    {
      name: ControllerJobName.FILTER_RULES_SYNC_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('filter-rules-sync'),
      everyMs: parseIntervalMs('FILTER_RULES_SYNC_INTERVAL_MS', 30_000),
    },
    {
      name: ControllerJobName.FILTER_RULES_RECONCILE,
      coordinatorJobId: buildCoordinatorJobId('filter-rules-reconcile'),
      everyMs: parseIntervalMs('FILTER_RULES_SYNC_INTERVAL_MS', 30_000),
    },
    {
      name: ControllerJobName.AUTONOMOUS_TICKET_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('autonomous-ticket'),
      everyMs: parseIntervalMs('AUTONOMOUS_TICKET_SCHEDULER_INTERVAL_MS', 60_000),
    },
  ];

  if (contextImportInterval > 0) {
    jobs.push({
      name: ControllerJobName.CONTEXT_IMPORT_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('context-import'),
      everyMs: contextImportInterval,
    });
  }

  if (knowledgeInterval > 0) {
    jobs.push({
      name: ControllerJobName.KNOWLEDGE_EMBEDDING_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('knowledge-embedding'),
      everyMs: knowledgeInterval,
    });
  }

  return jobs;
}

export function getContextImportItemBudget(): number {
  return parseInt(process.env.CONTEXT_IMPORT_ITEM_BUDGET ?? '25', 10);
}

export function getContextImportConfigBatch(): number {
  return parseInt(process.env.CONTEXT_IMPORT_SCHEDULER_CONFIG_BATCH ?? '3', 10);
}

export function getFilterRulesSyncBatchSize(): number {
  return parseInt(process.env.FILTER_RULES_SYNC_BATCH_SIZE ?? '10', 10);
}

export function getAutonomousTicketBatchSize(): number {
  return parseInt(process.env.AUTONOMOUS_TICKET_SCHEDULER_BATCH_SIZE ?? '5', 10);
}

export function getKnowledgeEmbeddingPageBatchSize(): number {
  return parseInt(process.env.KNOWLEDGE_EMBEDDINGS_PAGE_BATCH_SIZE ?? '50', 10);
}
