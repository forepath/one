import type { SettingsAdminLabels } from '@forepath/shared/frontend/feature-settings';

/** Localized labels of the backend settings catalog (Administration → Settings). */
export const CONTROLLER_SETTINGS_LABELS: SettingsAdminLabels = {
  categories: {
    email: {
      icon: 'envelope',
      section: $localize`:@@featureControllerSettings-section-communication:Communication`,
      label: $localize`:@@featureControllerSettings-category-email:Email`,
    },
    chat: {
      icon: 'chat-dots',
      section: $localize`:@@featureControllerSettings-section-agents:Agents`,
      label: $localize`:@@featureControllerSettings-category-chat:Chat and API`,
    },
    agent_tasks: {
      icon: 'calendar-check',
      section: $localize`:@@featureControllerSettings-section-agents:Agents`,
      label: $localize`:@@featureControllerSettings-category-agent_tasks:Agent tasks`,
    },
    agent_handoffs: {
      icon: 'arrow-left-right',
      section: $localize`:@@featureControllerSettings-section-agents:Agents`,
      label: $localize`:@@featureControllerSettings-category-agent_handoffs:Agent handoffs`,
    },
    tickets: {
      icon: 'kanban',
      section: $localize`:@@featureControllerSettings-section-work:Work`,
      label: $localize`:@@featureControllerSettings-category-tickets:Tickets`,
    },
    knowledge: {
      icon: 'book',
      section: $localize`:@@featureControllerSettings-section-work:Work`,
      label: $localize`:@@featureControllerSettings-category-knowledge:Knowledge`,
    },
    context_import: {
      icon: 'cloud-download',
      section: $localize`:@@featureControllerSettings-section-work:Work`,
      label: $localize`:@@featureControllerSettings-category-context_import:Context import`,
    },
    deployments: {
      icon: 'rocket-takeoff',
      section: $localize`:@@featureControllerSettings-section-work:Work`,
      label: $localize`:@@featureControllerSettings-category-deployments:Deployments`,
    },
    opencode: {
      icon: 'cpu',
      section: $localize`:@@featureControllerSettings-section-runtime:Runtime`,
      label: $localize`:@@featureControllerSettings-category-opencode:Agent configuration`,
    },
    workspaces: {
      icon: 'hdd-network',
      section: $localize`:@@featureControllerSettings-section-runtime:Runtime`,
      label: $localize`:@@featureControllerSettings-category-workspaces:Workspaces`,
    },
    provisioning: {
      icon: 'server',
      section: $localize`:@@featureControllerSettings-section-runtime:Runtime`,
      label: $localize`:@@featureControllerSettings-category-provisioning:Provisioning`,
    },
    background_jobs: {
      icon: 'clock-history',
      section: $localize`:@@featureControllerSettings-section-runtime:Runtime`,
      label: $localize`:@@featureControllerSettings-category-background_jobs:Background jobs`,
    },
  },
  settings: {
    SMTP_HOST: {
      title: $localize`:@@featureControllerSettings-title-SMTP_HOST:SMTP host`,
      description: $localize`:@@featureControllerSettings-description-SMTP_HOST:Mail server for outgoing email. Empty disables sending.`,
    },
    SMTP_PORT: {
      title: $localize`:@@featureControllerSettings-title-SMTP_PORT:SMTP port`,
      description: $localize`:@@featureControllerSettings-description-SMTP_PORT:Port 465 uses implicit TLS, other ports STARTTLS when available.`,
    },
    SMTP_USER: {
      title: $localize`:@@featureControllerSettings-title-SMTP_USER:SMTP user`,
      description: $localize`:@@featureControllerSettings-description-SMTP_USER:User name for SMTP authentication.`,
    },
    SMTP_PASSWORD: {
      title: $localize`:@@featureControllerSettings-title-SMTP_PASSWORD:SMTP password`,
      description: $localize`:@@featureControllerSettings-description-SMTP_PASSWORD:Password for SMTP authentication.`,
    },
    EMAIL_FROM: {
      title: $localize`:@@featureControllerSettings-title-EMAIL_FROM:Sender address`,
      description: $localize`:@@featureControllerSettings-description-EMAIL_FROM:Envelope From of outgoing email.`,
    },
    EMAIL_COMPANY_NAME: {
      title: $localize`:@@featureControllerSettings-title-EMAIL_COMPANY_NAME:Brand name`,
      description: $localize`:@@featureControllerSettings-description-EMAIL_COMPANY_NAME:Company name in the email header and footer.`,
    },
    EMAIL_COMPANY_ADDRESS_LINE1: {
      title: $localize`:@@featureControllerSettings-title-EMAIL_COMPANY_ADDRESS_LINE1:Footer address`,
      description: $localize`:@@featureControllerSettings-description-EMAIL_COMPANY_ADDRESS_LINE1:Street and number in the email footer.`,
    },
    EMAIL_COMPANY_POSTAL_CODE: {
      title: $localize`:@@featureControllerSettings-title-EMAIL_COMPANY_POSTAL_CODE:Footer postal code`,
      description: $localize`:@@featureControllerSettings-description-EMAIL_COMPANY_POSTAL_CODE:Postal code in the email footer.`,
    },
    EMAIL_COMPANY_CITY: {
      title: $localize`:@@featureControllerSettings-title-EMAIL_COMPANY_CITY:Footer city`,
      description: $localize`:@@featureControllerSettings-description-EMAIL_COMPANY_CITY:City in the email footer.`,
    },
    EMAIL_COMPANY_COUNTRY: {
      title: $localize`:@@featureControllerSettings-title-EMAIL_COMPANY_COUNTRY:Footer country`,
      description: $localize`:@@featureControllerSettings-description-EMAIL_COMPANY_COUNTRY:ISO country code (e.g. DE) in the email footer.`,
    },
    EMAIL_COMPANY_VAT_ID: {
      title: $localize`:@@featureControllerSettings-title-EMAIL_COMPANY_VAT_ID:Footer VAT ID`,
      description: $localize`:@@featureControllerSettings-description-EMAIL_COMPANY_VAT_ID:VAT ID in the email footer.`,
    },
    EMAIL_COMPANY_EMAIL: {
      title: $localize`:@@featureControllerSettings-title-EMAIL_COMPANY_EMAIL:Footer contact email`,
      description: $localize`:@@featureControllerSettings-description-EMAIL_COMPANY_EMAIL:Contact address in the email footer.`,
    },
    OPENAI_COMPATIBLE_API_ENABLED: {
      title: $localize`:@@featureControllerSettings-title-OPENAI_COMPATIBLE_API_ENABLED:OpenAI-compatible API`,
      description: $localize`:@@featureControllerSettings-description-OPENAI_COMPATIBLE_API_ENABLED:Serves the OpenAI-compatible API of environments.`,
    },
    REMOTE_AGENT_CHAT_TIMEOUT_MS: {
      title: $localize`:@@featureControllerSettings-title-REMOTE_AGENT_CHAT_TIMEOUT_MS:Chat answer timeout (ms)`,
      description: $localize`:@@featureControllerSettings-description-REMOTE_AGENT_CHAT_TIMEOUT_MS:Maximum wait for an agent answer on server-side chat turns.`,
    },
    OPENAI_CLIENT_TOOL_RESULT_TIMEOUT_MS: {
      title: $localize`:@@featureControllerSettings-title-OPENAI_CLIENT_TOOL_RESULT_TIMEOUT_MS:Client tool timeout (ms)`,
      description: $localize`:@@featureControllerSettings-description-OPENAI_CLIENT_TOOL_RESULT_TIMEOUT_MS:How long the agent waits for the result of a client tool call.`,
    },
    REMOTE_AGENT_COMMIT_MESSAGE_TIMEOUT_MS: {
      title: $localize`:@@featureControllerSettings-title-REMOTE_AGENT_COMMIT_MESSAGE_TIMEOUT_MS:Commit message timeout (ms)`,
      description: $localize`:@@featureControllerSettings-description-REMOTE_AGENT_COMMIT_MESSAGE_TIMEOUT_MS:Maximum wait for a generated commit message.`,
    },
    AGENSTRA_ATTACHMENT_MAX_BYTES: {
      title: $localize`:@@featureControllerSettings-title-AGENSTRA_ATTACHMENT_MAX_BYTES:Attachment size limit (bytes)`,
      description: $localize`:@@featureControllerSettings-description-AGENSTRA_ATTACHMENT_MAX_BYTES:Largest file accepted as a ticket or chat attachment.`,
    },
    AGENT_TASK_SCHEDULER_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-AGENT_TASK_SCHEDULER_INTERVAL_MS:Scheduler interval`,
      description: $localize`:@@featureControllerSettings-description-AGENT_TASK_SCHEDULER_INTERVAL_MS:How often due task occurrences are claimed.`,
    },
    AGENT_TASK_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureControllerSettings-title-AGENT_TASK_SCHEDULER_BATCH_SIZE:Scheduler batch size`,
      description: $localize`:@@featureControllerSettings-description-AGENT_TASK_SCHEDULER_BATCH_SIZE:Due tasks claimed per scheduler run.`,
    },
    AGENT_TASK_RUN_TIMEOUT_MS: {
      title: $localize`:@@featureControllerSettings-title-AGENT_TASK_RUN_TIMEOUT_MS:Run timeout (ms)`,
      description: $localize`:@@featureControllerSettings-description-AGENT_TASK_RUN_TIMEOUT_MS:Maximum wait for the agent answer per run.`,
    },
    AGENT_TASK_MIN_INTERVAL_MINUTES: {
      title: $localize`:@@featureControllerSettings-title-AGENT_TASK_MIN_INTERVAL_MINUTES:Minimum interval (minutes)`,
      description: $localize`:@@featureControllerSettings-description-AGENT_TASK_MIN_INTERVAL_MINUTES:Minimum distance between two occurrences of one task.`,
    },
    AGENT_TASKS_MAX_PER_AGENT: {
      title: $localize`:@@featureControllerSettings-title-AGENT_TASKS_MAX_PER_AGENT:Tasks per environment`,
      description: $localize`:@@featureControllerSettings-description-AGENT_TASKS_MAX_PER_AGENT:Maximum number of tasks per environment.`,
    },
    AGENT_TASK_HANDOFF_WAIT_TIMEOUT_MS: {
      title: $localize`:@@featureControllerSettings-title-AGENT_TASK_HANDOFF_WAIT_TIMEOUT_MS:Handoff wait timeout (ms)`,
      description: $localize`:@@featureControllerSettings-description-AGENT_TASK_HANDOFF_WAIT_TIMEOUT_MS:How long a run waits for a handoff response.`,
    },
    AGENT_TASK_RUN_MAX_HANDOFFS: {
      title: $localize`:@@featureControllerSettings-title-AGENT_TASK_RUN_MAX_HANDOFFS:Handoffs per run`,
      description: $localize`:@@featureControllerSettings-description-AGENT_TASK_RUN_MAX_HANDOFFS:Handoffs one run may make in total.`,
    },
    AGENT_HANDOFF_SCHEDULER_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-AGENT_HANDOFF_SCHEDULER_INTERVAL_MS:Scheduler interval`,
      description: $localize`:@@featureControllerSettings-description-AGENT_HANDOFF_SCHEDULER_INTERVAL_MS:How often stalled handoffs are failed and deliveries re-queued.`,
    },
    AGENT_HANDOFF_TURN_TIMEOUT_MS: {
      title: $localize`:@@featureControllerSettings-title-AGENT_HANDOFF_TURN_TIMEOUT_MS:Turn timeout (ms)`,
      description: $localize`:@@featureControllerSettings-description-AGENT_HANDOFF_TURN_TIMEOUT_MS:Maximum wait for one turn of the target agent.`,
    },
    AGENT_HANDOFFS_MAX_ACTIVE_PER_WORKSPACE: {
      title: $localize`:@@featureControllerSettings-title-AGENT_HANDOFFS_MAX_ACTIVE_PER_WORKSPACE:Open handoffs per workspace`,
      description: $localize`:@@featureControllerSettings-description-AGENT_HANDOFFS_MAX_ACTIVE_PER_WORKSPACE:Unanswered handoffs allowed per workspace.`,
    },
    AGENT_HANDOFF_MAX_DEPTH: {
      title: $localize`:@@featureControllerSettings-title-AGENT_HANDOFF_MAX_DEPTH:Handoff depth`,
      description: $localize`:@@featureControllerSettings-description-AGENT_HANDOFF_MAX_DEPTH:How often a handed-over task may be handed over again.`,
    },
    AUTONOMOUS_TICKET_SCHEDULER_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-AUTONOMOUS_TICKET_SCHEDULER_INTERVAL_MS:Automation interval`,
      description: $localize`:@@featureControllerSettings-description-AUTONOMOUS_TICKET_SCHEDULER_INTERVAL_MS:How often autonomous ticket runs are started.`,
    },
    AUTONOMOUS_TICKET_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureControllerSettings-title-AUTONOMOUS_TICKET_SCHEDULER_BATCH_SIZE:Automation batch size`,
      description: $localize`:@@featureControllerSettings-description-AUTONOMOUS_TICKET_SCHEDULER_BATCH_SIZE:Tickets started per automation run.`,
    },
    TICKET_BODY_SESSION_TTL_MS: {
      title: $localize`:@@featureControllerSettings-title-TICKET_BODY_SESSION_TTL_MS:Body generation session lifetime (ms)`,
      description: $localize`:@@featureControllerSettings-description-TICKET_BODY_SESSION_TTL_MS:How long a ticket body generation session stays open.`,
    },
    AUTO_ENRICH_ENABLED_GLOBAL: {
      title: $localize`:@@featureControllerSettings-title-AUTO_ENRICH_ENABLED_GLOBAL:Auto-enrichment`,
      description: $localize`:@@featureControllerSettings-description-AUTO_ENRICH_ENABLED_GLOBAL:Adds matching knowledge to prompts automatically.`,
    },
    AUTO_ENRICH_MAX_SECTIONS: {
      title: $localize`:@@featureControllerSettings-title-AUTO_ENRICH_MAX_SECTIONS:Enrichment sections`,
      description: $localize`:@@featureControllerSettings-description-AUTO_ENRICH_MAX_SECTIONS:Maximum knowledge sections added to one prompt.`,
    },
    AUTO_ENRICH_MAX_CHARS: {
      title: $localize`:@@featureControllerSettings-title-AUTO_ENRICH_MAX_CHARS:Enrichment size (characters)`,
      description: $localize`:@@featureControllerSettings-description-AUTO_ENRICH_MAX_CHARS:Maximum characters of added knowledge per prompt.`,
    },
    AUTO_ENRICH_VECTOR_ENABLED: {
      title: $localize`:@@featureControllerSettings-title-AUTO_ENRICH_VECTOR_ENABLED:Vector search`,
      description: $localize`:@@featureControllerSettings-description-AUTO_ENRICH_VECTOR_ENABLED:Uses semantic search to find matching knowledge.`,
    },
    AUTO_ENRICH_VECTOR_TOP_K: {
      title: $localize`:@@featureControllerSettings-title-AUTO_ENRICH_VECTOR_TOP_K:Vector candidates`,
      description: $localize`:@@featureControllerSettings-description-AUTO_ENRICH_VECTOR_TOP_K:Candidates read from the vector search.`,
    },
    AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE: {
      title: $localize`:@@featureControllerSettings-title-AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE:Maximum cosine distance`,
      description: $localize`:@@featureControllerSettings-description-AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE:Vector matches further away (0 to 2) are ignored.`,
    },
    KNOWLEDGE_EMBEDDINGS_REINDEX_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-KNOWLEDGE_EMBEDDINGS_REINDEX_INTERVAL_MS:Embedding reindex interval`,
      description: $localize`:@@featureControllerSettings-description-KNOWLEDGE_EMBEDDINGS_REINDEX_INTERVAL_MS:How often knowledge embeddings are rebuilt.`,
    },
    KNOWLEDGE_EMBEDDINGS_PAGE_BATCH_SIZE: {
      title: $localize`:@@featureControllerSettings-title-KNOWLEDGE_EMBEDDINGS_PAGE_BATCH_SIZE:Embedding batch size`,
      description: $localize`:@@featureControllerSettings-description-KNOWLEDGE_EMBEDDINGS_PAGE_BATCH_SIZE:Pages embedded per batch.`,
    },
    CONTEXT_IMPORT_SCHEDULER_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-CONTEXT_IMPORT_SCHEDULER_INTERVAL_MS:Import interval`,
      description: $localize`:@@featureControllerSettings-description-CONTEXT_IMPORT_SCHEDULER_INTERVAL_MS:How often enabled import configurations run (0 disables).`,
    },
    CONTEXT_IMPORT_SCHEDULER_CONFIG_BATCH: {
      title: $localize`:@@featureControllerSettings-title-CONTEXT_IMPORT_SCHEDULER_CONFIG_BATCH:Configurations per run`,
      description: $localize`:@@featureControllerSettings-description-CONTEXT_IMPORT_SCHEDULER_CONFIG_BATCH:Import configurations processed per scheduler run.`,
    },
    CONTEXT_IMPORT_ITEM_BUDGET: {
      title: $localize`:@@featureControllerSettings-title-CONTEXT_IMPORT_ITEM_BUDGET:Items per run`,
      description: $localize`:@@featureControllerSettings-description-CONTEXT_IMPORT_ITEM_BUDGET:Soft limit of imported items per configuration and run.`,
    },
    ATLASSIAN_IMPORT_DISABLED: {
      title: $localize`:@@featureControllerSettings-title-ATLASSIAN_IMPORT_DISABLED:Pause Atlassian import`,
      description: $localize`:@@featureControllerSettings-description-ATLASSIAN_IMPORT_DISABLED:Skips Atlassian import runs; connections stay manageable.`,
    },
    DEPLOYMENT_RUN_POLL_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-DEPLOYMENT_RUN_POLL_INTERVAL_MS:Run refresh interval`,
      description: $localize`:@@featureControllerSettings-description-DEPLOYMENT_RUN_POLL_INTERVAL_MS:How often active runs are refreshed from the provider (0 disables).`,
    },
    DEPLOYMENT_RUN_POLL_BATCH: {
      title: $localize`:@@featureControllerSettings-title-DEPLOYMENT_RUN_POLL_BATCH:Runs per refresh`,
      description: $localize`:@@featureControllerSettings-description-DEPLOYMENT_RUN_POLL_BATCH:Active runs refreshed per poll.`,
    },
    DEPLOYMENT_HISTORY_SYNC_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-DEPLOYMENT_HISTORY_SYNC_INTERVAL_MS:History import interval`,
      description: $localize`:@@featureControllerSettings-description-DEPLOYMENT_HISTORY_SYNC_INTERVAL_MS:How often runs started on the provider are imported (0 disables).`,
    },
    DEPLOYMENT_REALTIME_RELAY_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-DEPLOYMENT_REALTIME_RELAY_INTERVAL_MS:Live update interval (ms)`,
      description: $localize`:@@featureControllerSettings-description-DEPLOYMENT_REALTIME_RELAY_INTERVAL_MS:How often run changes are pushed to the console (0 disables).`,
    },
    OPENCODE_PROVIDERS_MODELS_DEV_URL: {
      title: $localize`:@@featureControllerSettings-title-OPENCODE_PROVIDERS_MODELS_DEV_URL:Model catalog URL`,
      description: $localize`:@@featureControllerSettings-description-OPENCODE_PROVIDERS_MODELS_DEV_URL:HTTPS source of the provider and model catalog.`,
    },
    OPENCODE_MCP_REGISTRY_BASE_URL: {
      title: $localize`:@@featureControllerSettings-title-OPENCODE_MCP_REGISTRY_BASE_URL:MCP registry URL`,
      description: $localize`:@@featureControllerSettings-description-OPENCODE_MCP_REGISTRY_BASE_URL:HTTPS base URL of the MCP server registry.`,
    },
    OPENCODE_PROVIDERS_REFRESH_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-OPENCODE_PROVIDERS_REFRESH_INTERVAL_MS:Model catalog refresh`,
      description: $localize`:@@featureControllerSettings-description-OPENCODE_PROVIDERS_REFRESH_INTERVAL_MS:How often the model catalog is refreshed.`,
    },
    OPENCODE_MCP_SERVERS_REFRESH_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-OPENCODE_MCP_SERVERS_REFRESH_INTERVAL_MS:MCP registry refresh`,
      description: $localize`:@@featureControllerSettings-description-OPENCODE_MCP_SERVERS_REFRESH_INTERVAL_MS:How often the MCP server registry is refreshed.`,
    },
    OPENCODE_CONFIG_SYNC_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-OPENCODE_CONFIG_SYNC_INTERVAL_MS:Configuration sync interval`,
      description: $localize`:@@featureControllerSettings-description-OPENCODE_CONFIG_SYNC_INTERVAL_MS:How often agent configurations are synced to workspaces.`,
    },
    OPENCODE_CONFIG_SYNC_BATCH_SIZE: {
      title: $localize`:@@featureControllerSettings-title-OPENCODE_CONFIG_SYNC_BATCH_SIZE:Configuration sync batch size`,
      description: $localize`:@@featureControllerSettings-description-OPENCODE_CONFIG_SYNC_BATCH_SIZE:Workspaces synced per run.`,
    },
    OPENCODE_LAYER_FILES_SYNC_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-OPENCODE_LAYER_FILES_SYNC_INTERVAL_MS:Layer file sync interval`,
      description: $localize`:@@featureControllerSettings-description-OPENCODE_LAYER_FILES_SYNC_INTERVAL_MS:How often layer files are synced to workspaces.`,
    },
    OPENCODE_LAYER_FILES_SYNC_BATCH_SIZE: {
      title: $localize`:@@featureControllerSettings-title-OPENCODE_LAYER_FILES_SYNC_BATCH_SIZE:Layer file sync batch size`,
      description: $localize`:@@featureControllerSettings-description-OPENCODE_LAYER_FILES_SYNC_BATCH_SIZE:Workspaces synced per run.`,
    },
    STATUS_POLL_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-STATUS_POLL_INTERVAL_MS:Status poll interval (ms)`,
      description: $localize`:@@featureControllerSettings-description-STATUS_POLL_INTERVAL_MS:How often workspace status is pushed to the console.`,
    },
    STATUS_PROVISIONING_POLL_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-STATUS_PROVISIONING_POLL_INTERVAL_MS:Provisioning poll interval (ms)`,
      description: $localize`:@@featureControllerSettings-description-STATUS_PROVISIONING_POLL_INTERVAL_MS:Fast status interval while environments are created or updated.`,
    },
    STATUS_VCS_CONCURRENCY: {
      title: $localize`:@@featureControllerSettings-title-STATUS_VCS_CONCURRENCY:Parallel Git status requests`,
      description: $localize`:@@featureControllerSettings-description-STATUS_VCS_CONCURRENCY:Git status requests per status refresh.`,
    },
    REQUEST_TIMEOUT: {
      title: $localize`:@@featureControllerSettings-title-REQUEST_TIMEOUT:Workspace request timeout (ms)`,
      description: $localize`:@@featureControllerSettings-description-REQUEST_TIMEOUT:Timeout of proxied requests to agent managers.`,
    },
    CLIENT_PING_TIMEOUT_MS: {
      title: $localize`:@@featureControllerSettings-title-CLIENT_PING_TIMEOUT_MS:Workspace ping timeout (ms)`,
      description: $localize`:@@featureControllerSettings-description-CLIENT_PING_TIMEOUT_MS:Timeout of workspace reachability checks.`,
    },
    SOCKET_RECONNECTION_ATTEMPTS: {
      title: $localize`:@@featureControllerSettings-title-SOCKET_RECONNECTION_ATTEMPTS:Socket reconnection attempts`,
      description: $localize`:@@featureControllerSettings-description-SOCKET_RECONNECTION_ATTEMPTS:Reconnection attempts of manager sockets.`,
    },
    HETZNER_API_TOKEN: {
      title: $localize`:@@featureControllerSettings-title-HETZNER_API_TOKEN:Hetzner API token`,
      description: $localize`:@@featureControllerSettings-description-HETZNER_API_TOKEN:Default Hetzner Cloud token for server provisioning.`,
    },
    DIGITALOCEAN_API_TOKEN: {
      title: $localize`:@@featureControllerSettings-title-DIGITALOCEAN_API_TOKEN:DigitalOcean API token`,
      description: $localize`:@@featureControllerSettings-description-DIGITALOCEAN_API_TOKEN:Default DigitalOcean token for server provisioning.`,
    },
    EGRESS_EVENTS_INGEST_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-EGRESS_EVENTS_INGEST_INTERVAL_MS:Egress event ingest interval`,
      description: $localize`:@@featureControllerSettings-description-EGRESS_EVENTS_INGEST_INTERVAL_MS:How often egress guard events are pulled (0 disables).`,
    },
    EGRESS_EVENTS_INGEST_BATCH_SIZE: {
      title: $localize`:@@featureControllerSettings-title-EGRESS_EVENTS_INGEST_BATCH_SIZE:Egress event batch size`,
      description: $localize`:@@featureControllerSettings-description-EGRESS_EVENTS_INGEST_BATCH_SIZE:Workspaces polled per run.`,
    },
    ISOLATION_CAPABILITIES_INTERVAL_MS: {
      title: $localize`:@@featureControllerSettings-title-ISOLATION_CAPABILITIES_INTERVAL_MS:Isolation check interval`,
      description: $localize`:@@featureControllerSettings-description-ISOLATION_CAPABILITIES_INTERVAL_MS:How often isolation capabilities of hosts are refreshed.`,
    },
    ISOLATION_CAPABILITIES_BATCH_SIZE: {
      title: $localize`:@@featureControllerSettings-title-ISOLATION_CAPABILITIES_BATCH_SIZE:Isolation check batch size`,
      description: $localize`:@@featureControllerSettings-description-ISOLATION_CAPABILITIES_BATCH_SIZE:Workspaces refreshed per run.`,
    },
    SEARCH_REINDEX_INTERVAL: {
      title: $localize`:@@featureControllerSettings-title-SEARCH_REINDEX_INTERVAL:Search reindex interval`,
      description: $localize`:@@featureControllerSettings-description-SEARCH_REINDEX_INTERVAL:Interval of the periodic search index rebuild (e.g. 15m).`,
    },
    SEARCH_REINDEX_BATCH_SIZE: {
      title: $localize`:@@featureControllerSettings-title-SEARCH_REINDEX_BATCH_SIZE:Search reindex batch size`,
      description: $localize`:@@featureControllerSettings-description-SEARCH_REINDEX_BATCH_SIZE:Documents indexed per batch.`,
    },
    UPDATE_CHECK_CRON: {
      title: $localize`:@@featureControllerSettings-title-UPDATE_CHECK_CRON:Update check schedule`,
      description: $localize`:@@featureControllerSettings-description-UPDATE_CHECK_CRON:Cron expression of the release check.`,
    },
    UPDATE_CHECK_TIMEZONE: {
      title: $localize`:@@featureControllerSettings-title-UPDATE_CHECK_TIMEZONE:Update check time zone`,
      description: $localize`:@@featureControllerSettings-description-UPDATE_CHECK_TIMEZONE:Time zone of the update check schedule.`,
    },
    AGENT_GRAPH_SNAPSHOT_STARTUP_REBUILD: {
      title: $localize`:@@featureControllerSettings-title-AGENT_GRAPH_SNAPSHOT_STARTUP_REBUILD:Rebuild graph on startup`,
      description: $localize`:@@featureControllerSettings-description-AGENT_GRAPH_SNAPSHOT_STARTUP_REBUILD:Rebuilds the workspace graph snapshot after startup.`,
    },
    AGENT_GRAPH_SNAPSHOT_STARTUP_DELAY_MS: {
      title: $localize`:@@featureControllerSettings-title-AGENT_GRAPH_SNAPSHOT_STARTUP_DELAY_MS:Graph rebuild delay (ms)`,
      description: $localize`:@@featureControllerSettings-description-AGENT_GRAPH_SNAPSHOT_STARTUP_DELAY_MS:Delay before the startup rebuild.`,
    },
  },
};
