import { SettingDefinition } from '@forepath/shared/backend/util-settings-overrides';

/**
 * Agent controller settings overridable from the console (Administration → Settings).
 *
 * Deliberately excluded: infrastructure (database, Valkey, OpenSearch, ports, namespaces), cryptography
 * (`ENCRYPTION_KEY`, `JWT_SECRET`), authentication / CORS / rate limits, client endpoint SSRF guardrails,
 * dynamic provider plugins (code loading), embedding model / dimensions (would invalidate stored vectors) and
 * settings managed elsewhere in the console.
 */
export const CONTROLLER_SETTINGS_CATEGORIES = [
  'email',
  'chat',
  'agent_tasks',
  'agent_handoffs',
  'tickets',
  'knowledge',
  'context_import',
  'deployments',
  'opencode',
  'workspaces',
  'provisioning',
  'background_jobs',
] as const;

export type ControllerSettingsCategory = (typeof CONTROLLER_SETTINGS_CATEGORIES)[number];

const g = (
  category: ControllerSettingsCategory,
  key: string,
  type: SettingDefinition['type'],
  extra: Partial<SettingDefinition> = {},
): SettingDefinition => ({ key, category, type, scope: 'global', ...extra });
const restart = { restartRequired: true } as const;
const COUNTRY = { maxLength: 2, pattern: '^[A-Za-z]{2}$' } as const;

export const CONTROLLER_SETTINGS: readonly SettingDefinition[] = [
  // Email (SMTP)
  g('email', 'SMTP_HOST', 'string'),
  g('email', 'SMTP_PORT', 'integer', { min: 1, max: 65535, defaultValue: '1025' }),
  g('email', 'SMTP_USER', 'string'),
  g('email', 'SMTP_PASSWORD', 'secret'),
  g('email', 'EMAIL_FROM', 'string', { defaultValue: 'noreply@localhost' }),
  g('email', 'EMAIL_COMPANY_NAME', 'string'),
  g('email', 'EMAIL_COMPANY_ADDRESS_LINE1', 'string'),
  g('email', 'EMAIL_COMPANY_POSTAL_CODE', 'string'),
  g('email', 'EMAIL_COMPANY_CITY', 'string'),
  g('email', 'EMAIL_COMPANY_COUNTRY', 'string', COUNTRY),
  g('email', 'EMAIL_COMPANY_VAT_ID', 'string'),
  g('email', 'EMAIL_COMPANY_EMAIL', 'email'),

  // Chat and OpenAI-compatible API
  g('chat', 'OPENAI_COMPATIBLE_API_ENABLED', 'boolean', { defaultValue: 'true' }),
  g('chat', 'REMOTE_AGENT_CHAT_TIMEOUT_MS', 'integer', { min: 1000, defaultValue: '600000' }),
  g('chat', 'OPENAI_CLIENT_TOOL_RESULT_TIMEOUT_MS', 'integer', { min: 10000, max: 3600000, defaultValue: '600000' }),
  g('chat', 'REMOTE_AGENT_COMMIT_MESSAGE_TIMEOUT_MS', 'integer', { min: 1000, defaultValue: '120000' }),
  g('chat', 'AGENSTRA_ATTACHMENT_MAX_BYTES', 'integer', { min: 1024, defaultValue: '26214400', ...restart }),

  // Agent tasks
  g('agent_tasks', 'AGENT_TASK_SCHEDULER_INTERVAL_MS', 'duration', { defaultValue: '30000', ...restart }),
  g('agent_tasks', 'AGENT_TASK_SCHEDULER_BATCH_SIZE', 'integer', { min: 1, defaultValue: '25' }),
  g('agent_tasks', 'AGENT_TASK_RUN_TIMEOUT_MS', 'integer', { min: 1000, defaultValue: '1800000' }),
  g('agent_tasks', 'AGENT_TASK_MIN_INTERVAL_MINUTES', 'integer', { min: 1, defaultValue: '5' }),
  g('agent_tasks', 'AGENT_TASKS_MAX_PER_AGENT', 'integer', { min: 1, defaultValue: '25' }),
  g('agent_tasks', 'AGENT_TASK_HANDOFF_WAIT_TIMEOUT_MS', 'integer', { min: 1000, defaultValue: '3600000' }),
  g('agent_tasks', 'AGENT_TASK_RUN_MAX_HANDOFFS', 'integer', { min: 1, defaultValue: '3' }),

  // Agent handoffs
  g('agent_handoffs', 'AGENT_HANDOFF_SCHEDULER_INTERVAL_MS', 'duration', { defaultValue: '60000', ...restart }),
  g('agent_handoffs', 'AGENT_HANDOFF_TURN_TIMEOUT_MS', 'integer', { min: 1000, defaultValue: '1800000' }),
  g('agent_handoffs', 'AGENT_HANDOFFS_MAX_ACTIVE_PER_WORKSPACE', 'integer', { min: 1, defaultValue: '20' }),
  g('agent_handoffs', 'AGENT_HANDOFF_MAX_DEPTH', 'integer', { min: 1, defaultValue: '3' }),

  // Tickets
  g('tickets', 'AUTONOMOUS_TICKET_SCHEDULER_INTERVAL_MS', 'duration', { defaultValue: '60000', ...restart }),
  g('tickets', 'AUTONOMOUS_TICKET_SCHEDULER_BATCH_SIZE', 'integer', { min: 1, defaultValue: '5' }),
  g('tickets', 'TICKET_BODY_SESSION_TTL_MS', 'integer', { min: 1000 }),

  // Knowledge and auto-enrichment
  g('knowledge', 'AUTO_ENRICH_ENABLED_GLOBAL', 'boolean', { defaultValue: 'true' }),
  g('knowledge', 'AUTO_ENRICH_MAX_SECTIONS', 'integer', { min: 1, defaultValue: '6', ...restart }),
  g('knowledge', 'AUTO_ENRICH_MAX_CHARS', 'integer', { min: 100, defaultValue: '12000', ...restart }),
  g('knowledge', 'AUTO_ENRICH_VECTOR_ENABLED', 'boolean', { defaultValue: 'true', ...restart }),
  g('knowledge', 'AUTO_ENRICH_VECTOR_TOP_K', 'integer', { min: 1, defaultValue: '20', ...restart }),
  g('knowledge', 'AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE', 'number', { min: 0, max: 2 }),
  g('knowledge', 'KNOWLEDGE_EMBEDDINGS_REINDEX_INTERVAL_MS', 'duration', { defaultValue: '3600000', ...restart }),
  g('knowledge', 'KNOWLEDGE_EMBEDDINGS_PAGE_BATCH_SIZE', 'integer', { min: 1, defaultValue: '50' }),

  // Context import (Atlassian)
  g('context_import', 'CONTEXT_IMPORT_SCHEDULER_INTERVAL_MS', 'duration', { defaultValue: '120000', ...restart }),
  g('context_import', 'CONTEXT_IMPORT_SCHEDULER_CONFIG_BATCH', 'integer', { min: 1, defaultValue: '3' }),
  g('context_import', 'CONTEXT_IMPORT_ITEM_BUDGET', 'integer', { min: 1, defaultValue: '25' }),
  g('context_import', 'ATLASSIAN_IMPORT_DISABLED', 'boolean', { defaultValue: 'false' }),

  // Workspace deployments
  g('deployments', 'DEPLOYMENT_RUN_POLL_INTERVAL_MS', 'duration', { defaultValue: '30000', ...restart }),
  g('deployments', 'DEPLOYMENT_RUN_POLL_BATCH', 'integer', { min: 1, defaultValue: '50' }),
  g('deployments', 'DEPLOYMENT_HISTORY_SYNC_INTERVAL_MS', 'duration', { defaultValue: '300000', ...restart }),
  g('deployments', 'DEPLOYMENT_REALTIME_RELAY_INTERVAL_MS', 'integer', { min: 0, defaultValue: '5000', ...restart }),

  // OpenCode catalogs and sync
  g('opencode', 'OPENCODE_PROVIDERS_MODELS_DEV_URL', 'url', { httpsOnly: true }),
  g('opencode', 'OPENCODE_MCP_REGISTRY_BASE_URL', 'url', { httpsOnly: true }),
  g('opencode', 'OPENCODE_PROVIDERS_REFRESH_INTERVAL_MS', 'duration', restart),
  g('opencode', 'OPENCODE_MCP_SERVERS_REFRESH_INTERVAL_MS', 'duration', restart),
  g('opencode', 'OPENCODE_CONFIG_SYNC_INTERVAL_MS', 'duration', { defaultValue: '30000', ...restart }),
  g('opencode', 'OPENCODE_CONFIG_SYNC_BATCH_SIZE', 'integer', { min: 1, defaultValue: '10' }),
  g('opencode', 'OPENCODE_LAYER_FILES_SYNC_INTERVAL_MS', 'duration', { defaultValue: '30000', ...restart }),
  g('opencode', 'OPENCODE_LAYER_FILES_SYNC_BATCH_SIZE', 'integer', { min: 1, defaultValue: '20' }),

  // Workspaces (status and proxy timeouts)
  g('workspaces', 'STATUS_POLL_INTERVAL_MS', 'integer', { min: 1000, defaultValue: '30000', ...restart }),
  g('workspaces', 'STATUS_PROVISIONING_POLL_INTERVAL_MS', 'integer', {
    min: 1000,
    max: 30000,
    defaultValue: '3000',
    ...restart,
  }),
  g('workspaces', 'STATUS_VCS_CONCURRENCY', 'integer', { min: 1 }),
  g('workspaces', 'REQUEST_TIMEOUT', 'integer', { min: 1000 }),
  g('workspaces', 'CLIENT_PING_TIMEOUT_MS', 'integer', { min: 100, defaultValue: '5000' }),
  g('workspaces', 'SOCKET_RECONNECTION_ATTEMPTS', 'integer', { min: 0, defaultValue: '5', ...restart }),

  // Server provisioning
  g('provisioning', 'HETZNER_API_TOKEN', 'secret'),
  g('provisioning', 'DIGITALOCEAN_API_TOKEN', 'secret'),

  // Background jobs
  g('background_jobs', 'EGRESS_EVENTS_INGEST_INTERVAL_MS', 'duration', { defaultValue: '30000', ...restart }),
  g('background_jobs', 'EGRESS_EVENTS_INGEST_BATCH_SIZE', 'integer', { min: 1, defaultValue: '10' }),
  g('background_jobs', 'ISOLATION_CAPABILITIES_INTERVAL_MS', 'duration', { defaultValue: '900000', ...restart }),
  g('background_jobs', 'ISOLATION_CAPABILITIES_BATCH_SIZE', 'integer', { min: 1, defaultValue: '25' }),
  g('background_jobs', 'SEARCH_REINDEX_INTERVAL', 'duration', { defaultValue: '15m', ...restart }),
  g('background_jobs', 'SEARCH_REINDEX_BATCH_SIZE', 'integer', { min: 1, defaultValue: '100' }),
  g('background_jobs', 'UPDATE_CHECK_CRON', 'cron', restart),
  g('background_jobs', 'UPDATE_CHECK_TIMEZONE', 'timezone', { defaultValue: 'Europe/Berlin', ...restart }),
  g('background_jobs', 'AGENT_GRAPH_SNAPSHOT_STARTUP_REBUILD', 'boolean', { defaultValue: 'true', ...restart }),
  g('background_jobs', 'AGENT_GRAPH_SNAPSHOT_STARTUP_DELAY_MS', 'integer', { min: 0, ...restart }),
];
