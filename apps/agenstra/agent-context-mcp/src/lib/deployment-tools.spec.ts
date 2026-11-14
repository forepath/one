import {
  AGENT_DEPLOYMENT_RUNS_MAX_LIMIT,
  DEPLOYMENT_LIMITS,
  type AgentDeploymentActionResponse,
  type DeploymentRunSummary,
} from '@forepath/agenstra/shared/util-opencode-config';

import { CONTENT_TOOL_DEFINITIONS } from './content-tools';
import { ContextApiClient, ContextApiError } from './context-api.client';
import { CONTEXT_TOOL_DEFINITIONS } from './context-tools';
import { callDeploymentTool, DEPLOYMENT_TOOL_DEFINITIONS, isDeploymentToolName } from './deployment-tools';
import { GRAPH_TOOL_DEFINITIONS } from './graph-tools';
import { HANDOFF_TOOL_DEFINITIONS } from './handoff-tools';
import { TASK_TOOL_DEFINITIONS } from './task-tools';

const RUN: DeploymentRunSummary = {
  id: 'run-1',
  clientId: 'client-1',
  workflowId: 'wf-1',
  workflowName: 'Deploy staging',
  agentId: 'agent-1',
  providerRunId: '42',
  name: 'deploy',
  status: 'queued',
  conclusion: null,
  ref: 'main',
  sha: null,
  url: 'https://github.com/acme/app/actions/runs/42',
  inputs: {},
  triggeredBy: 'agent',
  triggeredByUserId: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-11-08T09:00:00.000Z',
  updatedAt: '2026-11-08T09:00:00.000Z',
};
const APPLIED: AgentDeploymentActionResponse = {
  requestId: '',
  decision: 'applied',
  operation: 'deployment.trigger',
  run: RUN,
};
const TICKET = 'ctx-abc';

describe('deployment tools', () => {
  let client: jest.Mocked<
    Pick<
      ContextApiClient,
      | 'listDeploymentWorkflows'
      | 'listDeploymentRuns'
      | 'getDeploymentRun'
      | 'getDeploymentRunLogs'
      | 'triggerDeployment'
      | 'cancelDeploymentRun'
      | 'deploymentActionStatus'
      | 'listDeploymentConnections'
      | 'createDeploymentWorkflow'
      | 'updateDeploymentWorkflow'
      | 'deleteDeploymentWorkflow'
      | 'getDeploymentWorkflow'
      | 'syncDeploymentWorkflow'
    >
  >;

  beforeEach(() => {
    client = {
      listDeploymentWorkflows: jest.fn().mockResolvedValue({ workflows: [] }),
      getDeploymentWorkflow: jest.fn().mockResolvedValue({ id: 'wf-1', approvalStatus: 'approved' }),
      syncDeploymentWorkflow: jest.fn().mockResolvedValue({ synced: 4 }),
      listDeploymentRuns: jest.fn().mockResolvedValue({ runs: [RUN] }),
      getDeploymentRun: jest.fn().mockResolvedValue({ run: RUN, jobs: [] }),
      getDeploymentRunLogs: jest.fn().mockResolvedValue({ logs: 'ok', truncated: false }),
      triggerDeployment: jest.fn().mockResolvedValue(APPLIED),
      cancelDeploymentRun: jest.fn().mockResolvedValue({ ...APPLIED, operation: 'deployment.cancel' }),
      deploymentActionStatus: jest.fn().mockResolvedValue(APPLIED),
      listDeploymentConnections: jest.fn().mockResolvedValue({ connections: [] }),
      createDeploymentWorkflow: jest.fn().mockResolvedValue({ id: 'wf-2', approvalStatus: 'pending' }),
      updateDeploymentWorkflow: jest.fn().mockResolvedValue({ id: 'wf-2', approvalStatus: 'pending' }),
      deleteDeploymentWorkflow: jest.fn().mockResolvedValue(undefined),
    };
  });

  const call = (name: string, args: unknown) => callDeploymentTool(client as unknown as ContextApiClient, name, args);

  it('exposes the deployment tools without colliding with the other tool families', () => {
    expect(DEPLOYMENT_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'deployments_list_workflows',
      'deployments_get_workflow',
      'deployments_sync',
      'deployments_list_runs',
      'deployments_get_run',
      'deployments_get_run_logs',
      'deployments_trigger',
      'deployments_cancel_run',
      'deployments_action_status',
      'deployments_list_connections',
      'deployments_create_workflow',
      'deployments_update_workflow',
      'deployments_delete_workflow',
    ]);

    const otherNames = new Set(
      [
        ...CONTEXT_TOOL_DEFINITIONS,
        ...CONTENT_TOOL_DEFINITIONS,
        ...TASK_TOOL_DEFINITIONS,
        ...HANDOFF_TOOL_DEFINITIONS,
        ...GRAPH_TOOL_DEFINITIONS,
      ].map((tool) => tool.name),
    );

    for (const tool of DEPLOYMENT_TOOL_DEFINITIONS) {
      expect(otherNames.has(tool.name)).toBe(false);
      expect(isDeploymentToolName(tool.name)).toBe(true);
      expect(tool.inputSchema).toEqual(expect.objectContaining({ type: 'object', additionalProperties: false }));
    }

    expect(isDeploymentToolName('tasks_list')).toBe(false);
  });

  it('tells the agent it only sees its own workflows and may only trigger / cancel where allowed', () => {
    const byName = new Map(DEPLOYMENT_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.description]));

    expect(byName.get('deployments_list_workflows')).toMatch(/available to your environment/);
    expect(byName.get('deployments_trigger')).toMatch(/agentTriggerEnabled/);
    expect(byName.get('deployments_trigger')).toMatch(/deployments_action_status/);
    expect(byName.get('deployments_cancel_run')).toMatch(/agentTriggerEnabled/);
    expect(byName.get('deployments_create_workflow')).toMatch(/assigned to your environment only/);
    expect(byName.get('deployments_create_workflow')).toMatch(/approval by a workspace admin/);
    expect(byName.get('deployments_create_workflow')).toMatch(/agentTriggerEnabled" only if you need to run it/);
    expect(byName.get('deployments_update_workflow')).toMatch(/approval by a workspace admin again/);
  });

  it('requires the context ticket for run actions only', () => {
    const required = (name: string) =>
      DEPLOYMENT_TOOL_DEFINITIONS.find((tool) => tool.name === name)?.inputSchema.required ?? [];

    for (const name of ['deployments_trigger', 'deployments_cancel_run', 'deployments_action_status']) {
      expect(required(name)).toContain('ticket');
    }

    for (const name of [
      'deployments_list_workflows',
      'deployments_list_connections',
      'deployments_create_workflow',
      'deployments_update_workflow',
      'deployments_delete_workflow',
    ]) {
      expect(required(name)).not.toContain('ticket');
    }

    const schema = DEPLOYMENT_TOOL_DEFINITIONS.find((tool) => tool.name === 'deployments_trigger')?.inputSchema as {
      properties: Record<string, { description?: string }>;
    };

    expect(schema.properties['ticket'].description).toBe('Context ticket from the prompt hint (starts with "ctx-").');
  });

  it('never lets the agent choose scope or environments of its workflows', () => {
    for (const name of ['deployments_create_workflow', 'deployments_update_workflow']) {
      const schema = DEPLOYMENT_TOOL_DEFINITIONS.find((tool) => tool.name === name)?.inputSchema;

      expect(Object.keys(schema?.properties ?? {})).not.toEqual(expect.arrayContaining(['scope']));
      expect(Object.keys(schema?.properties ?? {})).not.toEqual(expect.arrayContaining(['agentIds']));
      expect(schema?.additionalProperties).toBe(false);
    }
  });

  it('bounds the input schemas with the shared limits', () => {
    const schemaOf = (name: string) =>
      DEPLOYMENT_TOOL_DEFINITIONS.find((tool) => tool.name === name)?.inputSchema as {
        properties: Record<string, Record<string, unknown>>;
      };

    expect(schemaOf('deployments_list_runs').properties['limit']).toEqual(
      expect.objectContaining({ minimum: 1, maximum: AGENT_DEPLOYMENT_RUNS_MAX_LIMIT }),
    );
    expect(schemaOf('deployments_trigger').properties['ref']['maxLength']).toBe(DEPLOYMENT_LIMITS.refMaxLength);
    expect(schemaOf('deployments_trigger').properties['inputs']).toEqual(
      expect.objectContaining({
        maxProperties: DEPLOYMENT_LIMITS.inputsMax,
        additionalProperties: { type: 'string', maxLength: DEPLOYMENT_LIMITS.inputValueMaxLength },
      }),
    );
  });

  it('lists workflows and runs as JSON', async () => {
    expect(JSON.parse((await call('deployments_list_workflows', {})).content[0].text)).toEqual({ workflows: [] });

    const runs = await call('deployments_list_runs', { workflowId: ' wf-1 ', limit: 5 });

    expect(runs.isError).toBeUndefined();
    expect(client.listDeploymentRuns).toHaveBeenCalledWith({ workflowId: 'wf-1', limit: 5 });

    await call('deployments_list_runs', {});

    expect(client.listDeploymentRuns).toHaveBeenLastCalledWith({});
  });

  it('rejects out-of-range run limits locally', async () => {
    for (const limit of [0, AGENT_DEPLOYMENT_RUNS_MAX_LIMIT + 1, 2.5, '10']) {
      expect((await call('deployments_list_runs', { limit })).isError).toBe(true);
    }

    expect(client.listDeploymentRuns).not.toHaveBeenCalled();
  });

  it('requires ids for run and trigger tools', async () => {
    for (const name of ['deployments_get_run', 'deployments_get_run_logs', 'deployments_cancel_run']) {
      expect((await call(name, { ticket: TICKET, workflowId: 'wf-1' })).isError).toBe(true);
    }

    expect((await call('deployments_trigger', { ticket: TICKET, runId: 'run-1' })).isError).toBe(true);
    expect(client.getDeploymentRun).not.toHaveBeenCalled();
    expect(client.getDeploymentRunLogs).not.toHaveBeenCalled();
    expect(client.cancelDeploymentRun).not.toHaveBeenCalled();
    expect(client.triggerDeployment).not.toHaveBeenCalled();
  });

  it('requires the context ticket for trigger, cancel and status', async () => {
    for (const [name, args] of [
      ['deployments_trigger', { workflowId: 'wf-1' }],
      ['deployments_cancel_run', { runId: 'run-1' }],
      ['deployments_action_status', { requestId: 'ctx_dep_1' }],
    ] as const) {
      const result = await call(name, args);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('ticket');
    }

    expect((await call('deployments_action_status', { ticket: TICKET })).isError).toBe(true);
    expect(client.triggerDeployment).not.toHaveBeenCalled();
    expect(client.cancelDeploymentRun).not.toHaveBeenCalled();
    expect(client.deploymentActionStatus).not.toHaveBeenCalled();
  });

  it('reads runs and logs (optionally of one job)', async () => {
    await call('deployments_get_run', { runId: 'run-1' });
    await call('deployments_get_run_logs', { runId: 'run-1' });
    await call('deployments_get_run_logs', { runId: 'run-1', jobId: ' 7 ' });

    expect(client.getDeploymentRun).toHaveBeenCalledWith('run-1');
    expect(client.getDeploymentRunLogs).toHaveBeenNthCalledWith(1, 'run-1', undefined);
    expect(client.getDeploymentRunLogs).toHaveBeenNthCalledWith(2, 'run-1', '7');
  });

  it('triggers with typed fields only and returns the decision', async () => {
    const result = await call('deployments_trigger', {
      ticket: ` ${TICKET} `,
      workflowId: 'wf-1',
      ref: ' main ',
      inputs: { env: 'staging', replicas: 2, dryRun: false },
      agentId: 'someone-else',
    });

    await call('deployments_trigger', { ticket: TICKET, workflowId: 'wf-1' });

    expect(JSON.parse(result.content[0].text)).toEqual(APPLIED);
    expect(client.triggerDeployment).toHaveBeenNthCalledWith(1, TICKET, 'wf-1', {
      ref: 'main',
      inputs: { env: 'staging', replicas: '2', dryRun: 'false' },
    });
    expect(client.triggerDeployment).toHaveBeenNthCalledWith(2, TICKET, 'wf-1', {});
  });

  it('passes pending decisions through so the agent can keep waiting', async () => {
    const pending: AgentDeploymentActionResponse = {
      requestId: 'ctx_dep_1',
      decision: 'pending',
      operation: 'deployment.trigger',
      message: 'Waiting for the user. Call deployments_action_status with this requestId to keep waiting.',
    };

    client.triggerDeployment.mockResolvedValue(pending);

    const result = await call('deployments_trigger', { ticket: TICKET, workflowId: 'wf-1' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(pending);

    await call('deployments_action_status', { ticket: TICKET, requestId: ' ctx_dep_1 ' });

    expect(client.deploymentActionStatus).toHaveBeenCalledWith(TICKET, 'ctx_dep_1');
  });

  it('rejects malformed or oversized trigger inputs locally', async () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: DEPLOYMENT_LIMITS.inputsMax + 1 }, (_, i) => [`k${i}`, 'v']),
    );

    for (const inputs of [
      ['a'],
      'env=staging',
      { nested: { a: 1 } },
      tooMany,
      { ['k'.repeat(DEPLOYMENT_LIMITS.inputKeyMaxLength + 1)]: 'v' },
      { env: 'v'.repeat(DEPLOYMENT_LIMITS.inputValueMaxLength + 1) },
    ]) {
      expect((await call('deployments_trigger', { ticket: TICKET, workflowId: 'wf-1', inputs })).isError).toBe(true);
    }

    expect(
      (
        await call('deployments_trigger', {
          ticket: TICKET,
          workflowId: 'wf-1',
          ref: 'r'.repeat(DEPLOYMENT_LIMITS.refMaxLength + 1),
        })
      ).isError,
    ).toBe(true);
    expect(client.triggerDeployment).not.toHaveBeenCalled();
  });

  it('cancels runs', async () => {
    expect(
      JSON.parse((await call('deployments_cancel_run', { ticket: TICKET, runId: 'run-1' })).content[0].text),
    ).toEqual({ ...APPLIED, operation: 'deployment.cancel' });
    expect(client.cancelDeploymentRun).toHaveBeenCalledWith(TICKET, 'run-1');
  });

  it('lists connections and manages own workflows', async () => {
    await call('deployments_list_connections', {});
    await call('deployments_create_workflow', {
      connectionId: ' conn-1 ',
      name: 'Deploy',
      repository: 'acme/app',
      workflow: 'deploy.yml',
      defaultRef: null,
      defaultInputs: { env: 'staging', replicas: 2 },
      agentTriggerEnabled: true,
    });
    await call('deployments_update_workflow', { workflowId: 'wf-2', enabled: false, description: 'Staging' });

    const deleted = await call('deployments_delete_workflow', { workflowId: 'wf-2' });

    expect(client.listDeploymentConnections).toHaveBeenCalled();
    expect(client.createDeploymentWorkflow).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      name: 'Deploy',
      repository: 'acme/app',
      workflow: 'deploy.yml',
      defaultRef: null,
      defaultInputs: { env: 'staging', replicas: '2' },
      agentTriggerEnabled: true,
    });
    expect(client.updateDeploymentWorkflow).toHaveBeenCalledWith('wf-2', { enabled: false, description: 'Staging' });
    expect(client.deleteDeploymentWorkflow).toHaveBeenCalledWith('wf-2');
    expect(deleted).toEqual({ content: [{ type: 'text', text: 'Deleted deployment workflow wf-2.' }] });
  });

  it('reads one workflow and syncs its history', async () => {
    const read = await call('deployments_get_workflow', { workflowId: ' wf-1 ' });
    const synced = await call('deployments_sync', { workflowId: 'wf-1' });

    expect(client.getDeploymentWorkflow).toHaveBeenCalledWith('wf-1');
    expect(client.syncDeploymentWorkflow).toHaveBeenCalledWith('wf-1');
    expect(read.isError).toBeFalsy();
    expect(synced.content[0].text).toContain('"synced": 4');
    expect((await call('deployments_get_workflow', {})).isError).toBe(true);
    expect((await call('deployments_sync', {})).isError).toBe(true);
  });

  it('validates workflow fields locally', async () => {
    expect((await call('deployments_create_workflow', { name: 'Deploy', repository: 'acme/app' })).isError).toBe(true);
    expect(
      (await call('deployments_create_workflow', { connectionId: 'c', name: 1, repository: 'acme/app' })).isError,
    ).toBe(true);
    expect(
      (await call('deployments_create_workflow', { connectionId: 'c', name: 'n', repository: 'r', enabled: 'yes' }))
        .isError,
    ).toBe(true);
    expect(
      (await call('deployments_create_workflow', { connectionId: 'c', name: 'n', repository: 'r', defaultInputs: [] }))
        .isError,
    ).toBe(true);
    expect((await call('deployments_update_workflow', { workflowId: 'wf-2' })).isError).toBe(true);
    expect((await call('deployments_update_workflow', { enabled: true })).isError).toBe(true);
    expect((await call('deployments_delete_workflow', {})).isError).toBe(true);

    expect(client.createDeploymentWorkflow).not.toHaveBeenCalled();
    expect(client.updateDeploymentWorkflow).not.toHaveBeenCalled();
    expect(client.deleteDeploymentWorkflow).not.toHaveBeenCalled();
  });

  it('turns API errors (e.g. a workflow of another environment) into tool errors', async () => {
    client.updateDeploymentWorkflow.mockRejectedValue(new ContextApiError('Deployment workflow not found', 404));

    const result = await call('deployments_update_workflow', { workflowId: 'wf-1', name: 'x' });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Deployment workflow not found' }],
      isError: true,
    });
  });

  it('reports unknown tools', async () => {
    expect((await call('deployments_delete', {})).isError).toBe(true);
  });
});
