import { AGENT_DEPLOYMENT_REQUEST_EVENT } from '@forepath/agenstra/shared/util-opencode-config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Socket as ClientSocket } from 'socket.io-client';

import { AgentDeploymentRequestHandlerService } from './agent-deployment-request-handler.service';

describe('AgentDeploymentRequestHandlerService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const agentId = '00000000-0000-4000-8000-000000000020';
  const workflowId = '00000000-0000-4000-8000-000000000030';
  const runId = '00000000-0000-4000-8000-000000000040';
  const connectionId = '00000000-0000-4000-8000-000000000050';
  const taskId = '00000000-0000-4000-8000-000000000060';
  const chat = { kind: 'chat' };
  let workflows: Record<string, jest.Mock>;
  let runs: Record<string, jest.Mock>;
  let credentials: { findByClientAndAgent: jest.Mock };
  let handler: AgentDeploymentRequestHandlerService;

  beforeEach(() => {
    workflows = {
      listForAgent: jest.fn().mockResolvedValue([{ id: workflowId }]),
      getForAgent: jest.fn().mockResolvedValue({ id: workflowId, approvalStatus: 'approved' }),
      describeForAgent: jest.fn().mockResolvedValue({ id: workflowId, name: 'Deploy' }),
      listConnectionOptions: jest.fn().mockResolvedValue([{ id: connectionId, label: 'GitHub' }]),
      createForAgent: jest.fn().mockResolvedValue({ id: workflowId, approvalStatus: 'pending' }),
      updateForAgent: jest.fn().mockResolvedValue({ id: workflowId, approvalStatus: 'pending' }),
      deleteForAgent: jest.fn().mockResolvedValue(undefined),
    };
    runs = {
      listForAgent: jest.fn().mockResolvedValue([{ id: runId }]),
      getForAgent: jest.fn().mockResolvedValue({ run: { id: runId }, jobs: [{ id: 'console' }] }),
      getLogsForAgent: jest.fn().mockResolvedValue({ logs: 'tail', truncated: true }),
      triggerForAgent: jest.fn().mockResolvedValue({ id: runId }),
      cancelForAgent: jest.fn().mockResolvedValue({ id: runId }),
      syncForAgent: jest.fn().mockResolvedValue({ synced: 3 }),
    };
    credentials = { findByClientAndAgent: jest.fn().mockResolvedValue({ agentId }) };
    handler = new AgentDeploymentRequestHandlerService(workflows as never, runs as never, credentials as never);
  });

  it('scopes every operation to the connection workspace and the requesting agent', async () => {
    await expect(handler.handle(clientId, { op: 'listWorkflows', agentId, clientId: 'other' })).resolves.toEqual({
      ok: true,
      workflows: [{ id: workflowId }],
    });
    await expect(
      handler.handle(clientId, { op: 'listRuns', agentId: agentId.toUpperCase(), workflowId, limit: 5 }),
    ).resolves.toEqual({ ok: true, runs: [{ id: runId }] });
    await expect(handler.handle(clientId, { op: 'getRun', agentId, runId })).resolves.toEqual({
      ok: true,
      run: { id: runId },
      jobs: [{ id: 'console' }],
    });
    await expect(handler.handle(clientId, { op: 'getRunLogs', agentId, runId, jobId: 'console' })).resolves.toEqual({
      ok: true,
      logs: { logs: 'tail', truncated: true },
    });
    await expect(handler.handle(clientId, { op: 'cancelRun', agentId, runId, source: chat })).resolves.toEqual({
      ok: true,
      run: { id: runId },
      cancelled: true,
    });

    expect(workflows['listForAgent']).toHaveBeenCalledWith(clientId, agentId);
    expect(runs['listForAgent']).toHaveBeenCalledWith(clientId, agentId, { workflowId, limit: 5 });
    expect(runs['getLogsForAgent']).toHaveBeenCalledWith(clientId, agentId, runId, 'console');
    expect(runs['cancelForAgent']).toHaveBeenCalledWith(clientId, agentId, runId, { kind: 'chat' });
    expect(credentials.findByClientAndAgent).toHaveBeenCalledWith(clientId, agentId);
  });

  it('passes typed trigger input only', async () => {
    await handler.handle(clientId, {
      op: 'trigger',
      agentId,
      workflowId,
      input: { ref: 'main', inputs: { env: 'prod' }, agentId: 'other', workflow: 'x' },
      source: chat,
    });

    expect(runs['triggerForAgent']).toHaveBeenCalledWith(
      clientId,
      agentId,
      workflowId,
      { ref: 'main', inputs: { env: 'prod' } },
      { kind: 'chat' },
    );

    await handler.handle(clientId, { op: 'trigger', agentId, workflowId, input: { ref: '  ' }, source: chat });

    expect(runs['triggerForAgent']).toHaveBeenLastCalledWith(clientId, agentId, workflowId, {}, { kind: 'chat' });
  });

  it('passes the parsed action source (task id normalized, extra fields dropped)', async () => {
    await handler.handle(clientId, {
      op: 'trigger',
      agentId,
      workflowId,
      input: {},
      source: { kind: 'task', taskId: taskId.toUpperCase(), extra: 'x' },
    });
    await handler.handle(clientId, { op: 'cancelRun', agentId, runId, source: { kind: 'automation', ticketId: 'x' } });

    expect(runs['triggerForAgent']).toHaveBeenCalledWith(clientId, agentId, workflowId, {}, { kind: 'task', taskId });
    expect(runs['cancelForAgent']).toHaveBeenCalledWith(clientId, agentId, runId, { kind: 'automation' });
  });

  it('rejects run actions without a source (400) or with an unknown one (403)', async () => {
    await expect(handler.handle(clientId, { op: 'trigger', agentId, workflowId, input: {} })).resolves.toEqual({
      ok: false,
      error: 'source is required',
      status: 400,
    });
    await expect(handler.handle(clientId, { op: 'cancelRun', agentId, runId, source: null })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );

    for (const source of [{ kind: 'user' }, { kind: 'task' }, { kind: 'task', taskId: 'nope' }, 'chat', []]) {
      await expect(
        handler.handle(clientId, { op: 'trigger', agentId, workflowId, input: {}, source }),
      ).resolves.toEqual({ ok: false, error: 'Unknown deployment action source', status: 403 });
      await expect(handler.handle(clientId, { op: 'cancelRun', agentId, runId, source })).resolves.toEqual(
        expect.objectContaining({ ok: false, status: 403 }),
      );
    }

    expect(runs['triggerForAgent']).not.toHaveBeenCalled();
    expect(runs['cancelForAgent']).not.toHaveBeenCalled();
  });

  it('reads one workflow and syncs its history for the requesting agent', async () => {
    await expect(handler.handle(clientId, { op: 'getWorkflow', agentId, workflowId })).resolves.toEqual({
      ok: true,
      workflow: { id: workflowId, approvalStatus: 'approved' },
    });
    await expect(handler.handle(clientId, { op: 'syncWorkflow', agentId, workflowId })).resolves.toEqual({
      ok: true,
      synced: 3,
    });

    expect(workflows['getForAgent']).toHaveBeenCalledWith(clientId, agentId, workflowId);
    expect(runs['syncForAgent']).toHaveBeenCalledWith(clientId, agentId, workflowId);
    await expect(handler.handle(clientId, { op: 'syncWorkflow', agentId, workflowId: '../x' })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
  });

  it('describes workflows and lists usable connections', async () => {
    await expect(handler.handle(clientId, { op: 'describeWorkflow', agentId, workflowId })).resolves.toEqual({
      ok: true,
      workflow: { id: workflowId, name: 'Deploy' },
    });
    await expect(handler.handle(clientId, { op: 'listConnections', agentId })).resolves.toEqual({
      ok: true,
      connections: [{ id: connectionId, label: 'GitHub' }],
    });

    expect(workflows['describeForAgent']).toHaveBeenCalledWith(clientId, agentId, workflowId);
    expect(workflows['listConnectionOptions']).toHaveBeenCalledWith(clientId);
    await expect(handler.handle(clientId, { op: 'describeWorkflow', agentId, workflowId: 'x' })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
  });

  it('creates, updates and deletes the environment own workflows with typed input', async () => {
    await expect(
      handler.handle(clientId, {
        op: 'createWorkflow',
        agentId,
        input: {
          connectionId: connectionId.toUpperCase(),
          name: 'Preview',
          repository: 'acme/app',
          workflow: 'preview.yml',
          description: null,
          defaultInputs: { env: 'preview' },
          agentTriggerEnabled: true,
          clientId: 'other',
          createdByAgentId: 'other',
        },
      }),
    ).resolves.toEqual({ ok: true, workflow: { id: workflowId, approvalStatus: 'pending' } });
    expect(workflows['createForAgent']).toHaveBeenCalledWith(clientId, agentId, {
      connectionId,
      name: 'Preview',
      repository: 'acme/app',
      workflow: 'preview.yml',
      description: null,
      defaultInputs: { env: 'preview' },
      agentTriggerEnabled: true,
    });

    await handler.handle(clientId, { op: 'updateWorkflow', agentId, workflowId, input: { enabled: false } });
    expect(workflows['updateForAgent']).toHaveBeenCalledWith(clientId, agentId, workflowId, { enabled: false });

    await expect(handler.handle(clientId, { op: 'deleteWorkflow', agentId, workflowId })).resolves.toEqual({
      ok: true,
      deleted: true,
    });
    expect(workflows['deleteForAgent']).toHaveBeenCalledWith(clientId, agentId, workflowId);
  });

  it('rejects malformed workflow input and any assignment before calling services', async () => {
    const base = { connectionId, name: 'x', repository: 'a/b' };

    for (const input of [
      undefined,
      [],
      { name: 'x', repository: 'a/b' },
      { ...base, connectionId: 'nope' },
      { ...base, name: 7 },
      { connectionId, repository: 'a/b' },
      { ...base, workflow: 3 },
      { ...base, defaultInputs: { 'bad key': 'v' } },
      { ...base, agentTriggerEnabled: 'yes' },
      { ...base, scope: 'global' },
      { ...base, agentIds: [agentId] },
    ]) {
      await expect(handler.handle(clientId, { op: 'createWorkflow', agentId, input })).resolves.toEqual(
        expect.objectContaining({ ok: false, status: 400 }),
      );
    }

    await expect(
      handler.handle(clientId, { op: 'updateWorkflow', agentId, workflowId, input: { agentIds: [] } }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, status: 400 }));
    await expect(
      handler.handle(clientId, { op: 'updateWorkflow', agentId, workflowId: 'x', input: {} }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, status: 400 }));
    await expect(handler.handle(clientId, { op: 'deleteWorkflow', agentId })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );

    expect(workflows['createForAgent']).not.toHaveBeenCalled();
    expect(workflows['updateForAgent']).not.toHaveBeenCalled();
    expect(workflows['deleteForAgent']).not.toHaveBeenCalled();
  });

  it('rejects unsupported ops, invalid ids and malformed input before calling services', async () => {
    await expect(handler.handle(clientId, { op: 'approveWorkflow', agentId })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
    await expect(handler.handle(clientId, { op: 'listWorkflows', agentId: 'x' })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
    await expect(handler.handle(clientId, { op: 'getRun', agentId, runId: 'nope' })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
    await expect(handler.handle(clientId, { op: 'listRuns', agentId, limit: 0 })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
    await expect(handler.handle(clientId, { op: 'getRunLogs', agentId, runId, jobId: '../../etc' })).resolves.toEqual(
      expect.objectContaining({ ok: false, status: 400 }),
    );
    await expect(
      handler.handle(clientId, {
        op: 'trigger',
        agentId,
        workflowId,
        input: { inputs: { 'bad key': 'v' } },
        source: chat,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, status: 400 }));
    await expect(handler.handle(clientId, null)).resolves.toEqual(expect.objectContaining({ ok: false, status: 400 }));

    expect(runs['getForAgent']).not.toHaveBeenCalled();
    expect(runs['triggerForAgent']).not.toHaveBeenCalled();
  });

  it('rejects agents that are not part of the workspace', async () => {
    credentials.findByClientAndAgent.mockResolvedValue(null);

    await expect(handler.handle(clientId, { op: 'listWorkflows', agentId })).resolves.toEqual({
      ok: false,
      error: 'Agent not found in this workspace',
      status: 404,
    });
    expect(workflows['listForAgent']).not.toHaveBeenCalled();
  });

  it('maps HTTP exceptions to status responses and hides other errors', async () => {
    runs['triggerForAgent'].mockRejectedValue(
      new ForbiddenException('This workflow does not allow environments to trigger or cancel runs'),
    );
    runs['getForAgent'].mockRejectedValue(new NotFoundException('Deployment run not found'));
    runs['cancelForAgent'].mockRejectedValue(new Error('token=secret leaked'));

    await expect(
      handler.handle(clientId, { op: 'trigger', agentId, workflowId, input: {}, source: chat }),
    ).resolves.toEqual({
      ok: false,
      error: 'This workflow does not allow environments to trigger or cancel runs',
      status: 403,
    });
    await expect(handler.handle(clientId, { op: 'getRun', agentId, runId })).resolves.toEqual({
      ok: false,
      error: 'Deployment run not found',
      status: 404,
    });
    await expect(handler.handle(clientId, { op: 'cancelRun', agentId, runId, source: chat })).resolves.toEqual({
      ok: false,
      error: 'Deployment request failed',
      status: 500,
    });
  });

  it('answers acked requests on the manager socket', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const remote = { on: jest.fn((event: string, fn: (...args: unknown[]) => void) => listeners.set(event, fn)) };

    handler.attach(remote as unknown as ClientSocket, clientId);

    const ack = jest.fn();

    listeners.get(AGENT_DEPLOYMENT_REQUEST_EVENT)?.({ op: 'listWorkflows', agentId }, ack);
    await new Promise((resolve) => setImmediate(resolve));

    expect(ack).toHaveBeenCalledWith({ ok: true, workflows: [{ id: workflowId }] });
  });
});
