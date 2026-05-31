import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentConsoleRegexFilterRuleSyncTargetEntity } from '../entities/agent-console-regex-filter-rule-sync-target.entity';
import { AgentConsoleRegexFilterRuleEntity } from '../entities/agent-console-regex-filter-rule.entity';

import { AgentManagerFilterRulesClientService } from './agent-manager-filter-rules-client.service';
import { FilterRulesSyncService } from './filter-rules-sync.service';

describe('FilterRulesSyncService', () => {
  const rule = {
    id: 'rule-1',
    pattern: 'foo',
    regexFlags: 'i',
    direction: 'inbound',
    filterType: 'filter',
    replaceContent: 'bar',
    priority: 1,
    enabled: true,
  } as unknown as AgentConsoleRegexFilterRuleEntity;
  const createTarget = (
    overrides: Partial<AgentConsoleRegexFilterRuleSyncTargetEntity> = {},
  ): AgentConsoleRegexFilterRuleSyncTargetEntity & { rule: AgentConsoleRegexFilterRuleEntity } =>
    ({
      id: 'target-1',
      clientId: 'client-1',
      managerRuleId: null,
      desiredOnManager: true,
      syncStatus: 'pending',
      lastError: null,
      rule,
      ...overrides,
    }) as AgentConsoleRegexFilterRuleSyncTargetEntity & { rule: AgentConsoleRegexFilterRuleEntity };
  const createService = (
    deps: {
      targetsRepo?: Record<string, unknown>;
      agentManagerClient?: Record<string, unknown>;
    } = {},
  ) => {
    const targetsRepo = {
      createQueryBuilder: jest.fn(),
      save: jest.fn().mockImplementation(async (target) => target),
      ...deps.targetsRepo,
    };
    const agentManagerClient = {
      createRule: jest.fn(),
      updateRule: jest.fn(),
      deleteRule: jest.fn(),
      ...deps.agentManagerClient,
    };

    return Test.createTestingModule({
      providers: [
        FilterRulesSyncService,
        { provide: getRepositoryToken(AgentConsoleRegexFilterRuleSyncTargetEntity), useValue: targetsRepo },
        { provide: getRepositoryToken(AgentConsoleRegexFilterRuleEntity), useValue: {} },
        { provide: AgentManagerFilterRulesClientService, useValue: agentManagerClient },
      ],
    }).compile();
  };

  it('findPendingTargetIds returns ids from pending query', async () => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'target-1' }, { id: 'target-2' }]),
    };
    const targetsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const moduleRef = await createService({ targetsRepo });
    const svc = moduleRef.get(FilterRulesSyncService);

    await expect(svc.findPendingTargetIds(5)).resolves.toEqual(['target-1', 'target-2']);
    expect(qb.take).toHaveBeenCalledWith(5);
  });

  it('processTargetById returns early when target is missing', async () => {
    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const targetsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn(),
    };
    const agentManagerClient = { createRule: jest.fn() };
    const moduleRef = await createService({ targetsRepo, agentManagerClient });
    const svc = moduleRef.get(FilterRulesSyncService);

    await svc.processTargetById('missing');

    expect(agentManagerClient.createRule).not.toHaveBeenCalled();
    expect(targetsRepo.save).not.toHaveBeenCalled();
  });

  it('processTargetById creates remote rule when desired and no manager id', async () => {
    const target = createTarget();
    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(target),
    };
    const targetsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn().mockImplementation(async (row) => row),
    };
    const agentManagerClient = {
      createRule: jest.fn().mockResolvedValue({ id: 'remote-1' }),
    };
    const moduleRef = await createService({ targetsRepo, agentManagerClient });
    const svc = moduleRef.get(FilterRulesSyncService);

    await svc.processTargetById(target.id);

    expect(agentManagerClient.createRule).toHaveBeenCalledWith('client-1', {
      pattern: 'foo',
      regexFlags: 'i',
      direction: 'inbound',
      filterType: 'filter',
      replaceContent: 'bar',
      priority: 1,
    });
    expect(target.managerRuleId).toBe('remote-1');
    expect(target.syncStatus).toBe('synced');
    expect(target.lastError).toBeNull();
    expect(target.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('processTargetById updates remote rule when manager id exists', async () => {
    const target = createTarget({ managerRuleId: 'remote-1' });
    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(target),
    };
    const targetsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn().mockImplementation(async (row) => row),
    };
    const agentManagerClient = {
      updateRule: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await createService({ targetsRepo, agentManagerClient });
    const svc = moduleRef.get(FilterRulesSyncService);

    await svc.processTargetById(target.id);

    expect(agentManagerClient.updateRule).toHaveBeenCalledWith('client-1', 'remote-1', {
      pattern: 'foo',
      regexFlags: 'i',
      direction: 'inbound',
      filterType: 'filter',
      replaceContent: 'bar',
      priority: 1,
    });
    expect(target.syncStatus).toBe('synced');
  });

  it('processTargetById deletes remote rule when no longer desired', async () => {
    const target = createTarget({ desiredOnManager: false, managerRuleId: 'remote-1' });
    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(target),
    };
    const targetsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn().mockImplementation(async (row) => row),
    };
    const agentManagerClient = {
      deleteRule: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await createService({ targetsRepo, agentManagerClient });
    const svc = moduleRef.get(FilterRulesSyncService);

    await svc.processTargetById(target.id);

    expect(agentManagerClient.deleteRule).toHaveBeenCalledWith('client-1', 'remote-1');
    expect(target.managerRuleId).toBeNull();
    expect(target.syncStatus).toBe('synced');
  });

  it('processTargetById marks target failed when sync throws', async () => {
    const target = createTarget();
    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(target),
    };
    const targetsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn().mockImplementation(async (row) => row),
    };
    const agentManagerClient = {
      createRule: jest.fn().mockRejectedValue(new Error('remote down')),
    };
    const moduleRef = await createService({ targetsRepo, agentManagerClient });
    const svc = moduleRef.get(FilterRulesSyncService);
    const warn = jest.spyOn(svc['logger'], 'warn').mockImplementation();

    await svc.processTargetById(target.id);

    expect(target.syncStatus).toBe('failed');
    expect(target.lastError).toBe('remote down');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('processBatch returns 0 when query empty', async () => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const targetsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const moduleRef = await createService({ targetsRepo });
    const svc = moduleRef.get(FilterRulesSyncService);

    expect(await svc.processBatch(5)).toBe(0);
  });

  it('processBatch processes each pending target id', async () => {
    const pendingQb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'target-1' }]),
    };
    const target = createTarget();
    const targetQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(target),
    };
    const targetsRepo = {
      createQueryBuilder: jest.fn().mockReturnValueOnce(pendingQb).mockReturnValueOnce(targetQb),
      save: jest.fn().mockImplementation(async (row) => row),
    };
    const agentManagerClient = {
      createRule: jest.fn().mockResolvedValue({ id: 'remote-1' }),
    };
    const moduleRef = await createService({ targetsRepo, agentManagerClient });
    const svc = moduleRef.get(FilterRulesSyncService);

    await expect(svc.processBatch(1)).resolves.toBe(1);
    expect(agentManagerClient.createRule).toHaveBeenCalledTimes(1);
  });
});
