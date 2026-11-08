import { ClientUserRole, REQUIRE_SCOPES_KEY } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import { ClientDeploymentsController } from './client-deployments.controller';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const WORKFLOW_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';

describe('ClientDeploymentsController', () => {
  let workflows: Record<string, jest.Mock>;
  let runs: Record<string, jest.Mock>;
  let clientsRepository: { findById: jest.Mock };
  let clientUsersRepository: { findUserClientAccess: jest.Mock };
  let controller: ClientDeploymentsController;

  const apiKey = { apiKeyAuthenticated: true } as never;
  const member = { apiKeyAuthenticated: false, user: { id: 'user-1', roles: ['user'] } } as never;

  beforeEach(() => {
    workflows = {
      listConnectionOptions: jest.fn().mockResolvedValue([]),
      listRepositories: jest.fn().mockResolvedValue([]),
      listBranches: jest.fn().mockResolvedValue([]),
      listProviderWorkflows: jest.fn().mockResolvedValue([]),
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({ id: WORKFLOW_ID }),
      create: jest.fn().mockResolvedValue({ id: WORKFLOW_ID }),
      update: jest.fn().mockResolvedValue({ id: WORKFLOW_ID }),
      remove: jest.fn().mockResolvedValue(undefined),
      approve: jest.fn().mockResolvedValue({ id: WORKFLOW_ID, approvalStatus: 'approved' }),
    };
    runs = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getDetail: jest.fn().mockResolvedValue({ run: { id: RUN_ID }, jobs: [] }),
      getLogs: jest.fn().mockResolvedValue({ logs: '', truncated: false }),
      trigger: jest.fn().mockResolvedValue({ id: RUN_ID }),
      cancel: jest.fn().mockResolvedValue({ id: RUN_ID }),
      sync: jest.fn().mockResolvedValue({ synced: 2 }),
    };
    clientsRepository = { findById: jest.fn().mockResolvedValue({ id: CLIENT_ID, userId: 'owner-1' }) };
    clientUsersRepository = {
      findUserClientAccess: jest
        .fn()
        .mockResolvedValue({ userId: 'user-1', clientId: CLIENT_ID, role: ClientUserRole.USER }),
    };
    controller = new ClientDeploymentsController(
      workflows as never,
      runs as never,
      clientsRepository as never,
      clientUsersRepository as never,
    );
  });

  it('declares deployments scopes per contract', () => {
    const scopes = (name: keyof ClientDeploymentsController) =>
      Reflect.getMetadata(REQUIRE_SCOPES_KEY, ClientDeploymentsController.prototype[name]);

    expect(scopes('listWorkflows')).toEqual(['deployments:read']);
    expect(scopes('getRun')).toEqual(['deployments:read']);
    expect(scopes('getRunLogs')).toEqual(['deployments:read']);
    expect(scopes('trigger')).toEqual(['deployments:write']);
    expect(scopes('cancelRun')).toEqual(['deployments:write']);
    expect(scopes('createWorkflow')).toEqual(['deployments:write']);
    expect(scopes('listConnections')).toEqual(['deployments:write']);
    expect(scopes('approveWorkflow')).toEqual(['deployments:write']);
  });

  it('lets workspace members read workflows and runs', async () => {
    await controller.listWorkflows(CLIENT_ID, undefined, 'deploy', 10, 0, 'pending', member);
    await controller.listRuns(CLIENT_ID, WORKFLOW_ID, undefined, 'completed', undefined, 5, 0, member);
    await controller.getRun(CLIENT_ID, RUN_ID, member);
    await controller.getRunLogs(CLIENT_ID, RUN_ID, '42', member);

    expect(workflows.list).toHaveBeenCalledWith(CLIENT_ID, {
      agentId: undefined,
      approvalStatus: 'pending',
      search: 'deploy',
      limit: 10,
      offset: 0,
    });
    expect(runs.list).toHaveBeenCalledWith(CLIENT_ID, {
      workflowId: WORKFLOW_ID,
      agentId: undefined,
      status: 'completed',
      search: undefined,
      limit: 5,
      offset: 0,
    });
    expect(runs.getLogs).toHaveBeenCalledWith(CLIENT_ID, RUN_ID, '42');
  });

  it('lets workspace members trigger, cancel and sync with the acting user', async () => {
    await controller.trigger(CLIENT_ID, WORKFLOW_ID, { ref: 'main' }, member);
    await controller.cancelRun(CLIENT_ID, RUN_ID, member);
    await expect(controller.sync(CLIENT_ID, WORKFLOW_ID, member)).resolves.toEqual({ synced: 2 });

    expect(runs.trigger).toHaveBeenCalledWith(CLIENT_ID, WORKFLOW_ID, { ref: 'main' }, 'user-1');
    expect(runs.cancel).toHaveBeenCalledWith(CLIENT_ID, RUN_ID, 'user-1');
  });

  it('requires workspace management for workflow changes and connection browsing', async () => {
    await expect(
      controller.createWorkflow(CLIENT_ID, { connectionId: CONNECTION_ID, name: 'x', repository: 'a/b' }, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.updateWorkflow(CLIENT_ID, WORKFLOW_ID, {}, member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.deleteWorkflow(CLIENT_ID, WORKFLOW_ID, member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.approveWorkflow(CLIENT_ID, WORKFLOW_ID, { updatedAt: '2026-01-01T00:00:00.000Z' }, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.listConnections(CLIENT_ID, member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.listRepositories(CLIENT_ID, CONNECTION_ID, undefined, member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.listBranches(CLIENT_ID, CONNECTION_ID, 'a/b', member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.listProviderWorkflows(CLIENT_ID, CONNECTION_ID, 'a/b', member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(workflows.create).not.toHaveBeenCalled();
    expect(workflows.remove).not.toHaveBeenCalled();
    expect(workflows.approve).not.toHaveBeenCalled();
    expect(workflows.listConnectionOptions).not.toHaveBeenCalled();
  });

  it('allows workspace admins and API keys to manage workflows', async () => {
    clientUsersRepository.findUserClientAccess.mockResolvedValue({
      userId: 'user-1',
      clientId: CLIENT_ID,
      role: ClientUserRole.ADMIN,
    });

    await controller.createWorkflow(CLIENT_ID, { connectionId: CONNECTION_ID, name: 'x', repository: 'a/b' }, member);
    await controller.deleteWorkflow(CLIENT_ID, WORKFLOW_ID, apiKey);
    await controller.listBranches(CLIENT_ID, CONNECTION_ID, 'a/b', apiKey);
    await expect(
      controller.approveWorkflow(CLIENT_ID, WORKFLOW_ID, { updatedAt: '2026-01-01T00:00:00.000Z' }, member),
    ).resolves.toEqual({ id: WORKFLOW_ID, approvalStatus: 'approved' });

    expect(workflows.create).toHaveBeenCalledWith(
      CLIENT_ID,
      { connectionId: CONNECTION_ID, name: 'x', repository: 'a/b' },
      'user-1',
    );
    expect(workflows.remove).toHaveBeenCalledWith(CLIENT_ID, WORKFLOW_ID, null);
    expect(workflows.listBranches).toHaveBeenCalledWith(CLIENT_ID, CONNECTION_ID, 'a/b');
    expect(workflows.approve).toHaveBeenCalledWith(CLIENT_ID, WORKFLOW_ID, '2026-01-01T00:00:00.000Z', 'user-1');
  });

  it('rejects users without workspace access', async () => {
    clientUsersRepository.findUserClientAccess.mockResolvedValue(null);

    await expect(
      controller.listRuns(CLIENT_ID, undefined, undefined, undefined, undefined, undefined, undefined, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.trigger(CLIENT_ID, WORKFLOW_ID, {}, member)).rejects.toBeInstanceOf(ForbiddenException);
    expect(runs.trigger).not.toHaveBeenCalled();
  });
});
