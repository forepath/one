import type {
  AgentDeploymentControllerRequest,
  AgentDeploymentControllerResponse,
  DeploymentRunSummary,
  DeploymentWorkflowSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { NotFoundException } from '@nestjs/common';

import type { AgentContextTicketRecord } from '../types/agent-context.types';

import { AgentContextAccessService } from './agent-context-access.service';
import { AgentContextApiService, type AgentContextGatewayBridge } from './agent-context-api.service';
import { AgentContextTicketsService } from './agent-context-tickets.service';
import { AgentDeploymentActionsService } from './agent-deployment-actions.service';
import { AgentDeploymentsApiService } from './agent-deployments-api.service';

jest.mock('../constants/agent-context.constants', () => ({
  ...jest.requireActual('../constants/agent-context.constants'),
  AGENT_CONTEXT_ACCESS_WAIT_MS: 50,
}));

const AGENT_ID = 'agent-1';
const WORKFLOW_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_WORKFLOW_ID = '66666666-6666-4666-8666-666666666666';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '55555555-5555-4555-8555-555555555555';
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('AgentDeploymentActionsService', () => {
  let tickets: AgentContextTicketsService;
  let contextApi: AgentContextApiService;
  let deploymentsApi: AgentDeploymentsApiService;
  let service: AgentDeploymentActionsService;
  let bridge: jest.Mocked<AgentContextGatewayBridge>;
  let requestControllerDeployments: jest.Mock<
    Promise<AgentDeploymentControllerResponse>,
    [string, AgentDeploymentControllerRequest]
  >;
  let workflow: DeploymentWorkflowSummary;
  let run: DeploymentRunSummary;
  let actionResponse: AgentDeploymentControllerResponse;
  const mint = (overrides: Partial<Parameters<AgentContextTicketsService['mint']>[0]> = {}): AgentContextTicketRecord =>
    tickets.mint({
      agentId: AGENT_ID,
      sessionKey: 'chat-1',
      chatSessionId: 'chat-1',
      ephemeral: false,
      correlationId: 'corr',
      accessMode: 'ask',
      items: [],
      ...overrides,
    });
  const trigger = (input: { ref?: string; inputs?: Record<string, string> } = {}, workflowId = WORKFLOW_ID) =>
    ({ operation: 'deployment.trigger', workflowId, input }) as const;
  const cancel = { operation: 'deployment.cancel', runId: RUN_ID } as const;
  const actionCalls = () =>
    requestControllerDeployments.mock.calls
      .map(([, request]) => request)
      .filter((request) => request.op === 'trigger' || request.op === 'cancelRun');
  const questionId = () => bridge.publishContextDeploymentQuestion.mock.calls.at(-1)?.[1] as string;
  const prompt = () => bridge.publishContextDeploymentQuestion.mock.calls.at(-1)?.[2] as string;

  beforeEach(() => {
    workflow = {
      id: WORKFLOW_ID,
      clientId: 'client-1',
      connectionId: 'conn-1',
      provider: 'github',
      connectionLabel: 'GitHub Acme',
      name: 'Deploy staging',
      description: null,
      repository: 'acme/app',
      workflow: 'deploy.yml',
      defaultRef: 'main',
      defaultInputs: { env: 'staging' },
      scope: 'global',
      agentIds: [],
      agentTriggerEnabled: true,
      enabled: true,
      approvalStatus: 'approved',
      approvedAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user',
      updatedBy: 'user',
      createdByAgentId: null,
      lastRunStatus: null,
      lastRunConclusion: null,
      lastRunAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    run = {
      id: RUN_ID,
      clientId: 'client-1',
      workflowId: WORKFLOW_ID,
      workflowName: 'Deploy staging',
      agentId: null,
      providerRunId: '42',
      name: 'Deploy #42',
      status: 'in_progress',
      conclusion: null,
      ref: 'main',
      sha: null,
      url: null,
      inputs: {},
      triggeredBy: 'user',
      triggeredByUserId: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    actionResponse = { ok: true, run };
    tickets = new AgentContextTicketsService();
    contextApi = new AgentContextApiService(tickets, new AgentContextAccessService());
    bridge = {
      requestControllerContext: jest.fn(),
      publishContextAccessQuestion: jest.fn(),
      publishContextChangeQuestion: jest.fn(),
      publishContextDeploymentQuestion: jest.fn(),
      publishInteractionAnswered: jest.fn(),
    };
    contextApi.registerBridge(bridge);
    deploymentsApi = new AgentDeploymentsApiService();
    requestControllerDeployments = jest.fn<
      Promise<AgentDeploymentControllerResponse>,
      [string, AgentDeploymentControllerRequest]
    >(async (_agentId, request) => {
      switch (request.op) {
        case 'describeWorkflow':
          return request.workflowId === workflow.id
            ? { ok: true, workflow }
            : { ok: false, error: 'Deployment workflow not found', status: 404 };
        case 'getRun':
          return { ok: true, run, jobs: [] };
        default:
          return actionResponse;
      }
    });
    deploymentsApi.registerBridge({ requestControllerDeployments });
    service = new AgentDeploymentActionsService(tickets, contextApi, deploymentsApi);
  });

  it('recognizes its request ids (a ctx_ id, distinct from content changes)', () => {
    expect(AgentDeploymentActionsService.isDeploymentRequestId('ctx_dep_abc')).toBe(true);
    expect(AgentDeploymentActionsService.isDeploymentRequestId('ctx_chg_abc')).toBe(false);
    expect(AgentContextAccessService.isAccessRequestId('ctx_dep_abc')).toBe(true);
  });

  it('never acts in hidden helper (deny) sessions or plans', async () => {
    for (const record of [
      mint({ accessMode: 'deny', sessionKey: 'suffix:-ticket-body' }),
      mint({ accessMode: 'auto', sessionKey: 'suffix:-plan-1' }),
    ]) {
      await expect(service.requestAction(record, trigger())).resolves.toMatchObject({
        requestId: '',
        decision: 'denied',
        operation: 'deployment.trigger',
      });
      await expect(service.requestAction(record, cancel)).resolves.toMatchObject({ decision: 'denied' });
    }

    expect(requestControllerDeployments).not.toHaveBeenCalled();
    expect(bridge.publishContextDeploymentQuestion).not.toHaveBeenCalled();
  });

  it('asks the user in chats and triggers once approved', async () => {
    const record = mint();
    const pending = service.requestAction(record, trigger({ inputs: { env: 'production' } }));

    await flush();

    expect(bridge.publishContextDeploymentQuestion).toHaveBeenCalledWith(
      record,
      expect.stringMatching(/^ctx_dep_/),
      expect.any(String),
    );
    expect(prompt()).toContain('start the deployment workflow "Deploy staging"');
    expect(prompt()).toContain('Ref: main');
    expect(prompt()).toContain('Repository: acme/app (deploy.yml)');
    expect(prompt()).toContain('Connection: GitHub Acme (github)');
    expect(prompt()).toContain('- env = "production"');
    expect(actionCalls()).toHaveLength(0);

    await service.decide(AGENT_ID, questionId(), 'once');

    await expect(pending).resolves.toEqual({
      requestId: questionId(),
      decision: 'applied',
      operation: 'deployment.trigger',
      run,
    });
    // The source is the chat, never agent input.
    expect(actionCalls()).toEqual([
      {
        op: 'trigger',
        agentId: AGENT_ID,
        workflowId: WORKFLOW_ID,
        input: { inputs: { env: 'production' } },
        source: { kind: 'chat' },
      },
    ]);
    expect(bridge.publishInteractionAnswered).toHaveBeenCalledWith(AGENT_ID, [questionId()], expect.any(String));
  });

  it('describes cancellations with the run and its workflow', async () => {
    const record = mint();
    const pending = service.requestAction(record, cancel);

    await flush();

    expect(prompt()).toContain('cancel the deployment run "Deploy #42" (33333333) of the workflow "Deploy staging"');
    expect(prompt()).toContain('Status: in_progress');
    expect(prompt()).not.toContain('Inputs');

    await service.decide(AGENT_ID, questionId(), 'once');

    await expect(pending).resolves.toMatchObject({ decision: 'applied', operation: 'deployment.cancel' });
    expect(actionCalls()).toEqual([{ op: 'cancelRun', agentId: AGENT_ID, runId: RUN_ID, source: { kind: 'chat' } }]);
  });

  it('answers right away what the controller would refuse anyway', async () => {
    const record = mint();

    await expect(service.requestAction(record, trigger({ ref: 'feature/x' }))).resolves.toMatchObject({
      decision: 'denied',
      message: expect.stringContaining('default ref'),
    });
    await expect(service.requestAction(record, trigger({ inputs: { CI_DEBUG_TRACE: 'true' } }))).resolves.toMatchObject(
      { decision: 'denied', message: expect.stringContaining('CI_DEBUG_TRACE') },
    );
    await expect(service.requestAction(record, trigger({}, OTHER_WORKFLOW_ID))).resolves.toMatchObject({
      decision: 'failed',
      message: 'Deployment workflow not found',
    });

    workflow.agentTriggerEnabled = false;
    await expect(service.requestAction(record, trigger())).resolves.toMatchObject({ decision: 'denied' });

    workflow.agentTriggerEnabled = true;
    workflow.approvalStatus = 'pending';
    await expect(service.requestAction(record, trigger())).resolves.toMatchObject({
      decision: 'failed',
      message: expect.stringContaining('approval'),
    });

    workflow.approvalStatus = 'approved';
    run.status = 'completed';
    await expect(service.requestAction(record, cancel)).resolves.toMatchObject({ decision: 'failed' });

    expect(bridge.publishContextDeploymentQuestion).not.toHaveBeenCalled();
    expect(actionCalls()).toHaveLength(0);
    // Refused requests do not count against the per-turn bound.
    expect(record.deploymentActionCount).toBe(0);
  });

  it('does not act on rejected requests and ignores later replies', async () => {
    const record = mint();
    const pending = service.requestAction(record, trigger());

    await flush();
    await service.decide(AGENT_ID, questionId(), 'reject');
    await service.decide(AGENT_ID, questionId(), 'once');

    await expect(pending).resolves.toMatchObject({ decision: 'denied' });
    expect(actionCalls()).toHaveLength(0);
  });

  it('returns pending while nobody decided and applies a late approval', async () => {
    const record = mint();

    await expect(service.requestAction(record, trigger())).resolves.toMatchObject({
      decision: 'pending',
      requestId: expect.stringMatching(/^ctx_dep_/),
      message: expect.stringContaining('deployments_action_status'),
    });

    const requestId = questionId();

    await service.decide(AGENT_ID, requestId, 'once');

    await expect(service.actionStatus(record, requestId)).resolves.toMatchObject({ decision: 'applied', run });
    expect(actionCalls()).toHaveLength(1);
  });

  it('keeps pending requests private to their ticket and agent', async () => {
    const record = mint();

    await service.requestAction(record, trigger());

    const requestId = questionId();

    await expect(service.actionStatus(mint(), requestId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.decide('agent-2', requestId, 'once')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.actionStatus(record, 'ctx_dep_unknown')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('"allow for this chat" covers the same operation on the same workflow only', async () => {
    const record = mint();
    const first = service.requestAction(record, trigger());

    await flush();
    await service.decide(AGENT_ID, questionId(), 'always');
    await first;

    // Same chat, next turn: applied without asking.
    const nextTurn = mint();

    await expect(service.requestAction(nextTurn, trigger())).resolves.toMatchObject({ decision: 'applied' });
    expect(bridge.publishContextDeploymentQuestion).toHaveBeenCalledTimes(1);

    // Cancelling a run of the same workflow asks again.
    await expect(service.requestAction(nextTurn, cancel)).resolves.toMatchObject({ decision: 'pending' });
    expect(bridge.publishContextDeploymentQuestion).toHaveBeenCalledTimes(2);

    // Another chat asks again.
    await expect(service.requestAction(mint({ sessionKey: 'chat-2' }), trigger())).resolves.toMatchObject({
      decision: 'pending',
    });
  });

  it('forwards unattended task runs with their task and maps controller refusals', async () => {
    const record = mint({ accessMode: 'auto', sessionKey: `suffix:-task-${TASK_ID}`, chatSessionId: undefined });

    actionResponse = { ok: false, error: 'This task may not trigger deployments.', status: 403 };

    await expect(service.requestAction(record, trigger())).resolves.toEqual({
      requestId: '',
      decision: 'denied',
      operation: 'deployment.trigger',
      message: 'This task may not trigger deployments.',
    });
    expect(actionCalls()[0]).toMatchObject({ op: 'trigger', source: { kind: 'task', taskId: TASK_ID } });
    // Unattended runs neither ask nor describe: the controller decides.
    expect(bridge.publishContextDeploymentQuestion).not.toHaveBeenCalled();
    expect(requestControllerDeployments.mock.calls.some(([, request]) => request.op === 'describeWorkflow')).toBe(
      false,
    );

    actionResponse = { ok: false, error: 'The workflow waits for approval by a workspace admin', status: 409 };

    await expect(service.requestAction(record, trigger())).resolves.toMatchObject({ decision: 'failed' });

    actionResponse = { ok: false, error: 'No controller connection', status: 503 };

    await expect(service.requestAction(record, trigger())).resolves.toMatchObject({
      decision: 'failed',
      message: 'Deployments are unavailable right now.',
    });
  });

  it('forwards ticket automation runs as automation source', async () => {
    const record = mint({ accessMode: 'auto', sessionKey: 'suffix:-ticket-auto-loop', chatSessionId: undefined });

    await expect(service.requestAction(record, cancel)).resolves.toMatchObject({ decision: 'applied', run });
    expect(actionCalls()).toEqual([
      { op: 'cancelRun', agentId: AGENT_ID, runId: RUN_ID, source: { kind: 'automation' } },
    ]);
  });

  it('refuses automatic actions while other sessions of the agent work', async () => {
    const record = mint({ accessMode: 'auto', sessionKey: `suffix:-task-${TASK_ID}` });

    jest.spyOn(contextApi, 'isExclusiveAutoSession').mockReturnValue(false);

    await expect(service.requestAction(record, trigger())).resolves.toMatchObject({ decision: 'denied' });
    expect(actionCalls()).toHaveLength(0);
  });

  it('bounds the actions per ticket', async () => {
    const record = mint({ accessMode: 'auto', sessionKey: 'suffix:-ticket-auto-loop' });

    record.deploymentActionCount = 10;

    await expect(service.requestAction(record, trigger())).resolves.toMatchObject({
      decision: 'denied',
      message: expect.stringContaining('per turn'),
    });
    expect(actionCalls()).toHaveLength(0);
  });

  it('fails approvals whose turn has ended', async () => {
    const record = mint();

    await service.requestAction(record, trigger());

    const requestId = questionId();

    jest.spyOn(tickets, 'resolve').mockImplementation(() => {
      throw new NotFoundException('Unknown or expired context ticket');
    });

    await service.decide(AGENT_ID, requestId, 'once');

    expect(actionCalls()).toHaveLength(0);
    expect(bridge.publishInteractionAnswered).toHaveBeenCalledWith(AGENT_ID, [requestId], expect.any(String));
  });
});
