import {
  AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES,
  AGENSTRA_DEPLOYMENTS_MCP_TOOL_PERMISSION,
  AGENT_DEPLOYMENT_CONTROLLER_OPS,
  AGENT_DEPLOYMENT_OPERATIONS,
  AGENT_DEPLOYMENT_RUNS_DEFAULT_LIMIT,
  AGENT_DEPLOYMENT_RUNS_MAX_LIMIT,
  DEPLOYMENT_LIMITS,
  DEPLOYMENT_PROVIDERS,
  defaultDeploymentProviderAuthType,
  deploymentProviderSupportsAuthType,
  isConnectionAuthType,
  isDeploymentProvider,
  isAgentDeploymentOperation,
  isDeploymentRunActive,
  normalizeAgentDeploymentOperations,
} from './deployment-platform';
import { AGENSTRA_AUTOMATION_SESSION_PERMISSION_RULESET } from './automation-platform';
import { AGENSTRA_CONTEXT_MCP_SERVER_KEY, isAgenstraContextToolPermission } from './context-platform';
import {
  AGENSTRA_PLAN_SESSION_PERMISSION_RULESET,
  isAgenstraPlanExplorePermission,
  isAgenstraPlanWritePermission,
} from './plan-platform';

describe('deployment-platform', () => {
  it('defaults GitHub to app auth and the token-only providers to token auth', () => {
    expect(DEPLOYMENT_PROVIDERS).toEqual(['github', 'gitlab', 'jenkins']);
    expect(defaultDeploymentProviderAuthType('github')).toBe('app');
    expect(defaultDeploymentProviderAuthType('gitlab')).toBe('token');
    expect(defaultDeploymentProviderAuthType('jenkins')).toBe('token');
    expect(deploymentProviderSupportsAuthType('github', 'token')).toBe(true);
    expect(deploymentProviderSupportsAuthType('gitlab', 'app')).toBe(false);
    expect(deploymentProviderSupportsAuthType('jenkins', 'app')).toBe(false);
  });

  it('recognizes providers and auth types only', () => {
    expect(isDeploymentProvider('gitlab')).toBe(true);
    expect(isDeploymentProvider('bitbucket')).toBe(false);
    expect(isDeploymentProvider(undefined)).toBe(false);
    expect(isConnectionAuthType('app')).toBe(true);
    expect(isConnectionAuthType('oauth')).toBe(false);
  });

  it('treats only completed runs as terminal', () => {
    expect(isDeploymentRunActive('queued')).toBe(true);
    expect(isDeploymentRunActive('in_progress')).toBe(true);
    expect(isDeploymentRunActive('completed')).toBe(false);
  });

  it('names one MCP tool per agent-facing controller op below the deployments permission wildcard', () => {
    const prefix = AGENSTRA_DEPLOYMENTS_MCP_TOOL_PERMISSION.replace(/\*$/, '');
    // `describeWorkflow` only feeds the manager's chat approval prompt; `actionStatus` is answered by the manager.
    const toolOps = Object.keys(AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES).filter((key) => key !== 'actionStatus');

    expect(toolOps.sort()).toEqual(AGENT_DEPLOYMENT_CONTROLLER_OPS.filter((op) => op !== 'describeWorkflow').sort());
    expect(Object.keys(AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES)).toContain('actionStatus');

    for (const tool of Object.values(AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES)) {
      const opencodeToolId = `${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_${tool}`;

      expect(opencodeToolId.startsWith(prefix)).toBe(true);
      // Not part of the read-only context family that plan / automation rulesets allow by name.
      expect(isAgenstraContextToolPermission(opencodeToolId)).toBe(false);
    }
  });

  it('names the new action and self-managed workflow tools', () => {
    expect(AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES).toMatchObject({
      actionStatus: 'deployments_action_status',
      listConnections: 'deployments_list_connections',
      createWorkflow: 'deployments_create_workflow',
      updateWorkflow: 'deployments_update_workflow',
      deleteWorkflow: 'deployments_delete_workflow',
    });
    expect(new Set(Object.values(AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES)).size).toBe(
      Object.values(AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES).length,
    );
  });

  it('normalizes deployment operation opt-ins (known, deduplicated, canonical order)', () => {
    expect(AGENT_DEPLOYMENT_OPERATIONS).toEqual(['deployment.trigger', 'deployment.cancel']);
    expect(isAgentDeploymentOperation('deployment.cancel')).toBe(true);
    expect(isAgentDeploymentOperation('deployment.delete')).toBe(false);
    expect(isAgentDeploymentOperation(42)).toBe(false);
    expect(normalizeAgentDeploymentOperations(undefined)).toEqual([]);
    expect(normalizeAgentDeploymentOperations([])).toEqual([]);
    expect(
      normalizeAgentDeploymentOperations([
        'deployment.cancel',
        'deployment.trigger',
        'deployment.cancel',
        'deployment.delete',
        null,
        { op: 'deployment.trigger' },
      ]),
    ).toEqual(['deployment.trigger', 'deployment.cancel']);
  });

  it('keeps every deployment tool (run actions and self-managed workflows) out of read-only plan sessions', () => {
    expect(AGENSTRA_PLAN_SESSION_PERMISSION_RULESET).not.toContainEqual(
      expect.objectContaining({ permission: AGENSTRA_DEPLOYMENTS_MCP_TOOL_PERMISSION }),
    );

    for (const tool of Object.values(AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES)) {
      const opencodeToolId = `${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_${tool}`;

      expect(isAgenstraPlanExplorePermission(opencodeToolId)).toBe(false);
      expect(isAgenstraPlanWritePermission(opencodeToolId)).toBe(true);
      expect(AGENSTRA_PLAN_SESSION_PERMISSION_RULESET).not.toContainEqual(
        expect.objectContaining({ permission: opencodeToolId, action: 'allow' }),
      );
    }

    // The only allow rules of plan sessions are explore tools and the read-only context / graph families.
    for (const rule of AGENSTRA_PLAN_SESSION_PERMISSION_RULESET.filter((entry) => entry.action === 'allow')) {
      expect(rule.permission.startsWith(`${AGENSTRA_CONTEXT_MCP_SERVER_KEY}_deployments`)).toBe(false);
    }
  });

  it('allows deployment tools in unattended automation sessions like every other platform tool', () => {
    expect(AGENSTRA_AUTOMATION_SESSION_PERMISSION_RULESET).toContainEqual({
      permission: '*',
      pattern: '*',
      action: 'allow',
    });
  });

  it('bounds the runs an environment lists', () => {
    expect(AGENT_DEPLOYMENT_RUNS_DEFAULT_LIMIT).toBeLessThanOrEqual(AGENT_DEPLOYMENT_RUNS_MAX_LIMIT);
    expect(DEPLOYMENT_LIMITS.agentLogsMaxBytes).toBeLessThan(DEPLOYMENT_LIMITS.logsMaxBytes);
  });
});
