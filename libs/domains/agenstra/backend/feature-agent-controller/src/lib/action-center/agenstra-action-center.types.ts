/**
 * Agenstra action center item types. The agent console presents each type (texts, icon, deep link); keep both in sync
 * (`libs/domains/agenstra/frontend/feature-agent-console/src/lib/action-center`).
 */
export const AGENSTRA_ACTION_TYPES = {
  // setup / onboarding (highlighted)
  setupFirstWorkspace: 'agenstra.setup.first_workspace',
  // workspaces & environments
  isolationFailed: 'agenstra.workspaces.isolation_failed',
  configSyncFailed: 'agenstra.agents.config_sync_failed',
  graphFailed: 'agenstra.workspaces.graph_failed',
  // tickets & automation
  automationApproval: 'agenstra.tickets.automation_approval',
  automationAttention: 'agenstra.tickets.automation_attention',
  // agent tasks & handoffs
  tasksApproval: 'agenstra.tasks.approval_pending',
  tasksFailed: 'agenstra.tasks.run_failed',
  handoffsFailed: 'agenstra.handoffs.failed',
  // deployments & connections
  deploymentsApproval: 'agenstra.deployments.approval_pending',
  deploymentsFailed: 'agenstra.deployments.run_failed',
  connectionsFailed: 'agenstra.connections.test_failed',
  importsFailed: 'agenstra.imports.failed',
} as const;

export type AgenstraActionType = (typeof AGENSTRA_ACTION_TYPES)[keyof typeof AGENSTRA_ACTION_TYPES];
