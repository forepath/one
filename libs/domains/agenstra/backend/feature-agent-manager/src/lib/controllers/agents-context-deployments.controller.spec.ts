import {
  AGENSTRA_CONTEXT_API_ROUTE,
  AGENSTRA_DEPLOYMENTS_API_SEGMENT,
} from '@forepath/agenstra/shared/util-opencode-config';
import { IS_PUBLIC_KEY } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';

import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import { AgentDeploymentActionsService } from '../services/agent-deployment-actions.service';
import { AgentDeploymentsApiService } from '../services/agent-deployments-api.service';
import { AgentToolCallsService } from '../services/agent-tool-calls.service';

import { AgentsContextDeploymentsController } from './agents-context-deployments.controller';

describe('AgentsContextDeploymentsController', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const workflowId = '22222222-2222-4222-8222-222222222222';
  const runId = '33333333-3333-4333-8333-333333333333';
  const connectionId = '44444444-4444-4444-8444-444444444444';
  const auth = 'Bearer good-token';
  let contextMcp: { verifyAgentToken: jest.Mock };
  let deployments: {
    listWorkflows: jest.Mock;
    getWorkflow: jest.Mock;
    syncWorkflow: jest.Mock;
    listRuns: jest.Mock;
    getRun: jest.Mock;
    getRunLogs: jest.Mock;
    listConnections: jest.Mock;
    createWorkflow: jest.Mock;
    updateWorkflow: jest.Mock;
    deleteWorkflow: jest.Mock;
  };
  let tickets: AgentContextTicketsService;
  let actions: { requestAction: jest.Mock; actionStatus: jest.Mock };
  let toolCalls: { claim: jest.Mock };
  let controller: AgentsContextDeploymentsController;
  let record: ReturnType<AgentContextTicketsService['mint']>;
  const mint = (accessMode: 'ask' | 'auto' | 'deny', sessionKey = 'chat-1') =>
    tickets.mint({
      agentId,
      sessionKey,
      chatSessionId: 'chat-1',
      ephemeral: false,
      correlationId: 'corr',
      accessMode,
      items: [],
    });

  beforeEach(() => {
    contextMcp = {
      verifyAgentToken: jest.fn(async (id: string, token: string) => id === agentId && token === 'good-token'),
    };
    deployments = {
      listWorkflows: jest.fn().mockResolvedValue({ workflows: [] }),
      getWorkflow: jest.fn().mockResolvedValue({ id: workflowId }),
      syncWorkflow: jest.fn().mockResolvedValue({ synced: 1 }),
      listRuns: jest.fn().mockResolvedValue({ runs: [] }),
      getRun: jest.fn().mockResolvedValue({ run: { id: runId }, jobs: [] }),
      getRunLogs: jest.fn().mockResolvedValue({ logs: '', truncated: false }),
      listConnections: jest.fn().mockResolvedValue({ connections: [] }),
      createWorkflow: jest.fn().mockResolvedValue({ id: workflowId }),
      updateWorkflow: jest.fn().mockResolvedValue({ id: workflowId }),
      deleteWorkflow: jest.fn().mockResolvedValue(undefined),
    };
    tickets = new AgentContextTicketsService();
    record = mint('ask');
    actions = {
      requestAction: jest
        .fn()
        .mockResolvedValue({ requestId: '', decision: 'applied', operation: 'deployment.trigger' }),
      actionStatus: jest.fn().mockResolvedValue({ requestId: 'ctx_dep_1', decision: 'pending' }),
    };
    toolCalls = { claim: jest.fn().mockResolvedValue(true) };
    controller = new AgentsContextDeploymentsController(
      contextMcp as unknown as AgentContextMcpService,
      deployments as unknown as AgentDeploymentsApiService,
      tickets,
      actions as unknown as AgentDeploymentActionsService,
      toolCalls as unknown as AgentToolCallsService,
    );
  });

  it('is served below the agent context API and bypasses user authentication guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AgentsContextDeploymentsController)).toBe(
      `${AGENSTRA_CONTEXT_API_ROUTE}/${AGENSTRA_DEPLOYMENTS_API_SEGMENT}`,
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AgentsContextDeploymentsController)).toBe(true);
  });

  it('rejects invalid agent credentials before touching deployments', async () => {
    await expect(controller.listWorkflows(agentId, 'Bearer wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.trigger(workflowId, { ticket: record.ticket }, 'not-a-uuid', auth)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.cancelRun(runId, { ticket: record.ticket }, undefined, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.createWorkflow({}, agentId, 'Bearer wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.deleteWorkflow(workflowId, agentId, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(deployments.listWorkflows).not.toHaveBeenCalled();
    expect(deployments.createWorkflow).not.toHaveBeenCalled();
    expect(deployments.deleteWorkflow).not.toHaveBeenCalled();
    expect(actions.requestAction).not.toHaveBeenCalled();
  });

  it('delegates reads with the authenticated agent id and normalized ids', async () => {
    await controller.listWorkflows(agentId, auth);
    await controller.listRuns(undefined, undefined, agentId, auth);
    await controller.listRuns(workflowId.toUpperCase(), '10', agentId, auth);
    await controller.getRun(runId.toUpperCase(), agentId, auth);
    await controller.getRunLogs(runId, undefined, agentId, auth);
    await controller.getRunLogs(runId, ' 42 ', agentId, auth);
    await controller.listConnections(agentId, auth);
    await controller.getWorkflow(workflowId.toUpperCase(), agentId, auth);
    await controller.syncWorkflow(workflowId, agentId, auth);
    await expect(controller.getWorkflow('../x', agentId, auth)).rejects.toThrow();

    expect(deployments.listWorkflows).toHaveBeenCalledWith(agentId);
    expect(deployments.getWorkflow).toHaveBeenCalledWith(agentId, workflowId);
    expect(deployments.syncWorkflow).toHaveBeenCalledWith(agentId, workflowId);
    expect(deployments.listRuns).toHaveBeenNthCalledWith(1, agentId, {});
    expect(deployments.listRuns).toHaveBeenNthCalledWith(2, agentId, { workflowId, limit: 10 });
    expect(deployments.getRun).toHaveBeenCalledWith(agentId, runId);
    expect(deployments.getRunLogs).toHaveBeenNthCalledWith(1, agentId, runId, undefined);
    expect(deployments.getRunLogs).toHaveBeenNthCalledWith(2, agentId, runId, '42');
    expect(deployments.listConnections).toHaveBeenCalledWith(agentId);
  });

  it('routes trigger / cancel through the deployment actions service with the context ticket of the prompt', async () => {
    await controller.trigger(
      workflowId.toUpperCase(),
      { ticket: ` ${record.ticket} `, ref: ' main ', inputs: { env: 'staging' }, agentId: 'ignored' },
      agentId,
      auth,
    );
    await controller.cancelRun(runId, { ticket: record.ticket }, agentId, auth);

    expect(actions.requestAction.mock.calls).toEqual([
      [record, { operation: 'deployment.trigger', workflowId, input: { ref: 'main', inputs: { env: 'staging' } } }],
      [record, { operation: 'deployment.cancel', runId }],
    ]);
    // Visible chats do not need a matching tool call.
    expect(toolCalls.claim).not.toHaveBeenCalled();
  });

  it('requires the context ticket for run actions and rejects unknown tickets', async () => {
    await expect(controller.trigger(workflowId, {}, agentId, auth)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.cancelRun(runId, undefined, agentId, auth)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.trigger(workflowId, { ticket: 'ctx-unknown' }, agentId, auth)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.actionStatus('ctx_dep_1', undefined, agentId, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(actions.requestAction).not.toHaveBeenCalled();
    expect(actions.actionStatus).not.toHaveBeenCalled();
  });

  it('serves auto tickets only for a matching tool call of the prompt', async () => {
    const auto = mint('auto', 'suffix:-task-55555555-5555-4555-8555-555555555555');

    await controller.trigger(workflowId, { ticket: auto.ticket }, agentId, auth);

    expect(toolCalls.claim).toHaveBeenCalledWith(
      agentId,
      auto.ticket,
      'agenstra_deployments_trigger',
      expect.any(Function),
    );

    const matches = toolCalls.claim.mock.calls[0][3] as (input: Record<string, unknown>) => boolean;

    expect(matches({ ticket: auto.ticket, workflowId })).toBe(true);
    expect(matches({ ticket: auto.ticket, workflowId: '99999999-9999-4999-8999-999999999999' })).toBe(false);
    expect(matches({ ticket: 'ctx-other', workflowId })).toBe(false);

    toolCalls.claim.mockResolvedValue(false);

    await expect(controller.cancelRun(runId, { ticket: auto.ticket }, agentId, auth)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(actions.requestAction).toHaveBeenCalledTimes(1);
  });

  it('polls pending actions with the ticket of the request', async () => {
    await controller.actionStatus(' ctx_dep_1 ', record.ticket, agentId, auth);

    expect(actions.actionStatus).toHaveBeenCalledWith(record, 'ctx_dep_1');
    await expect(controller.actionStatus('../x', record.ticket, agentId, auth)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('forwards workflow proposals and refuses scope / environment fields', async () => {
    await expect(
      controller.createWorkflow(
        { connectionId, name: 'Deploy', repository: 'acme/app', scope: 'global', agentIds: [agentId] },
        agentId,
        auth,
      ),
    ).rejects.toThrow('scope and agentIds cannot be set');
    expect(deployments.createWorkflow).not.toHaveBeenCalled();

    await controller.createWorkflow(
      {
        connectionId: connectionId.toUpperCase(),
        name: ' Deploy ',
        repository: 'acme/app',
        workflow: 'deploy.yml',
        defaultRef: 'main',
        defaultInputs: { env: 'staging' },
        agentTriggerEnabled: true,
      },
      agentId,
      auth,
    );
    await controller.updateWorkflow(workflowId.toUpperCase(), { description: '', enabled: false }, agentId, auth);
    await controller.deleteWorkflow(workflowId, agentId, auth);

    expect(deployments.createWorkflow).toHaveBeenCalledWith(agentId, {
      connectionId,
      name: 'Deploy',
      repository: 'acme/app',
      workflow: 'deploy.yml',
      defaultRef: 'main',
      defaultInputs: { env: 'staging' },
      agentTriggerEnabled: true,
    });
    expect(deployments.updateWorkflow).toHaveBeenCalledWith(agentId, workflowId, {
      description: null,
      enabled: false,
    });
    expect(deployments.deleteWorkflow).toHaveBeenCalledWith(agentId, workflowId);
  });

  it('validates workflow proposals', async () => {
    const valid = { connectionId, name: 'Deploy', repository: 'acme/app' };

    for (const body of [
      undefined,
      [],
      { ...valid, connectionId: 'nope' },
      { ...valid, name: '' },
      { ...valid, name: 'n'.repeat(201) },
      { ...valid, repository: 'acme/app\nx' },
      { ...valid, defaultRef: 'r'.repeat(256) },
      { ...valid, defaultInputs: { k: 1 } },
      { ...valid, agentTriggerEnabled: 'yes' },
    ]) {
      await expect(controller.createWorkflow(body, agentId, auth)).rejects.toBeInstanceOf(BadRequestException);
    }

    await expect(controller.updateWorkflow(workflowId, {}, agentId, auth)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.updateWorkflow('x', { name: 'a' }, agentId, auth)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.deleteWorkflow('../x', agentId, auth)).rejects.toBeInstanceOf(NotFoundException);

    expect(deployments.createWorkflow).not.toHaveBeenCalled();
    expect(deployments.updateWorkflow).not.toHaveBeenCalled();
    expect(deployments.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('treats malformed ids as unknown workflows / runs', async () => {
    await expect(controller.trigger('../other', { ticket: record.ticket }, agentId, auth)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.getRun('run-1', agentId, auth)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.listRuns('nope', undefined, agentId, auth)).rejects.toBeInstanceOf(NotFoundException);

    expect(actions.requestAction).not.toHaveBeenCalled();
    expect(deployments.getRun).not.toHaveBeenCalled();
    expect(deployments.listRuns).not.toHaveBeenCalled();
  });

  it('validates query and trigger input bounds', async () => {
    const t = { ticket: record.ticket };

    await expect(controller.listRuns(undefined, '0', agentId, auth)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.listRuns(undefined, '101', agentId, auth)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getRunLogs(runId, '../../etc', agentId, auth)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.trigger(workflowId, { ...t, ref: 'r'.repeat(256) }, agentId, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.trigger(workflowId, { ...t, inputs: { n: 1 } }, agentId, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.trigger(workflowId, { ...t, inputs: ['x'] }, agentId, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.trigger(workflowId, 'body', agentId, auth)).rejects.toBeInstanceOf(BadRequestException);

    const tooMany = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`k${i}`, 'v']));

    await expect(controller.trigger(workflowId, { ...t, inputs: tooMany }, agentId, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.trigger(workflowId, { ...t, inputs: { k: 'v'.repeat(1001) } }, agentId, auth),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(deployments.listRuns).not.toHaveBeenCalled();
    expect(actions.requestAction).not.toHaveBeenCalled();
  });
});
