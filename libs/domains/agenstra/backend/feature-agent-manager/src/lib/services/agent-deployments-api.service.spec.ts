import { HttpException, ServiceUnavailableException } from '@nestjs/common';

import { AgentDeploymentsApiService } from './agent-deployments-api.service';

describe('AgentDeploymentsApiService', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const workflowId = '22222222-2222-4222-8222-222222222222';
  const runId = '33333333-3333-4333-8333-333333333333';
  const connectionId = '44444444-4444-4444-8444-444444444444';
  const run = { id: runId, workflowId, status: 'queued' };
  const workflow = { id: workflowId, name: 'Deploy', approvalStatus: 'pending' };
  const workflowInput = { connectionId, name: 'Deploy', repository: 'acme/app', workflow: 'deploy.yml' };
  let service: AgentDeploymentsApiService;
  let requestControllerDeployments: jest.Mock;

  beforeEach(() => {
    service = new AgentDeploymentsApiService();
    requestControllerDeployments = jest.fn().mockResolvedValue({
      ok: true,
      workflows: [{ id: workflowId }],
      runs: [run],
      run,
      jobs: [{ id: '7' }],
      logs: { logs: 'done', truncated: false },
      workflow,
      connections: [{ id: connectionId, label: 'GitHub', provider: 'github', lastTestStatus: 'ok' }],
      deleted: true,
      synced: 2,
    });
    service.registerBridge({ requestControllerDeployments });
  });

  it('is unavailable without a gateway bridge', async () => {
    const unbridged = new AgentDeploymentsApiService();

    await expect(unbridged.listWorkflows(agentId)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      unbridged.requestController({ op: 'cancelRun', agentId, runId, source: { kind: 'chat' } }),
    ).resolves.toEqual({ ok: false, error: 'Deployments are unavailable', status: 503 });
  });

  it('binds every request to the authenticated agent', async () => {
    await service.listWorkflows(agentId);
    await service.listRuns(agentId);
    await service.listRuns(agentId, { workflowId, limit: 5 });
    await service.getRun(agentId, runId);
    await service.getRunLogs(agentId, runId);
    await service.getRunLogs(agentId, runId, '7');
    await service.describeWorkflow(agentId, workflowId);
    await service.getWorkflow(agentId, workflowId);
    await service.syncWorkflow(agentId, workflowId);
    await service.listConnections(agentId);
    await service.createWorkflow(agentId, workflowInput);
    await service.updateWorkflow(agentId, workflowId, { enabled: false });
    await service.deleteWorkflow(agentId, workflowId);

    expect(requestControllerDeployments.mock.calls.map(([id, request]) => [id, request])).toEqual([
      [agentId, { op: 'listWorkflows', agentId }],
      [agentId, { op: 'listRuns', agentId }],
      [agentId, { op: 'listRuns', agentId, workflowId, limit: 5 }],
      [agentId, { op: 'getRun', agentId, runId }],
      [agentId, { op: 'getRunLogs', agentId, runId }],
      [agentId, { op: 'getRunLogs', agentId, runId, jobId: '7' }],
      [agentId, { op: 'describeWorkflow', agentId, workflowId }],
      [agentId, { op: 'getWorkflow', agentId, workflowId }],
      [agentId, { op: 'syncWorkflow', agentId, workflowId }],
      [agentId, { op: 'listConnections', agentId }],
      [agentId, { op: 'createWorkflow', agentId, input: workflowInput }],
      [agentId, { op: 'updateWorkflow', agentId, workflowId, input: { enabled: false } }],
      [agentId, { op: 'deleteWorkflow', agentId, workflowId }],
    ]);
  });

  it('shapes the controller responses', async () => {
    await expect(service.listWorkflows(agentId)).resolves.toEqual({ workflows: [{ id: workflowId }] });
    await expect(service.listRuns(agentId)).resolves.toEqual({ runs: [run] });
    await expect(service.getRun(agentId, runId)).resolves.toEqual({ run, jobs: [{ id: '7' }] });
    await expect(service.getRunLogs(agentId, runId)).resolves.toEqual({ logs: 'done', truncated: false });
    await expect(service.describeWorkflow(agentId, workflowId)).resolves.toEqual(workflow);
    await expect(service.getWorkflow(agentId, workflowId)).resolves.toEqual(workflow);
    await expect(service.syncWorkflow(agentId, workflowId)).resolves.toEqual({ synced: 2 });
    await expect(service.createWorkflow(agentId, workflowInput)).resolves.toEqual(workflow);
    await expect(service.listConnections(agentId)).resolves.toEqual({
      connections: [{ id: connectionId, label: 'GitHub', provider: 'github', lastTestStatus: 'ok' }],
    });
    await expect(service.deleteWorkflow(agentId, workflowId)).resolves.toBeUndefined();

    requestControllerDeployments.mockResolvedValue({ ok: true });

    await expect(service.listWorkflows(agentId)).resolves.toEqual({ workflows: [] });
    await expect(service.listRuns(agentId)).resolves.toEqual({ runs: [] });
    await expect(service.listConnections(agentId)).resolves.toEqual({ connections: [] });
  });

  it('maps controller errors to HTTP errors with their status', async () => {
    requestControllerDeployments.mockResolvedValue({
      ok: false,
      error: 'Deployment workflow not found',
      status: 404,
    });

    await expect(service.updateWorkflow(agentId, workflowId, { name: 'x' })).rejects.toMatchObject({
      message: 'Deployment workflow not found',
      status: 404,
    });

    requestControllerDeployments.mockResolvedValue({ ok: false, error: 'boom', status: 200 });

    await expect(service.listWorkflows(agentId)).rejects.toMatchObject({ status: 502 });

    requestControllerDeployments.mockResolvedValue({ ok: false, error: '' });

    await expect(service.deleteWorkflow(agentId, workflowId)).rejects.toMatchObject({
      message: 'Deployment request failed',
      status: 502,
    });
  });

  it('rejects malformed success responses', async () => {
    requestControllerDeployments.mockResolvedValue({ ok: true });

    await expect(service.getRun(agentId, runId)).rejects.toBeInstanceOf(HttpException);
    await expect(service.getRunLogs(agentId, runId)).rejects.toMatchObject({ status: 502 });
    await expect(service.describeWorkflow(agentId, workflowId)).rejects.toMatchObject({ status: 502 });
    await expect(service.createWorkflow(agentId, workflowInput)).rejects.toMatchObject({ status: 502 });
    await expect(service.updateWorkflow(agentId, workflowId, { enabled: true })).rejects.toMatchObject({
      status: 502,
    });
    await expect(service.deleteWorkflow(agentId, workflowId)).rejects.toMatchObject({ status: 502 });
  });

  it('returns raw controller answers for run actions and never throws', async () => {
    const source = { kind: 'task' as const, taskId: '55555555-5555-4555-8555-555555555555' };

    requestControllerDeployments.mockResolvedValueOnce({ ok: false, error: 'Not allowed', status: 403 });

    await expect(service.requestController({ op: 'trigger', agentId, workflowId, input: {}, source })).resolves.toEqual(
      { ok: false, error: 'Not allowed', status: 403 },
    );
    expect(requestControllerDeployments).toHaveBeenLastCalledWith(agentId, {
      op: 'trigger',
      agentId,
      workflowId,
      input: {},
      source,
    });

    requestControllerDeployments.mockRejectedValueOnce(new Error('socket closed'));

    await expect(
      service.requestController({ op: 'cancelRun', agentId, runId, source: { kind: 'chat' } }),
    ).resolves.toEqual({ ok: false, error: 'socket closed', status: 502 });
  });
});
