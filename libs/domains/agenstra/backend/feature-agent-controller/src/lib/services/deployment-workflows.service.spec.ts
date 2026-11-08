import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { DeploymentConnectionEntity } from '../entities/deployment-connection.entity';
import type { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';
import { StatisticsEntityType } from '../entities/statistics-entity-event.entity';

import {
  DEPLOYMENT_AGENT_WORKFLOWS_MAX,
  DEPLOYMENT_WORKFLOW_PENDING_MESSAGE,
  DeploymentWorkflowsService,
} from './deployment-workflows.service';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const WORKFLOW_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_AGENT_ID = '66666666-6666-4666-8666-666666666666';

function connection(overrides: Partial<DeploymentConnectionEntity> = {}): DeploymentConnectionEntity {
  return {
    id: CONNECTION_ID,
    label: 'GitHub',
    provider: 'github',
    authType: 'token',
    workspaceAccess: 'all',
    allowedClientIds: [],
    ...overrides,
  } as DeploymentConnectionEntity;
}

function workflow(overrides: Partial<DeploymentWorkflowEntity> = {}): DeploymentWorkflowEntity {
  return {
    id: WORKFLOW_ID,
    clientId: CLIENT_ID,
    connectionId: CONNECTION_ID,
    connection: connection(),
    name: 'Deploy',
    description: null,
    repository: 'acme/app',
    workflow: 'deploy.yml',
    defaultRef: 'main',
    defaultInputs: { env: 'prod' },
    scope: 'global',
    agentIds: [],
    agentTriggerEnabled: false,
    enabled: true,
    lastRunStatus: null,
    lastRunConclusion: null,
    lastRunAt: null,
    approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    approvedByUserId: 'user-1',
    createdByType: 'user',
    updatedByType: 'user',
    createdByAgentId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as DeploymentWorkflowEntity;
}

function queryBuilder(result: unknown[] = [], one: unknown = null) {
  const qb: Record<string, jest.Mock> = {};

  for (const method of [
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'addSelect',
    'skip',
    'take',
    'limit',
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }

  qb['getMany'] = jest.fn().mockResolvedValue(result);
  qb['getOne'] = jest.fn().mockResolvedValue(one);

  return qb;
}

describe('DeploymentWorkflowsService', () => {
  let workflowRepo: Record<string, jest.Mock>;
  let runRepo: Record<string, jest.Mock>;
  let connections: Record<string, jest.Mock>;
  let credentials: { findByClientAndAgent: jest.Mock };
  let realtime: Record<string, jest.Mock>;
  let statistics: Record<string, jest.Mock>;
  let searchIndex: Record<string, jest.Mock>;
  let publisher: Record<string, jest.Mock>;
  let service: DeploymentWorkflowsService;
  let stored: DeploymentWorkflowEntity;

  beforeEach(() => {
    stored = workflow();
    workflowRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder([stored])),
      findOne: jest.fn().mockImplementation(async () => stored),
      find: jest.fn().mockResolvedValue([stored]),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => {
        stored = workflow({ ...value, id: WORKFLOW_ID, connection: connection() });

        return stored;
      }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(0),
    };
    // Transactions run on the same repository double (row lock = `findOne` with `lock`).
    (workflowRepo as Record<string, unknown>)['manager'] = {
      transaction: jest.fn(async (work: (em: unknown) => Promise<unknown>) =>
        work({ getRepository: () => workflowRepo }),
      ),
    };
    runRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'run-1' }]),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder()),
    };
    connections = {
      findUsableOrThrow: jest.fn().mockResolvedValue(connection()),
      listOptionsForClient: jest.fn().mockResolvedValue([{ id: CONNECTION_ID }]),
      providerFor: jest.fn(),
    };
    credentials = { findByClientAndAgent: jest.fn().mockResolvedValue({ agentId: AGENT_ID }) };
    realtime = { emitWorkflowUpsert: jest.fn(), emitWorkflowRemoved: jest.fn(), emitRunUpsert: jest.fn() };
    statistics = {
      recordEntityCreated: jest.fn().mockResolvedValue(undefined),
      recordEntityUpdated: jest.fn().mockResolvedValue(undefined),
      recordEntityDeleted: jest.fn().mockResolvedValue(undefined),
    };
    searchIndex = {
      isEnabled: jest.fn().mockReturnValue(false),
      searchIds: jest.fn(),
      upsertSafe: jest.fn().mockResolvedValue(undefined),
      deleteSafe: jest.fn().mockResolvedValue(undefined),
    };
    publisher = { publishDeploymentWorkflow: jest.fn() };
    service = new DeploymentWorkflowsService(
      workflowRepo as never,
      runRepo as never,
      connections as never,
      credentials as never,
      realtime as never,
      statistics as never,
      searchIndex as never,
      publisher as never,
    );
  });

  describe('create', () => {
    it('validates the connection, stores the workflow and emits realtime, search, webhook and audit', async () => {
      const summary = await service.create(
        CLIENT_ID,
        {
          connectionId: CONNECTION_ID,
          name: '  Deploy  ',
          repository: 'acme/app',
          workflow: 'deploy.yml',
          defaultInputs: { env: 'prod' },
        },
        'user-1',
      );

      expect(connections.findUsableOrThrow).toHaveBeenCalledWith(CLIENT_ID, CONNECTION_ID);
      expect(workflowRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Deploy',
          scope: 'global',
          agentIds: [],
          enabled: true,
          createdByUserId: 'user-1',
          // A workspace admin writing the workflow approves it.
          approvedAt: expect.any(Date),
          approvedByUserId: 'user-1',
          createdByType: 'user',
          updatedByType: 'user',
          createdByAgentId: null,
        }),
      );
      expect(summary).toEqual(
        expect.objectContaining({
          id: WORKFLOW_ID,
          provider: 'github',
          connectionLabel: 'GitHub',
          defaultInputs: { env: 'prod' },
          approvalStatus: 'approved',
          createdBy: 'user',
          updatedBy: 'user',
          createdByAgentId: null,
        }),
      );
      expect(realtime.emitWorkflowUpsert).toHaveBeenCalledWith(summary);
      expect(searchIndex.upsertSafe).toHaveBeenCalledWith(
        'deployment-workflows',
        expect.objectContaining({ id: WORKFLOW_ID, clientId: CLIENT_ID }),
      );
      expect(publisher.publishDeploymentWorkflow).toHaveBeenCalledWith('deployment_workflow.created', summary);
      expect(statistics.recordEntityCreated).toHaveBeenCalledWith(
        StatisticsEntityType.DEPLOYMENT_WORKFLOW,
        WORKFLOW_ID,
        { clientId: CLIENT_ID },
        'user-1',
      );
    });

    it('rejects connections the workspace may not use', async () => {
      connections.findUsableOrThrow.mockRejectedValue(
        new ForbiddenException('Connection not available for this workspace'),
      );

      await expect(
        service.create(CLIENT_ID, { connectionId: CONNECTION_ID, name: 'x', repository: 'a/b', workflow: 'w.yml' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(workflowRepo.save).not.toHaveBeenCalled();
    });

    it('requires a workflow file for GitHub', async () => {
      await expect(
        service.create(CLIENT_ID, { connectionId: CONNECTION_ID, name: 'x', repository: 'a/b' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not require a workflow for GitLab', async () => {
      connections.findUsableOrThrow.mockResolvedValue(connection({ provider: 'gitlab' }));

      await expect(
        service.create(CLIENT_ID, { connectionId: CONNECTION_ID, name: 'x', repository: 'group/app' }),
      ).resolves.toBeDefined();
    });

    it('requires at least one environment of the workspace for scope environments', async () => {
      await expect(
        service.create(CLIENT_ID, {
          connectionId: CONNECTION_ID,
          name: 'x',
          repository: 'a/b',
          workflow: 'w.yml',
          scope: 'environments',
          agentIds: [],
        }),
      ).rejects.toThrow('at least one environment');

      credentials.findByClientAndAgent.mockResolvedValue(null);

      await expect(
        service.create(CLIENT_ID, {
          connectionId: CONNECTION_ID,
          name: 'x',
          repository: 'a/b',
          workflow: 'w.yml',
          scope: 'environments',
          agentIds: [AGENT_ID],
        }),
      ).rejects.toThrow('is not an environment of this workspace');
      expect(credentials.findByClientAndAgent).toHaveBeenCalledWith(CLIENT_ID, AGENT_ID);
    });

    it('deduplicates assigned environments and drops them for global workflows', async () => {
      await service.create(CLIENT_ID, {
        connectionId: CONNECTION_ID,
        name: 'x',
        repository: 'a/b',
        workflow: 'w.yml',
        scope: 'environments',
        agentIds: [AGENT_ID, AGENT_ID.toUpperCase()],
      });

      expect(workflowRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ agentIds: [AGENT_ID] }));

      await service.create(CLIENT_ID, {
        connectionId: CONNECTION_ID,
        name: 'x',
        repository: 'a/b',
        workflow: 'w.yml',
        agentIds: [AGENT_ID],
      });

      expect(workflowRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'global', agentIds: [] }));
    });

    it('bounds default inputs', async () => {
      await expect(
        service.create(CLIENT_ID, {
          connectionId: CONNECTION_ID,
          name: 'x',
          repository: 'a/b',
          workflow: 'w.yml',
          defaultInputs: { 'bad key': 'x' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('applies partial changes and records the audit update', async () => {
      const summary = await service.update(CLIENT_ID, WORKFLOW_ID, { enabled: false, name: 'Renamed' }, 'user-1');

      expect(workflowRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: WORKFLOW_ID, clientId: CLIENT_ID } }),
      );
      expect(summary).toEqual(expect.objectContaining({ enabled: false, name: 'Renamed' }));
      expect(publisher.publishDeploymentWorkflow).toHaveBeenCalledWith('deployment_workflow.updated', summary);
      expect(statistics.recordEntityUpdated).toHaveBeenCalledWith(
        StatisticsEntityType.DEPLOYMENT_WORKFLOW,
        WORKFLOW_ID,
        { clientId: CLIENT_ID },
        'user-1',
      );
    });

    it('checks a new connection against the workspace', async () => {
      const other = '77777777-7777-4777-8777-777777777777';

      connections.findUsableOrThrow.mockResolvedValue(connection({ id: other, provider: 'jenkins' }));

      await service.update(CLIENT_ID, WORKFLOW_ID, { connectionId: other });

      expect(connections.findUsableOrThrow).toHaveBeenCalledWith(CLIENT_ID, other);
      expect(workflowRepo.save).toHaveBeenCalledWith(expect.objectContaining({ connectionId: other }));
    });

    it('returns 404 for workflows of other workspaces', async () => {
      workflowRepo.findOne.mockResolvedValue(null);

      await expect(service.update(CLIENT_ID, WORKFLOW_ID, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('locks the row inside a transaction', async () => {
      await service.update(CLIENT_ID, WORKFLOW_ID, { name: 'Renamed' }, 'user-1');

      expect(
        (workflowRepo as unknown as { manager: { transaction: jest.Mock } }).manager.transaction,
      ).toHaveBeenCalled();
      expect(workflowRepo.findOne).toHaveBeenCalledWith({
        where: { id: WORKFLOW_ID, clientId: CLIENT_ID },
        lock: { mode: 'pessimistic_write' },
      });
      expect(workflowRepo.save).toHaveBeenCalledWith(expect.objectContaining({ updatedByType: 'user' }));
    });

    it('approves a pending workflow only when the complete editor content is submitted', async () => {
      const complete = {
        connectionId: CONNECTION_ID,
        name: 'Deploy',
        description: null,
        repository: 'acme/app',
        workflow: 'deploy.yml',
        defaultRef: 'main',
        defaultInputs: { env: 'prod' },
        scope: 'environments' as const,
        agentIds: [AGENT_ID],
        agentTriggerEnabled: true,
        enabled: true,
      };

      for (const partial of [
        { enabled: true },
        { name: 'Renamed' },
        { ...complete, agentTriggerEnabled: undefined },
        { ...complete, defaultInputs: undefined },
      ]) {
        stored = workflow({ approvedAt: null, approvedByUserId: null, createdByType: 'agent' });

        await expect(service.update(CLIENT_ID, WORKFLOW_ID, partial, 'user-1')).resolves.toEqual(
          expect.objectContaining({ approvalStatus: 'pending' }),
        );
      }

      stored = workflow({ approvedAt: null, approvedByUserId: null, createdByType: 'agent' });
      statistics.recordEntityUpdated.mockClear();

      const summary = await service.update(CLIENT_ID, WORKFLOW_ID, complete, 'user-2');

      expect(summary).toEqual(expect.objectContaining({ approvalStatus: 'approved', updatedBy: 'user' }));
      expect(workflowRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ approvedAt: expect.any(Date), approvedByUserId: 'user-2' }),
      );
      expect(statistics.recordEntityUpdated).toHaveBeenCalledWith(
        StatisticsEntityType.DEPLOYMENT_WORKFLOW,
        WORKFLOW_ID,
        { clientId: CLIENT_ID, action: 'approved' },
        'user-2',
      );
    });

    it('keeps the approval of approved workflows on partial user updates', async () => {
      await expect(service.update(CLIENT_ID, WORKFLOW_ID, { enabled: false }, 'user-1')).resolves.toEqual(
        expect.objectContaining({ approvalStatus: 'approved', enabled: false }),
      );
    });
  });

  describe('approve', () => {
    const transaction = () => (workflowRepo as unknown as { manager: { transaction: jest.Mock } }).manager.transaction;

    beforeEach(() => {
      stored = workflow({
        approvedAt: null,
        approvedByUserId: null,
        createdByType: 'agent',
        updatedByType: 'agent',
        createdByAgentId: AGENT_ID,
        scope: 'environments',
        agentIds: [AGENT_ID],
      });
      workflowRepo.update.mockImplementation(async (_criteria: unknown, patch: Partial<DeploymentWorkflowEntity>) => {
        stored = workflow({ ...stored, ...patch });

        return { affected: 1 };
      });
    });

    it('approves the reviewed version under a row lock and publishes / audits it', async () => {
      const summary = await service.approve(CLIENT_ID, WORKFLOW_ID, '2026-01-01T00:00:00.000Z', 'admin-1');

      expect(transaction()).toHaveBeenCalled();
      expect(workflowRepo.findOne).toHaveBeenCalledWith({
        where: { id: WORKFLOW_ID, clientId: CLIENT_ID },
        lock: { mode: 'pessimistic_write' },
      });
      expect(workflowRepo.update).toHaveBeenCalledWith(
        { id: WORKFLOW_ID, clientId: CLIENT_ID },
        { approvedAt: expect.any(Date), approvedByUserId: 'admin-1' },
      );
      expect(summary).toEqual(expect.objectContaining({ approvalStatus: 'approved', createdBy: 'agent' }));
      expect(realtime.emitWorkflowUpsert).toHaveBeenCalledWith(summary);
      expect(searchIndex.upsertSafe).toHaveBeenCalledWith('deployment-workflows', expect.anything());
      expect(publisher.publishDeploymentWorkflow).toHaveBeenCalledWith('deployment_workflow.updated', summary);
      expect(statistics.recordEntityUpdated).toHaveBeenCalledWith(
        StatisticsEntityType.DEPLOYMENT_WORKFLOW,
        WORKFLOW_ID,
        { clientId: CLIENT_ID, action: 'approved' },
        'admin-1',
      );
    });

    it('rejects a workflow changed since the review with 409', async () => {
      await expect(
        service.approve(CLIENT_ID, WORKFLOW_ID, '2026-01-01T00:00:00.001Z', 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(workflowRepo.update).not.toHaveBeenCalled();
    });

    it('rejects malformed timestamps (400) and unknown workflows (404)', async () => {
      await expect(service.approve(CLIENT_ID, WORKFLOW_ID, 'yesterday')).rejects.toBeInstanceOf(BadRequestException);

      workflowRepo.findOne.mockResolvedValue(null);

      await expect(service.approve(CLIENT_ID, WORKFLOW_ID, '2026-01-01T00:00:00.000Z')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('treats approving an approved workflow as a no-op', async () => {
      stored = workflow();

      await expect(service.approve(CLIENT_ID, WORKFLOW_ID, '2026-01-01T00:00:00.000Z', 'admin-1')).resolves.toEqual(
        expect.objectContaining({ approvalStatus: 'approved' }),
      );
      expect(workflowRepo.update).not.toHaveBeenCalled();
      expect(publisher.publishDeploymentWorkflow).not.toHaveBeenCalled();
      expect(statistics.recordEntityUpdated).not.toHaveBeenCalled();
    });
  });

  it('remove deletes the workflow, its run documents and records the audit deletion', async () => {
    await service.remove(CLIENT_ID, WORKFLOW_ID, 'user-1');

    expect(workflowRepo.delete).toHaveBeenCalledWith({ id: WORKFLOW_ID, clientId: CLIENT_ID });
    expect(realtime.emitWorkflowRemoved).toHaveBeenCalledWith({ clientId: CLIENT_ID, workflowId: WORKFLOW_ID });
    expect(searchIndex.deleteSafe).toHaveBeenCalledWith('deployment-workflows', WORKFLOW_ID);
    expect(searchIndex.deleteSafe).toHaveBeenCalledWith('deployment-runs', 'run-1');
    expect(publisher.publishDeploymentWorkflow).toHaveBeenCalledWith(
      'deployment_workflow.deleted',
      expect.objectContaining({ id: WORKFLOW_ID }),
    );
    expect(statistics.recordEntityDeleted).toHaveBeenCalledWith(
      StatisticsEntityType.DEPLOYMENT_WORKFLOW,
      WORKFLOW_ID,
      'user-1',
      { clientId: CLIENT_ID },
    );
  });

  describe('list', () => {
    it('filters by approval status', async () => {
      const pendingQb = queryBuilder([stored]);

      workflowRepo.createQueryBuilder.mockReturnValue(pendingQb);
      await service.list(CLIENT_ID, { approvalStatus: 'pending' });
      expect(pendingQb.andWhere).toHaveBeenCalledWith('w.approved_at IS NULL');

      const approvedQb = queryBuilder([stored]);

      workflowRepo.createQueryBuilder.mockReturnValue(approvedQb);
      await service.list(CLIENT_ID, { approvalStatus: 'approved' });
      expect(approvedQb.andWhere).toHaveBeenCalledWith('w.approved_at IS NOT NULL');
    });

    it('filters by environment availability and falls back to ILIKE without OpenSearch', async () => {
      const qb = queryBuilder([stored]);

      workflowRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list(CLIENT_ID, { agentId: AGENT_ID, search: 'deploy', limit: 500 });

      expect(result).toHaveLength(1);
      expect(qb.where).toHaveBeenCalledWith('w.client_id = :clientId', { clientId: CLIENT_ID });
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('w.agent_ids @>'), {
        agentIdsJson: JSON.stringify([AGENT_ID]),
      });
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), expect.anything());
      expect(qb.take).toHaveBeenCalledWith(200);
    });

    it('uses OpenSearch ids when available', async () => {
      const qb = queryBuilder([stored]);

      workflowRepo.createQueryBuilder.mockReturnValue(qb);
      searchIndex.isEnabled.mockReturnValue(true);
      searchIndex.searchIds.mockResolvedValue({ ids: [WORKFLOW_ID], total: 1 });

      await service.list(CLIENT_ID, { search: 'deploy' });

      expect(searchIndex.searchIds).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'deployment-workflows', clientIds: [CLIENT_ID] }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith('w.id IN (:...searchIds)', { searchIds: [WORKFLOW_ID] });
    });
  });

  describe('environments', () => {
    it('listForAgent returns enabled, approved available workflows plus its own (exclusively assigned) ones', async () => {
      const qb = queryBuilder([stored]);

      workflowRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.listForAgent(CLIENT_ID, AGENT_ID.toUpperCase())).resolves.toHaveLength(1);

      const [condition, params] = qb.andWhere.mock.calls[0] as [string, Record<string, unknown>];

      expect(condition).toContain('w.enabled = true AND w.approved_at IS NOT NULL');
      expect(condition).toContain("w.scope = 'global' OR w.agent_ids @> CAST(:agentIdsJson AS jsonb)");
      // Pending / disabled workflows only when assigned to this environment and nobody else.
      expect(condition).toContain("w.scope = 'environments' AND w.agent_ids = CAST(:agentIdsJson AS jsonb)");
      expect(params).toEqual({ agentIdsJson: JSON.stringify([AGENT_ID]) });
    });

    it('findAvailableForAgent (runs) requires enabled and approved workflows', async () => {
      const qb = queryBuilder([stored]);

      workflowRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAvailableForAgent(CLIENT_ID, AGENT_ID);

      expect(qb.andWhere).toHaveBeenCalledWith('w.enabled = true');
      expect(qb.andWhere).toHaveBeenCalledWith('w.approved_at IS NOT NULL');
    });

    it('findForAgentOrThrow hides pending workflows except the environment own ones (409)', async () => {
      stored = workflow({ approvedAt: null });

      await expect(service.findForAgentOrThrow(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      stored = workflow({ approvedAt: null, scope: 'environments', agentIds: [AGENT_ID] });

      await expect(service.findForAgentOrThrow(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toThrow(
        DEPLOYMENT_WORKFLOW_PENDING_MESSAGE,
      );

      stored = workflow({ enabled: false, scope: 'environments', agentIds: [AGENT_ID] });

      await expect(service.findForAgentOrThrow(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );

      stored = workflow({ approvedAt: null, scope: 'environments', agentIds: [AGENT_ID, OTHER_AGENT_ID] });

      await expect(service.findForAgentOrThrow(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('getForAgent shows usable workflows and the environment own ones in any state, nothing else', async () => {
      await expect(service.getForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).resolves.toEqual(
        expect.objectContaining({ id: WORKFLOW_ID }),
      );

      stored = workflow({ approvedAt: null, scope: 'environments', agentIds: [AGENT_ID] });
      await expect(service.getForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).resolves.toEqual(
        expect.objectContaining({ approvalStatus: 'pending' }),
      );

      stored = workflow({ approvedAt: null });
      await expect(service.getForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(NotFoundException);

      stored = workflow({ scope: 'environments', agentIds: [OTHER_AGENT_ID] });
      await expect(service.getForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(NotFoundException);

      stored = workflow({ enabled: false });
      await expect(service.getForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getForAgent(CLIENT_ID, AGENT_ID, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('describeForAgent summarizes a usable workflow', async () => {
      await expect(service.describeForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).resolves.toEqual(
        expect.objectContaining({ id: WORKFLOW_ID, name: 'Deploy', repository: 'acme/app', defaultRef: 'main' }),
      );
    });

    it('findEnabledBatch (history sync) skips pending workflows', async () => {
      await service.findEnabledBatch(0, 10);

      expect(workflowRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enabled: true, approvedAt: expect.anything() } }),
      );
    });

    it('findForAgentOrThrow hides disabled and unassigned workflows', async () => {
      stored = workflow({ scope: 'environments', agentIds: [AGENT_ID] });

      await expect(service.findForAgentOrThrow(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).resolves.toBe(stored);
      await expect(service.findForAgentOrThrow(CLIENT_ID, OTHER_AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      stored = workflow({ enabled: false });

      await expect(service.findForAgentOrThrow(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.findForAgentOrThrow(CLIENT_ID, AGENT_ID, 'not-a-uuid')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('workflows managed by environments', () => {
    const input = {
      connectionId: CONNECTION_ID,
      name: ' Preview ',
      repository: 'acme/app',
      workflow: 'preview.yml',
      defaultInputs: { env: 'preview' },
      agentTriggerEnabled: true,
    };

    it('createForAgent forces the assignment to the environment and leaves the workflow pending', async () => {
      const summary = await service.createForAgent(CLIENT_ID, AGENT_ID.toUpperCase(), {
        ...input,
        // Not part of the input contract: ignored even if a caller sends them.
        ...({ scope: 'global', agentIds: [OTHER_AGENT_ID] } as object),
      });

      expect(connections.findUsableOrThrow).toHaveBeenCalledWith(CLIENT_ID, CONNECTION_ID);
      expect(credentials.findByClientAndAgent).toHaveBeenCalledWith(CLIENT_ID, AGENT_ID);
      expect(workflowRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Preview',
          scope: 'environments',
          agentIds: [AGENT_ID],
          agentTriggerEnabled: true,
          enabled: true,
          approvedAt: null,
          approvedByUserId: null,
          createdByUserId: null,
          createdByType: 'agent',
          updatedByType: 'agent',
          createdByAgentId: AGENT_ID,
        }),
      );
      expect(summary).toEqual(
        expect.objectContaining({ approvalStatus: 'pending', createdBy: 'agent', createdByAgentId: AGENT_ID }),
      );
      expect(realtime.emitWorkflowUpsert).toHaveBeenCalledWith(summary);
      expect(searchIndex.upsertSafe).toHaveBeenCalled();
      expect(publisher.publishDeploymentWorkflow).toHaveBeenCalledWith('deployment_workflow.created', summary);
      expect(statistics.recordEntityCreated).toHaveBeenCalledWith(
        StatisticsEntityType.DEPLOYMENT_WORKFLOW,
        WORKFLOW_ID,
        { clientId: CLIENT_ID, agentId: AGENT_ID, actor: 'agent' },
      );
    });

    it('createForAgent validates like the editor and hides unusable connections (404)', async () => {
      await expect(service.createForAgent(CLIENT_ID, AGENT_ID, { ...input, workflow: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.createForAgent(CLIENT_ID, AGENT_ID, { ...input, name: ' ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.createForAgent(CLIENT_ID, AGENT_ID, { ...input, defaultInputs: { 'bad key': 'x' } }),
      ).rejects.toBeInstanceOf(BadRequestException);

      connections.findUsableOrThrow.mockRejectedValue(
        new ForbiddenException('Connection not available for this workspace'),
      );

      await expect(service.createForAgent(CLIENT_ID, AGENT_ID, input)).rejects.toBeInstanceOf(NotFoundException);
      expect(workflowRepo.save).not.toHaveBeenCalled();
    });

    it('createForAgent bounds the workflows an environment may propose', async () => {
      workflowRepo.count.mockResolvedValue(DEPLOYMENT_AGENT_WORKFLOWS_MAX);

      await expect(service.createForAgent(CLIENT_ID, AGENT_ID, input)).rejects.toBeInstanceOf(ConflictException);
      expect(workflowRepo.count).toHaveBeenCalledWith({ where: { clientId: CLIENT_ID, createdByAgentId: AGENT_ID } });
      expect(workflowRepo.save).not.toHaveBeenCalled();
    });

    it('updateForAgent and deleteForAgent only reach workflows assigned exclusively to the environment', async () => {
      for (const other of [
        workflow(),
        workflow({ scope: 'environments', agentIds: [OTHER_AGENT_ID] }),
        workflow({ scope: 'environments', agentIds: [AGENT_ID, OTHER_AGENT_ID] }),
      ]) {
        stored = other;

        await expect(service.updateForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, { name: 'x' })).rejects.toBeInstanceOf(
          NotFoundException,
        );
        await expect(service.deleteForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      }

      expect(workflowRepo.save).not.toHaveBeenCalled();
      expect(workflowRepo.delete).not.toHaveBeenCalled();
    });

    it('updateForAgent makes the workflow pending when approved content changes or it is switched on again', async () => {
      connections.findUsableOrThrow.mockResolvedValue(connection({ id: '77777777-7777-4777-8777-777777777777' }));

      for (const change of [
        { name: 'Renamed' },
        { repository: 'acme/other' },
        { workflow: 'other.yml' },
        { defaultRef: 'release' },
        { defaultInputs: { env: 'prod', extra: '1' } },
        { description: 'Now with a description' },
        { agentTriggerEnabled: true },
        { connectionId: '77777777-7777-4777-8777-777777777777' },
      ]) {
        stored = workflow({ scope: 'environments', agentIds: [AGENT_ID] });

        await expect(service.updateForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, change)).resolves.toEqual(
          expect.objectContaining({ approvalStatus: 'pending', updatedBy: 'agent' }),
        );
      }

      stored = workflow({ scope: 'environments', agentIds: [AGENT_ID], enabled: false });

      await expect(service.updateForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, { enabled: true })).resolves.toEqual(
        expect.objectContaining({ approvalStatus: 'pending', enabled: true }),
      );
      expect(statistics.recordEntityUpdated).toHaveBeenCalledWith(
        StatisticsEntityType.DEPLOYMENT_WORKFLOW,
        WORKFLOW_ID,
        { clientId: CLIENT_ID, agentId: AGENT_ID, actor: 'agent' },
      );
    });

    it('updateForAgent keeps the approval when disabling or resubmitting unchanged values', async () => {
      for (const change of [
        { enabled: false },
        { name: 'Deploy', defaultInputs: { env: 'prod' }, defaultRef: 'main', description: null },
      ]) {
        stored = workflow({ scope: 'environments', agentIds: [AGENT_ID] });

        await expect(service.updateForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, change)).resolves.toEqual(
          expect.objectContaining({ approvalStatus: 'approved', updatedBy: 'agent' }),
        );
      }
    });

    it('updateForAgent never changes the assignment', async () => {
      stored = workflow({ scope: 'environments', agentIds: [AGENT_ID] });

      await service.updateForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, {
        name: 'Renamed',
        ...({ scope: 'global', agentIds: [AGENT_ID, OTHER_AGENT_ID] } as object),
      });

      expect(workflowRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'environments', agentIds: [AGENT_ID] }),
      );
    });

    it('deleteForAgent removes the own workflow with its run documents and audits the environment', async () => {
      stored = workflow({ scope: 'environments', agentIds: [AGENT_ID] });

      await service.deleteForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID);

      expect(workflowRepo.delete).toHaveBeenCalledWith({ id: WORKFLOW_ID, clientId: CLIENT_ID });
      expect(realtime.emitWorkflowRemoved).toHaveBeenCalledWith({ clientId: CLIENT_ID, workflowId: WORKFLOW_ID });
      expect(searchIndex.deleteSafe).toHaveBeenCalledWith('deployment-runs', 'run-1');
      expect(publisher.publishDeploymentWorkflow).toHaveBeenCalledWith(
        'deployment_workflow.deleted',
        expect.objectContaining({ id: WORKFLOW_ID }),
      );
      expect(statistics.recordEntityDeleted).toHaveBeenCalledWith(
        StatisticsEntityType.DEPLOYMENT_WORKFLOW,
        WORKFLOW_ID,
        undefined,
        { clientId: CLIENT_ID, agentId: AGENT_ID, actor: 'agent' },
      );
    });
  });

  it('browses repositories through a usable connection', async () => {
    const provider = { listRepositories: jest.fn().mockResolvedValue([{ id: 'acme/app' }]) };

    connections.providerFor.mockReturnValue({ provider, connection: { id: CONNECTION_ID } });

    await expect(service.listRepositories(CLIENT_ID, CONNECTION_ID, ' app ')).resolves.toEqual([{ id: 'acme/app' }]);
    expect(provider.listRepositories).toHaveBeenCalledWith({ id: CONNECTION_ID }, 'app');
  });

  describe('refreshLastRun', () => {
    it('updates and publishes the last-run fields when they changed', async () => {
      const startedAt = new Date('2026-02-01T00:00:00.000Z');

      runRepo.createQueryBuilder.mockReturnValue(
        queryBuilder([], { status: 'completed', conclusion: 'success', startedAt, createdAt: new Date() }),
      );

      await service.refreshLastRun(WORKFLOW_ID);

      expect(workflowRepo.update).toHaveBeenCalledWith(
        { id: WORKFLOW_ID },
        { lastRunStatus: 'completed', lastRunConclusion: 'success', lastRunAt: startedAt },
      );
      expect(realtime.emitWorkflowUpsert).toHaveBeenCalled();
    });

    it('does nothing when unchanged', async () => {
      runRepo.createQueryBuilder.mockReturnValue(queryBuilder([], null));

      await service.refreshLastRun(WORKFLOW_ID);

      expect(workflowRepo.update).not.toHaveBeenCalled();
      expect(realtime.emitWorkflowUpsert).not.toHaveBeenCalled();
    });
  });
});
