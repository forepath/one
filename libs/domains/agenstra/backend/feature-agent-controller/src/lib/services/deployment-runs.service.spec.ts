import { DEPLOYMENT_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { DeploymentConnectionEntity } from '../entities/deployment-connection.entity';
import type { DeploymentRunEntity } from '../entities/deployment-run.entity';
import type { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';
import { StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import type { DeploymentProviderRunSnapshot } from '../providers/deployment/deployment-provider.interface';

import { capDeploymentLogs, DeploymentRunsService, sortDeploymentJobsNewestFirst } from './deployment-runs.service';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const WORKFLOW_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_AGENT_ID = '66666666-6666-4666-8666-666666666666';

function connection(): DeploymentConnectionEntity {
  return {
    id: CONNECTION_ID,
    label: 'GitLab',
    provider: 'gitlab',
    workspaceAccess: 'all',
  } as DeploymentConnectionEntity;
}

function workflow(overrides: Partial<DeploymentWorkflowEntity> = {}): DeploymentWorkflowEntity {
  return {
    id: WORKFLOW_ID,
    clientId: CLIENT_ID,
    connectionId: CONNECTION_ID,
    connection: connection(),
    name: 'Deploy',
    repository: 'group/app',
    workflow: null,
    defaultRef: 'main',
    defaultInputs: { env: 'staging', region: 'eu' },
    scope: 'global',
    agentIds: [],
    agentTriggerEnabled: true,
    enabled: true,
    approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as DeploymentWorkflowEntity;
}

function run(overrides: Partial<DeploymentRunEntity> = {}): DeploymentRunEntity {
  return {
    id: RUN_ID,
    clientId: CLIENT_ID,
    workflowId: WORKFLOW_ID,
    workflowEntity: workflow(),
    agentId: null,
    providerRunId: '900',
    name: 'Deploy',
    status: 'in_progress',
    conclusion: null,
    ref: 'main',
    sha: null,
    url: null,
    inputs: {},
    triggeredByType: 'user',
    triggeredByUserId: 'user-1',
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as DeploymentRunEntity;
}

function snapshot(overrides: Partial<DeploymentProviderRunSnapshot> = {}): DeploymentProviderRunSnapshot {
  return {
    providerRunId: '900',
    name: 'Deploy',
    status: 'queued',
    conclusion: null,
    ref: 'main',
    sha: 'abc',
    url: 'https://gitlab.example/pipelines/900',
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function queryBuilder(rows: unknown[], total = rows.length) {
  const qb: Record<string, jest.Mock> = {};

  for (const method of [
    'leftJoinAndSelect',
    'where',
    'andWhere',
    'addSelect',
    'orderBy',
    'addOrderBy',
    'offset',
    'limit',
    'skip',
    'take',
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }

  qb['getManyAndCount'] = jest.fn().mockResolvedValue([rows, total]);
  qb['getMany'] = jest.fn().mockResolvedValue(rows);

  return qb;
}

describe('DeploymentRunsService', () => {
  let runRepo: Record<string, jest.Mock>;
  let workflows: Record<string, jest.Mock>;
  let connections: Record<string, jest.Mock>;
  let provider: Record<string, jest.Mock>;
  let credentials: { findByClientAndAgent: jest.Mock };
  let realtime: Record<string, jest.Mock>;
  let statistics: Record<string, jest.Mock>;
  let searchIndex: Record<string, jest.Mock>;
  let publisher: Record<string, jest.Mock>;
  let sources: { assertSourceAllows: jest.Mock };
  let service: DeploymentRunsService;
  const chat = { kind: 'chat' as const };

  beforeEach(() => {
    runRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder([run()])),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(run()),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation(async (value) => ({
        ...value,
        id: RUN_ID,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    workflows = {
      findOrThrow: jest.fn().mockResolvedValue(workflow()),
      findForAgentOrThrow: jest.fn().mockResolvedValue(workflow()),
      findAvailableForAgent: jest.fn().mockResolvedValue([workflow()]),
      findEnabledBatch: jest.fn().mockResolvedValue([workflow()]),
      refreshLastRun: jest.fn().mockResolvedValue(undefined),
    };
    provider = {
      trigger: jest.fn().mockResolvedValue(snapshot()),
      getRun: jest.fn().mockResolvedValue(snapshot({ status: 'in_progress' })),
      listRuns: jest.fn().mockResolvedValue([]),
      listJobs: jest.fn().mockResolvedValue([{ id: '1', name: 'build' }]),
      listBranches: jest.fn().mockResolvedValue([{ name: 'develop', sha: null, default: true }]),
      getRunLogs: jest.fn().mockResolvedValue({ logs: 'log', truncated: false }),
      getJobLogs: jest.fn().mockResolvedValue({ logs: 'job log', truncated: false }),
      cancelRun: jest.fn().mockResolvedValue(undefined),
    };
    connections = {
      providerFor: jest.fn().mockReturnValue({ provider, connection: { id: CONNECTION_ID } }),
      isUsableByClient: jest.fn().mockReturnValue(true),
      assertUsableByClient: jest.fn(),
    };
    credentials = { findByClientAndAgent: jest.fn().mockResolvedValue({ agentId: AGENT_ID }) };
    realtime = { emitRunUpsert: jest.fn(), emitWorkflowUpsert: jest.fn(), emitWorkflowRemoved: jest.fn() };
    statistics = {
      recordEntityCreated: jest.fn().mockResolvedValue(undefined),
      recordEntityUpdated: jest.fn().mockResolvedValue(undefined),
    };
    searchIndex = {
      isEnabled: jest.fn().mockReturnValue(false),
      searchIds: jest.fn(),
      upsertSafe: jest.fn().mockResolvedValue(undefined),
      deleteSafe: jest.fn().mockResolvedValue(undefined),
    };
    publisher = { publishDeploymentRun: jest.fn() };
    sources = { assertSourceAllows: jest.fn().mockResolvedValue(undefined) };
    service = new DeploymentRunsService(
      runRepo as never,
      workflows as never,
      connections as never,
      credentials as never,
      realtime as never,
      statistics as never,
      sources as never,
      searchIndex as never,
      publisher as never,
    );
  });

  describe('trigger', () => {
    it('merges inputs over the defaults, records the run and emits realtime, webhook and audit', async () => {
      const summary = await service.trigger(CLIENT_ID, WORKFLOW_ID, { inputs: { env: 'prod' } }, 'user-1');

      expect(provider.trigger).toHaveBeenCalledWith(
        { id: CONNECTION_ID },
        { repository: 'group/app', workflow: null, ref: 'main', inputs: { env: 'prod', region: 'eu' } },
      );
      expect(runRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          providerRunId: '900',
          triggeredByType: 'user',
          triggeredByUserId: 'user-1',
          inputs: { env: 'prod', region: 'eu' },
        }),
      );
      expect(summary).toEqual(expect.objectContaining({ id: RUN_ID, workflowName: 'Deploy', triggeredBy: 'user' }));
      expect(realtime.emitRunUpsert).toHaveBeenCalledWith(summary);
      expect(searchIndex.upsertSafe).toHaveBeenCalledWith('deployment-runs', expect.objectContaining({ id: RUN_ID }));
      expect(publisher.publishDeploymentRun).toHaveBeenCalledWith('deployment_run.created', summary);
      expect(statistics.recordEntityCreated).toHaveBeenCalledWith(
        StatisticsEntityType.DEPLOYMENT_RUN,
        RUN_ID,
        expect.objectContaining({ clientId: CLIENT_ID }),
        'user-1',
      );
      expect(workflows.refreshLastRun).toHaveBeenCalledWith(WORKFLOW_ID);
    });

    it('rejects disabled workflows with 409', async () => {
      workflows.findOrThrow.mockResolvedValue(workflow({ enabled: false }));

      await expect(service.trigger(CLIENT_ID, WORKFLOW_ID, {})).rejects.toBeInstanceOf(ConflictException);
      expect(provider.trigger).not.toHaveBeenCalled();
    });

    it('rejects pending workflows with 409 (waiting for a workspace admin), also for a selected environment', async () => {
      workflows.findOrThrow.mockResolvedValue(workflow({ approvedAt: null }));

      await expect(service.trigger(CLIENT_ID, WORKFLOW_ID, {})).rejects.toThrow('waits for approval');

      workflows.findOrThrow.mockResolvedValue(
        workflow({ approvedAt: null, scope: 'environments', agentIds: [OTHER_AGENT_ID] }),
      );

      await expect(service.trigger(CLIENT_ID, WORKFLOW_ID, { agentId: AGENT_ID })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(provider.trigger).not.toHaveBeenCalled();
    });

    it('rejects workflows whose connection is no longer available to the workspace', async () => {
      connections.assertUsableByClient.mockImplementation(() => {
        throw new ForbiddenException('Connection not available for this workspace');
      });

      await expect(service.trigger(CLIENT_ID, WORKFLOW_ID, {})).rejects.toBeInstanceOf(ForbiddenException);
      expect(provider.trigger).not.toHaveBeenCalled();
    });

    it('falls back to the repository default branch, and requires a ref without any default', async () => {
      workflows.findOrThrow.mockResolvedValue(workflow({ defaultRef: null }));

      await service.trigger(CLIENT_ID, WORKFLOW_ID, {});

      expect(provider.trigger).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ref: 'develop' }));

      provider.listBranches.mockResolvedValue([]);

      await expect(service.trigger(CLIENT_ID, WORKFLOW_ID, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('checks the environment against the workspace and the workflow assignment', async () => {
      workflows.findOrThrow.mockResolvedValue(workflow({ scope: 'environments', agentIds: [OTHER_AGENT_ID] }));

      await expect(service.trigger(CLIENT_ID, WORKFLOW_ID, { agentId: AGENT_ID })).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      credentials.findByClientAndAgent.mockResolvedValue(null);

      await expect(service.trigger(CLIENT_ID, WORKFLOW_ID, { agentId: OTHER_AGENT_ID })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('bounds the merged inputs', async () => {
      await expect(
        service.trigger(CLIENT_ID, WORKFLOW_ID, {
          inputs: { ok: 'x'.repeat(DEPLOYMENT_LIMITS.inputValueMaxLength + 1) },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('list', () => {
    it('returns items and total, newest first by start time, with bounded paging', async () => {
      const qb = queryBuilder([run()], 7);

      runRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.list(CLIENT_ID, {
        workflowId: WORKFLOW_ID,
        status: 'completed',
        limit: 1000,
        offset: 20,
      });

      expect(result.total).toBe(7);
      expect(result.items).toHaveLength(1);
      expect(qb.where).toHaveBeenCalledWith('r.client_id = :clientId', { clientId: CLIENT_ID });
      expect(qb.andWhere).toHaveBeenCalledWith('r.status = :status', { status: 'completed' });
      // Provider start wins over the record time (synced runs are recorded at sync time), id breaks ties.
      expect(qb.addSelect).toHaveBeenCalledWith('COALESCE(r.started_at, r.created_at)', 'deployment_run_sort_at');
      expect(qb.orderBy).toHaveBeenCalledWith('deployment_run_sort_at', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('r.id', 'DESC');
      // Many-to-one join: SQL LIMIT / OFFSET instead of skip / take (which cannot order by the computed alias).
      expect(qb.limit).toHaveBeenCalledWith(100);
      expect(qb.offset).toHaveBeenCalledWith(20);
      expect(qb.take).not.toHaveBeenCalled();
      expect(qb.skip).not.toHaveBeenCalled();
    });

    it('rejects unknown statuses', async () => {
      await expect(service.list(CLIENT_ID, { status: 'running' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('searches through OpenSearch ids when available, else ILIKE (incl. workflow name)', async () => {
      const qb = queryBuilder([]);

      runRepo.createQueryBuilder.mockReturnValue(qb);

      await service.list(CLIENT_ID, { search: 'main' });

      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('w.name ILIKE'), expect.anything());

      searchIndex.isEnabled.mockReturnValue(true);
      searchIndex.searchIds.mockResolvedValue({ ids: [RUN_ID], total: 1 });

      await service.list(CLIENT_ID, { search: 'main' });

      expect(qb.andWhere).toHaveBeenCalledWith('r.id IN (:...searchIds)', { searchIds: [RUN_ID] });
    });
  });

  describe('detail and logs', () => {
    it('refreshes active runs from the provider and emits the status change', async () => {
      const detail = await service.getDetail(CLIENT_ID, RUN_ID);

      expect(provider.getRun).toHaveBeenCalledWith({ id: CONNECTION_ID }, 'group/app', '900');
      expect(detail.jobs).toEqual([{ id: '1', name: 'build' }]);
      expect(runRepo.update).toHaveBeenCalledWith({ id: RUN_ID }, expect.objectContaining({ sha: 'abc' }));
      expect(realtime.emitRunUpsert).toHaveBeenCalled();
    });

    it('publishes deployment_run.completed when an active run completes', async () => {
      provider.getRun.mockResolvedValue(snapshot({ status: 'completed', conclusion: 'success' }));

      await service.getDetail(CLIENT_ID, RUN_ID);

      expect(publisher.publishDeploymentRun).toHaveBeenCalledWith(
        'deployment_run.completed',
        expect.objectContaining({ status: 'completed', conclusion: 'success' }),
      );
      expect(workflows.refreshLastRun).toHaveBeenCalledWith(WORKFLOW_ID);
    });

    it('returns jobs newest first by start time (jobs without start last, provider order otherwise)', async () => {
      provider.listJobs.mockResolvedValue([
        { id: 'a', name: 'lint', startedAt: '2026-03-01T10:00:00.000Z' },
        { id: 'b', name: 'queued-1', startedAt: null },
        { id: 'c', name: 'deploy', startedAt: '2026-03-01T10:05:00.000Z' },
        { id: 'd', name: 'queued-2', startedAt: null },
        { id: 'e', name: 'test', startedAt: '2026-03-01T10:00:00.000Z' },
      ]);

      const detail = await service.getDetail(CLIENT_ID, RUN_ID);

      expect(detail.jobs.map((job) => job.id)).toEqual(['c', 'a', 'e', 'b', 'd']);

      const forAgent = await service.getForAgent(CLIENT_ID, AGENT_ID, RUN_ID);

      expect(forAgent.jobs.map((job) => job.id)).toEqual(['c', 'a', 'e', 'b', 'd']);
    });

    it('does not read pending workflows from the provider (their repository may have changed)', async () => {
      runRepo.findOne.mockResolvedValue(run({ workflowEntity: workflow({ approvedAt: null }) }));

      const detail = await service.getDetail(CLIENT_ID, RUN_ID);

      expect(detail.jobs).toEqual([]);
      expect(provider.getRun).not.toHaveBeenCalled();
      expect(provider.listJobs).not.toHaveBeenCalled();
      await expect(service.getLogs(CLIENT_ID, RUN_ID)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.cancel(CLIENT_ID, RUN_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(provider.getRunLogs).not.toHaveBeenCalled();
      expect(provider.cancelRun).not.toHaveBeenCalled();
    });

    it('returns stored data without provider calls when the connection was revoked', async () => {
      connections.isUsableByClient.mockReturnValue(false);

      const detail = await service.getDetail(CLIENT_ID, RUN_ID);

      expect(detail.run.id).toBe(RUN_ID);
      expect(provider.getRun).not.toHaveBeenCalled();
    });

    it('scopes runs by workspace (404 otherwise)', async () => {
      runRepo.findOne.mockResolvedValue(null);

      await expect(service.getDetail(CLIENT_ID, RUN_ID)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getDetail(CLIENT_ID, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reads run and job logs with the user cap; 403 when the connection was revoked', async () => {
      await service.getLogs(CLIENT_ID, RUN_ID);
      await service.getLogs(CLIENT_ID, RUN_ID, '1');

      expect(provider.getRunLogs).toHaveBeenCalledWith(
        { id: CONNECTION_ID },
        'group/app',
        '900',
        DEPLOYMENT_LIMITS.logsMaxBytes,
      );
      expect(provider.getJobLogs).toHaveBeenCalledWith(
        { id: CONNECTION_ID },
        'group/app',
        '900',
        '1',
        DEPLOYMENT_LIMITS.logsMaxBytes,
      );
      await expect(service.getLogs(CLIENT_ID, RUN_ID, '../x')).rejects.toBeInstanceOf(BadRequestException);
      // Job ids of other runs (other workflows of the same repository) are rejected before the provider is asked.
      provider.getJobLogs.mockClear();
      await expect(service.getLogs(CLIENT_ID, RUN_ID, '777')).rejects.toBeInstanceOf(NotFoundException);
      expect(provider.getJobLogs).not.toHaveBeenCalled();

      connections.assertUsableByClient.mockImplementation(() => {
        throw new ForbiddenException('Connection not available for this workspace');
      });

      await expect(service.getLogs(CLIENT_ID, RUN_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('cancel', () => {
    it('cancels active runs on the provider and records the audit update', async () => {
      await service.cancel(CLIENT_ID, RUN_ID, 'user-1');

      expect(provider.cancelRun).toHaveBeenCalledWith({ id: CONNECTION_ID }, 'group/app', '900');
      expect(statistics.recordEntityUpdated).toHaveBeenCalledWith(
        StatisticsEntityType.DEPLOYMENT_RUN,
        RUN_ID,
        expect.objectContaining({ clientId: CLIENT_ID, action: 'cancelled' }),
        'user-1',
      );
    });

    it('rejects completed runs and runs without provider id with 409', async () => {
      runRepo.findOne.mockResolvedValue(run({ status: 'completed' }));
      await expect(service.cancel(CLIENT_ID, RUN_ID)).rejects.toBeInstanceOf(ConflictException);

      runRepo.findOne.mockResolvedValue(run({ providerRunId: null, status: 'queued' }));
      await expect(service.cancel(CLIENT_ID, RUN_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(provider.cancelRun).not.toHaveBeenCalled();
    });
  });

  describe('environments', () => {
    it('lists runs of available workflows only, newest first by start time', async () => {
      const qb = queryBuilder([run()]);

      runRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.listForAgent(CLIENT_ID, AGENT_ID, { limit: 5 })).resolves.toHaveLength(1);

      expect(workflows.findAvailableForAgent).toHaveBeenCalledWith(CLIENT_ID, AGENT_ID);
      expect(qb.andWhere).toHaveBeenCalledWith('r.workflow_id IN (:...workflowIds)', { workflowIds: [WORKFLOW_ID] });
      expect(qb.orderBy).toHaveBeenCalledWith('deployment_run_sort_at', 'DESC');
      expect(qb.limit).toHaveBeenCalledWith(5);

      await expect(
        service.listForAgent(CLIENT_ID, AGENT_ID, { workflowId: '77777777-7777-4777-8777-777777777777' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hides runs of unassigned or disabled workflows', async () => {
      runRepo.findOne.mockResolvedValue(
        run({ workflowEntity: workflow({ scope: 'environments', agentIds: [OTHER_AGENT_ID] }) }),
      );

      await expect(service.getForAgent(CLIENT_ID, AGENT_ID, RUN_ID)).rejects.toBeInstanceOf(NotFoundException);

      runRepo.findOne.mockResolvedValue(run({ workflowEntity: workflow({ enabled: false }) }));

      await expect(service.getLogsForAgent(CLIENT_ID, AGENT_ID, RUN_ID)).rejects.toBeInstanceOf(NotFoundException);

      runRepo.findOne.mockResolvedValue(run({ workflowEntity: workflow({ approvedAt: null }) }));

      await expect(service.getForAgent(CLIENT_ID, AGENT_ID, RUN_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('caps environment logs at agentLogsMaxBytes', async () => {
      await service.getLogsForAgent(CLIENT_ID, AGENT_ID, RUN_ID);

      expect(provider.getRunLogs).toHaveBeenCalledWith(
        expect.anything(),
        'group/app',
        '900',
        DEPLOYMENT_LIMITS.agentLogsMaxBytes,
      );
    });

    it('only triggers and cancels when the workflow allows environments to', async () => {
      workflows.findForAgentOrThrow.mockResolvedValue(workflow({ agentTriggerEnabled: false }));

      await expect(service.triggerForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, {}, chat)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      runRepo.findOne.mockResolvedValue(run({ workflowEntity: workflow({ agentTriggerEnabled: false }) }));

      await expect(service.cancelForAgent(CLIENT_ID, AGENT_ID, RUN_ID, chat)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(provider.trigger).not.toHaveBeenCalled();
      expect(provider.cancelRun).not.toHaveBeenCalled();
    });

    it('records agent triggered runs with the environment id', async () => {
      const summary = await service.triggerForAgent(
        CLIENT_ID,
        AGENT_ID,
        WORKFLOW_ID,
        { ref: 'main', inputs: { region: 'us' } },
        chat,
      );

      expect(provider.trigger).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ref: 'main', inputs: { env: 'staging', region: 'us' } }),
      );
      expect(summary).toEqual(
        expect.objectContaining({ agentId: AGENT_ID, triggeredBy: 'agent', triggeredByUserId: null }),
      );
    });

    it('pins environments to the default ref and the inputs the workflow defines', async () => {
      await expect(
        service.triggerForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, { ref: 'feature/evil-workflow' }, chat),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.triggerForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, { inputs: { CI_DEBUG_TRACE: 'true' } }, chat),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(provider.trigger).not.toHaveBeenCalled();

      await service.triggerForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, {}, chat);

      expect(provider.trigger).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ref: 'main' }));
    });
  });

  describe('environment action sources', () => {
    it('checks the action source before any workflow or run lookup', async () => {
      const task = { kind: 'task' as const, taskId: '77777777-7777-4777-8777-777777777777' };

      sources.assertSourceAllows.mockRejectedValue(new ForbiddenException('No deployment actions were approved'));

      await expect(service.triggerForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, {}, task)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.cancelForAgent(CLIENT_ID, AGENT_ID, RUN_ID, { kind: 'automation' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(sources.assertSourceAllows).toHaveBeenCalledWith(CLIENT_ID, AGENT_ID, task, 'deployment.trigger');
      expect(sources.assertSourceAllows).toHaveBeenCalledWith(
        CLIENT_ID,
        AGENT_ID,
        { kind: 'automation' },
        'deployment.cancel',
      );
      expect(workflows.findForAgentOrThrow).not.toHaveBeenCalled();
      expect(runRepo.findOne).not.toHaveBeenCalled();
      expect(provider.trigger).not.toHaveBeenCalled();
      expect(provider.cancelRun).not.toHaveBeenCalled();
    });

    it('keeps the workflow gates on top of an allowed source', async () => {
      workflows.findForAgentOrThrow.mockResolvedValue(workflow({ approvedAt: null }));

      await expect(service.triggerForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID, {}, chat)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(sources.assertSourceAllows).toHaveBeenCalledWith(CLIENT_ID, AGENT_ID, chat, 'deployment.trigger');
      expect(provider.trigger).not.toHaveBeenCalled();
    });
  });

  describe('scheduler', () => {
    it('pollActiveRuns only polls runs of approved workflows', async () => {
      await service.pollActiveRuns(10);

      expect(runRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ workflowEntity: { approvedAt: expect.anything() } }),
        }),
      );
    });

    it('sync rejects pending workflows with 409', async () => {
      workflows.findOrThrow.mockResolvedValue(workflow({ approvedAt: null }));

      await expect(service.sync(CLIENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(provider.listRuns).not.toHaveBeenCalled();
    });

    it('syncForAgent imports history of a usable workflow and throttles repeated syncs', async () => {
      provider.listRuns.mockResolvedValue([]);

      await expect(service.syncForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).resolves.toEqual({ synced: 0 });
      expect(workflows.findForAgentOrThrow).toHaveBeenCalledWith(CLIENT_ID, AGENT_ID, WORKFLOW_ID);
      expect(provider.listRuns).toHaveBeenCalledTimes(1);

      await expect(service.syncForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(provider.listRuns).toHaveBeenCalledTimes(1);
    });

    it('syncForAgent refuses workflows the environment may not use (lookup errors pass through)', async () => {
      workflows.findForAgentOrThrow.mockRejectedValue(new NotFoundException('Deployment workflow not found'));

      await expect(service.syncForAgent(CLIENT_ID, AGENT_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(provider.listRuns).not.toHaveBeenCalled();
    });

    it('pollActiveRuns refreshes active runs and rotates unchanged ones', async () => {
      runRepo.find.mockResolvedValue([run({ id: 'a' }), run({ id: 'b', providerRunId: '901' })]);
      provider.getRun
        .mockResolvedValueOnce(snapshot({ status: 'completed', conclusion: 'failure' }))
        .mockResolvedValueOnce(
          snapshot({ providerRunId: '901', name: 'Deploy', status: 'in_progress', sha: null, url: null, ref: 'main' }),
        );

      await expect(service.pollActiveRuns(10)).resolves.toBe(2);

      expect(runRepo.update).toHaveBeenCalledWith({ id: 'a' }, expect.objectContaining({ status: 'completed' }));
      expect(runRepo.update).toHaveBeenCalledWith({ id: 'b' }, { updatedAt: expect.any(Date) });
      expect(workflows.refreshLastRun).toHaveBeenCalledTimes(1);
    });

    it('persists Jenkins build ids that replace queue ids', async () => {
      runRepo.find.mockResolvedValue([run({ providerRunId: 'queue:17', status: 'queued' })]);
      runRepo.findOne.mockResolvedValue(null);
      provider.getRun.mockResolvedValue(snapshot({ providerRunId: '42', status: 'in_progress' }));

      await service.pollActiveRuns(10);

      expect(provider.getRun).toHaveBeenCalledWith(expect.anything(), 'group/app', 'queue:17');
      expect(runRepo.update).toHaveBeenCalledWith({ id: RUN_ID }, expect.objectContaining({ providerRunId: '42' }));
    });

    it('resolves GitHub dispatches without provider run id through resolveDispatchedRun', async () => {
      const github = workflow({ workflow: 'deploy.yml' });

      provider.resolveDispatchedRun = jest.fn().mockResolvedValue(snapshot({ providerRunId: '555' }));
      runRepo.find
        .mockResolvedValueOnce([run({ providerRunId: null, status: 'queued', workflowEntity: github })])
        .mockResolvedValueOnce([]);
      runRepo.findOne.mockResolvedValue(null);

      await service.pollActiveRuns(10);

      expect(provider.resolveDispatchedRun).toHaveBeenCalledWith(
        { id: CONNECTION_ID },
        expect.objectContaining({ repository: 'group/app', workflow: 'deploy.yml', ref: 'main' }),
      );
      expect(provider.listRuns).not.toHaveBeenCalled();
      expect(runRepo.update).toHaveBeenCalledWith({ id: RUN_ID }, expect.objectContaining({ providerRunId: '555' }));
    });

    it('keeps GitHub dispatches queued while the run is not listed yet', async () => {
      provider.resolveDispatchedRun = jest.fn().mockResolvedValue(null);
      runRepo.find.mockResolvedValueOnce([
        run({ providerRunId: null, status: 'queued', workflowEntity: workflow({ workflow: 'deploy.yml' }) }),
      ]);

      await service.pollActiveRuns(10);

      expect(runRepo.update).toHaveBeenCalledWith({ id: RUN_ID }, { updatedAt: expect.any(Date) });
      expect(realtime.emitRunUpsert).not.toHaveBeenCalled();
    });

    it('syncHistory imports provider runs as external and skips unusable connections', async () => {
      provider.listRuns.mockResolvedValue([
        snapshot({ providerRunId: '1000', status: 'completed', conclusion: 'success' }),
      ]);
      runRepo.findOne.mockResolvedValue(null);

      await expect(service.syncHistory(10)).resolves.toBe(1);

      expect(runRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ providerRunId: '1000', triggeredByType: 'external', agentId: null }),
      );
      expect(publisher.publishDeploymentRun).not.toHaveBeenCalled();
      expect(workflows.refreshLastRun).toHaveBeenCalledWith(WORKFLOW_ID);

      connections.isUsableByClient.mockReturnValue(false);
      provider.listRuns.mockClear();

      await expect(service.syncHistory(10)).resolves.toBe(0);
      expect(provider.listRuns).not.toHaveBeenCalled();
    });
  });

  it('sortDeploymentJobsNewestFirst is stable and puts jobs without (valid) start time last', () => {
    const job = (id: string, startedAt: string | null) =>
      ({ id, name: id, status: 'completed', conclusion: null, startedAt, completedAt: null, url: null }) as const;

    expect(
      sortDeploymentJobsNewestFirst([
        job('x', 'not-a-date'),
        job('a', '2026-01-01T00:00:00.000Z'),
        job('b', '2026-01-02T00:00:00.000Z'),
        job('y', null),
      ]).map((entry) => entry.id),
    ).toEqual(['b', 'a', 'x', 'y']);
  });

  it('capDeploymentLogs keeps the UTF-8 tail within the byte limit', () => {
    expect(capDeploymentLogs({ logs: 'abc', truncated: false }, 10)).toEqual({ logs: 'abc', truncated: false });

    const capped = capDeploymentLogs({ logs: 'ääää', truncated: false }, 3);

    expect(Buffer.byteLength(capped.logs)).toBeLessThanOrEqual(3);
    expect(capped).toEqual({ logs: 'ä', truncated: true });
  });
});
