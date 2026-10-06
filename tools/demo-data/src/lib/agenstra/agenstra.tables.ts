import { DemoDeleteTarget } from '../core/seeder';

export const AGENSTRA_MANAGER_INSERT_ORDER = [
  'agents',
  'agent_chat_sessions',
  'agent_messages',
  'agent_environment_variables',
  'deployment_configurations',
  'deployment_runs',
  'regex_filter_rules',
] as const;

export const AGENSTRA_MANAGER_DELETE_TARGETS: readonly DemoDeleteTarget[] = [...AGENSTRA_MANAGER_INSERT_ORDER]
  .reverse()
  .map((table) => ({ table }));

export const AGENSTRA_MANAGER_REQUIRED_TABLES = ['agents', 'agent_chat_sessions', 'agent_messages'];

export const AGENSTRA_CONTROLLER_INSERT_ORDER = [
  'users',
  'user_personal_access_tokens',
  'clients',
  'client_users',
  'client_agent_credentials',
  'provisioning_references',
  'statistics_users',
  'statistics_clients',
  'statistics_agents',
  'statistics_client_users',
  'statistics_provisioning_references',
  'statistics_chat_io',
  'statistics_chat_filter_drops',
  'statistics_chat_filter_flags',
  'statistics_entity_events',
  'tickets',
  'ticket_comments',
  'ticket_activity',
  'ticket_body_generation_sessions',
  'client_agent_autonomy',
  'ticket_automation',
  'ticket_automation_run',
  'ticket_automation_run_step',
  'ticket_automation_lease',
  'knowledge_nodes',
  'knowledge_relations',
  'knowledge_page_activity',
  'atlassian_site_connections',
  'external_import_configs',
  'external_import_sync_markers',
  'agent_console_regex_filter_rules',
  'agent_console_regex_filter_rule_clients',
  'agent_console_regex_filter_rule_sync_targets',
  'client_opencode_config',
  'global_opencode_config',
  'user_environment_read_state',
  'user_chat_session_read_state',
  'webhook_endpoints',
  'webhook_deliveries',
  'email_deliveries',
] as const;

/** Tables without a demo `id` column: deleted through the column that references demo rows. */
const CONTROLLER_KEY_COLUMNS: Record<string, string> = {
  client_agent_autonomy: 'client_id',
  ticket_automation: 'ticket_id',
  ticket_automation_lease: 'ticket_id',
};
/**
 * Rows the running app may have created for demo entities (statistics mirrors, sync targets,
 * read markers). They do not cascade from demo rows and would collide with a re-seed.
 */
const CONTROLLER_APP_CREATED_TARGETS: readonly DemoDeleteTarget[] = [
  { table: 'statistics_entity_events', column: 'original_entity_id' },
  { table: 'statistics_chat_io', column: 'statistics_client_id' },
  { table: 'statistics_client_users', column: 'original_client_user_id' },
  { table: 'statistics_agents', column: 'original_agent_id' },
  { table: 'statistics_provisioning_references', column: 'original_provisioning_reference_id' },
  { table: 'statistics_clients', column: 'original_client_id' },
  { table: 'statistics_users', column: 'original_user_id' },
  { table: 'user_environment_read_state', column: 'client_id' },
  { table: 'user_chat_session_read_state', column: 'client_id' },
  { table: 'opencode_config_sync_targets', column: 'agent_id' },
  { table: 'opencode_layer_file_sync_targets', column: 'client_id' },
];

export const AGENSTRA_CONTROLLER_DELETE_TARGETS: readonly DemoDeleteTarget[] = [
  ...CONTROLLER_APP_CREATED_TARGETS,
  ...[...AGENSTRA_CONTROLLER_INSERT_ORDER]
    .reverse()
    .map((table) => ({ table, column: CONTROLLER_KEY_COLUMNS[table] ?? 'id' })),
];

export const AGENSTRA_CONTROLLER_REQUIRED_TABLES = [
  'users',
  'clients',
  'tickets',
  'knowledge_nodes',
  'ticket_automation_run',
  'statistics_chat_io',
  'opencode_config_sync_targets',
  'opencode_layer_file_sync_targets',
  'webhook_endpoints',
];
