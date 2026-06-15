import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ClientAgentAutonomyEntity } from '../entities/client-agent-autonomy.entity';
import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketAutomationLeaseEntity } from '../entities/ticket-automation-lease.entity';
import { TicketAutomationRunStepEntity } from '../entities/ticket-automation-run-step.entity';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketAutomationFailureCode } from '../entities/ticket-automation.enums';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketActionType, TicketStatus } from '../entities/ticket.enums';
import { AGENSTRA_AUTOMATION_COMPLETE } from '../utils/automation-completion.constants';
import {
  ephemeralAutomationBranchNameForRun,
  stableAutomationBranchNameForTicket,
} from '../utils/ticket-automation-branch.constants';

import { AutonomousRunOrchestratorService } from './autonomous-run-orchestrator.service';
import { ClientAgentVcsProxyService } from './client-agent-vcs-proxy.service';
import { RemoteAgentsSessionService } from './remote-agents-session.service';
import { TicketAutomationChatSyncService } from './ticket-automation-chat-sync.service';
import { TicketAutomationService } from './ticket-automation.service';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { TicketsService } from './tickets.service';

function realtimeSideProviders(ticketIdForBoard: string) {
  return [
    { provide: TicketBoardRealtimeService, useValue: { emitToClient: jest.fn() } },
    { provide: TicketAutomationChatSyncService, useValue: { emitLiveRunUpdateFromEntity: jest.fn() } },
    { provide: TicketsService, useValue: { emitBoardTicketSnapshotInternal: jest.fn().mockResolvedValue(undefined) } },
    {
      provide: TicketAutomationService,
      useValue: {
        mapAutomationForBoard: jest.fn().mockReturnValue({
          ticketId: ticketIdForBoard,
          eligible: false,
          allowedAgentIds: [],
          verifierProfile: null,
          requiresApproval: false,
          approvedAt: null,
          approvedByUserId: null,
          approvalBaselineTicketUpdatedAt: null,
          defaultBranchOverride: null,
          automationBranchStrategy: 'reuse_per_ticket',
          forceNewAutomationBranchNextRun: false,
          nextRetryAt: null,
          consecutiveFailureCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    },
  ];
}

describe('AutonomousRunOrchestratorService', () => {
  const ticketId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const agentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const runId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const defaultGitStatusDirty = {
    isClean: false,
    currentBranch: 'automation/test',
    hasUnpushedCommits: false,
    aheadCount: 0,
    behindCount: 0,
    files: [{ path: 'f', status: 'M', type: 'unstaged' as const }],
  };

  function makeTransactionMock() {
    return jest.fn(async (fn: (em: unknown) => Promise<unknown>) => {
      const em = {
        getRepository: (entity: unknown) => {
          if (entity === TicketAutomationLeaseEntity) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              save: jest.fn().mockImplementation((row: { id?: string }) => Promise.resolve({ ...row, id: 'lease-1' })),
              create: (x: unknown) => x,
            };
          }

          if (entity === TicketAutomationRunEntity) {
            return {
              save: jest.fn().mockImplementation((row: { id?: string }) => Promise.resolve({ ...row, id: runId })),
              create: (x: unknown) => x,
            };
          }

          return {};
        },
      };

      return fn(em);
    });
  }

  it('processBatch completes when no candidates', async () => {
    const ticketRepo = {
      manager: { query: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: {} },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: {} },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: {} },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: {} },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: {} },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: {} },
        { provide: RemoteAgentsSessionService, useValue: { sendChatSync: jest.fn() } },
        { provide: ClientAgentVcsProxyService, useValue: {} },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);
    expect(ticketRepo.manager.query).toHaveBeenCalled();
    await module.close();
  });

  it('processBatch completes a run when agent returns completion marker and verifier passes', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        title: 'Test ticket',
        status: TicketStatus.TODO,
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const remoteChat = {
      sendChatSync: jest
        .fn()
        .mockResolvedValueOnce(`Done.\n${AGENSTRA_AUTOMATION_COMPLETE}\n`)
        .mockResolvedValueOnce('feat(automation): implement ticket'),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue(defaultGitStatusDirty),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(vcsProxy.fetch).toHaveBeenCalledWith(clientId, agentId);
    expect(vcsProxy.createBranch).toHaveBeenCalledWith(clientId, agentId, {
      name: stableAutomationBranchNameForTicket(ticketId),
      baseBranch: 'main',
    });
    expect(vcsProxy.switchBranch).not.toHaveBeenCalled();
    expect(remoteChat.sendChatSync).toHaveBeenCalledTimes(2);
    expect(vcsProxy.runVerifierCommands).toHaveBeenCalledWith(clientId, agentId, {
      commands: [{ cmd: 'echo ok' }],
      timeoutMs: 120_000,
    });
    expect(vcsProxy.commit).toHaveBeenCalledWith(clientId, agentId, {
      message: 'feat(automation): implement ticket',
    });
    expect(vcsProxy.push).toHaveBeenCalledWith(clientId, agentId, {});
    expect(ticketRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: ticketId, status: TicketStatus.PROTOTYPE }),
    );
    expect(leaseRepo.update).toHaveBeenCalled();
    expect(activityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: TicketActionType.AUTOMATION_SUCCEEDED, payload: { runId } }),
    );
    expect(automationRepo.update).toHaveBeenCalledWith({ ticketId }, { consecutiveFailureCount: 0, nextRetryAt: null });
    await module.close();
  });

  it('processBatch refreshes approval baseline on success when automation was approved', async () => {
    const postSaveUpdatedAt = new Date('2026-04-17T18:00:00.000Z');
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockImplementation((opts: { select?: string[] }) => {
        if (opts?.select?.length === 1 && opts.select[0] === 'updatedAt') {
          return Promise.resolve({ updatedAt: postSaveUpdatedAt });
        }

        return Promise.resolve({
          id: ticketId,
          clientId,
          title: 'Test ticket',
          status: TicketStatus.TODO,
        });
      }),
      save: jest.fn().mockImplementation((t: { updatedAt?: Date }) => {
        t.updatedAt = postSaveUpdatedAt;

        return Promise.resolve(t);
      }),
    };
    const approvedAt = new Date('2026-04-17T08:00:00.000Z');
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
        approvedAt,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const remoteChat = {
      sendChatSync: jest
        .fn()
        .mockResolvedValueOnce(`Done.\n${AGENSTRA_AUTOMATION_COMPLETE}\n`)
        .mockResolvedValueOnce('feat(automation): implement ticket'),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue(defaultGitStatusDirty),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(automationRepo.update).toHaveBeenCalledWith(
      { ticketId },
      {
        consecutiveFailureCount: 0,
        nextRetryAt: null,
        approvalBaselineTicketUpdatedAt: postSaveUpdatedAt,
      },
    );
    await module.close();
  });

  it('processBatch completes a run when allowedAgentIds is empty (any autonomy-enabled agent)', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        title: 'Test ticket',
        status: TicketStatus.TODO,
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const remoteChat = {
      sendChatSync: jest
        .fn()
        .mockResolvedValueOnce(`Done.\n${AGENSTRA_AUTOMATION_COMPLETE}\n`)
        .mockResolvedValueOnce('feat(automation): implement ticket'),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue(defaultGitStatusDirty),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(remoteChat.sendChatSync).toHaveBeenCalledTimes(2);
    expect(vcsProxy.push).toHaveBeenCalledWith(clientId, agentId, {});
    await module.close();
  });

  it('processBatch skips starting a run when agent is not in automation allowed list', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        status: TicketStatus.TODO,
      }),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: ['99999999-9999-4999-8999-999999999999'],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
      }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const transaction = jest.fn();
    const runRepo = {
      manager: { transaction },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: {} },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: {} },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: {} },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: { sendChatSync: jest.fn() } },
        { provide: ClientAgentVcsProxyService, useValue: {} },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(transaction).not.toHaveBeenCalled();
    await module.close();
  });

  it('processBatch fails run with timed_out when agent never emits completion marker', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({ id: ticketId, clientId, status: TicketStatus.TODO }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
        consecutiveFailureCount: 0,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 2,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({
        id: runId,
        ticketId,
        ticketStatusBefore: TicketStatus.TODO,
        branchName: 'automation/dddddddd',
        iterationCount: 2,
      }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
      find: jest.fn().mockResolvedValue([{ kind: 'agent_turn', excerpt: 'x' }]),
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest.fn().mockResolvedValue('still working, no marker yet'),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(remoteChat.sendChatSync).toHaveBeenCalledTimes(2);
    expect(activityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: TicketActionType.AUTOMATION_TIMED_OUT,
        payload: { runId, code: TicketAutomationFailureCode.AGENT_NO_COMPLETION_MARKER },
      }),
    );
    expect(leaseRepo.update).toHaveBeenCalled();
    await module.close();
  });

  it('processBatch fails run when verifier command exits non-zero', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({ id: ticketId, clientId, status: TicketStatus.TODO }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'npm test' }] },
        consecutiveFailureCount: 0,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 5,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({
        id: runId,
        ticketId,
        ticketStatusBefore: TicketStatus.TODO,
        branchName: 'automation/dddddddd',
        iterationCount: 1,
      }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
      find: jest.fn().mockResolvedValue([]),
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest.fn().mockResolvedValue(`ok\n${AGENSTRA_AUTOMATION_COMPLETE}\n`),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({
        results: [{ cmd: 'npm test', exitCode: 1, output: 'fail' }],
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(vcsProxy.runVerifierCommands).toHaveBeenCalled();
    expect(activityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: TicketActionType.AUTOMATION_FAILED,
        payload: { runId, code: TicketAutomationFailureCode.VERIFY_COMMAND_FAILED },
      }),
    );
    expect(leaseRepo.update).toHaveBeenCalled();
    await module.close();
  });

  it('processBatch refreshes approval baseline on verifier failure when automation was approved', async () => {
    const postFailSaveUpdatedAt = new Date('2026-04-17T16:00:00.000Z');
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockImplementation((opts: { select?: string[] }) => {
        if (opts?.select?.length === 1 && opts.select[0] === 'updatedAt') {
          return Promise.resolve({ updatedAt: postFailSaveUpdatedAt });
        }

        return Promise.resolve({ id: ticketId, clientId, status: TicketStatus.TODO });
      }),
      save: jest.fn().mockImplementation((t: { updatedAt?: Date }) => {
        t.updatedAt = postFailSaveUpdatedAt;

        return Promise.resolve(t);
      }),
    };
    const approvedAt = new Date('2026-04-17T08:09:00.000Z');
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'npm test' }] },
        consecutiveFailureCount: 1,
        approvedAt,
        approvalBaselineTicketUpdatedAt: new Date('2026-04-15T10:00:00.000Z'),
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 5,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({
        id: runId,
        ticketId,
        ticketStatusBefore: TicketStatus.TODO,
        branchName: 'automation/dddddddd',
        iterationCount: 1,
      }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
      find: jest.fn().mockResolvedValue([]),
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest.fn().mockResolvedValue(`ok\n${AGENSTRA_AUTOMATION_COMPLETE}\n`),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({
        results: [{ cmd: 'npm test', exitCode: 1, output: 'fail' }],
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(automationRepo.update).toHaveBeenCalledWith(
      { ticketId },
      expect.objectContaining({
        consecutiveFailureCount: 2,
        approvalBaselineTicketUpdatedAt: postFailSaveUpdatedAt,
        nextRetryAt: expect.any(Date),
      }),
    );
    await module.close();
  });

  it('processBatch fails run with provider error when VCS throws and releases lease', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({ id: ticketId, clientId, status: TicketStatus.TODO }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
        consecutiveFailureCount: 0,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 5,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({
        id: runId,
        ticketId,
        ticketStatusBefore: TicketStatus.TODO,
        branchName: null,
        iterationCount: 0,
      }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
      find: jest.fn().mockResolvedValue([]),
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = { sendChatSync: jest.fn() };
    const vcsProxy = {
      getBranches: jest.fn().mockRejectedValue(new Error('remote VCS down')),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(remoteChat.sendChatSync).not.toHaveBeenCalled();
    expect(activityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: TicketActionType.AUTOMATION_FAILED,
        payload: { runId, code: TicketAutomationFailureCode.AGENT_PROVIDER_ERROR },
      }),
    );
    expect(leaseRepo.update).toHaveBeenCalled();
    await module.close();
  });

  it('processBatch succeeds run when completion marker is seen but verifier profile has no commands', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({ id: ticketId, clientId, status: TicketStatus.TODO }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [] },
        consecutiveFailureCount: 0,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 5,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({
        id: runId,
        ticketId,
        ticketStatusBefore: TicketStatus.TODO,
        branchName: 'automation/dddddddd',
        iterationCount: 1,
      }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
      find: jest.fn().mockResolvedValue([]),
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest.fn().mockResolvedValue(`done\n${AGENSTRA_AUTOMATION_COMPLETE}\n`),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockResolvedValue({
        isClean: true,
        currentBranch: 'automation/test',
        hasUnpushedCommits: false,
        aheadCount: 0,
        behindCount: 0,
        files: [],
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(activityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: TicketActionType.AUTOMATION_SUCCEEDED,
        payload: { runId },
      }),
    );
    expect(automationRepo.update).toHaveBeenCalledWith({ ticketId }, { consecutiveFailureCount: 0, nextRetryAt: null });
    expect(leaseRepo.update).toHaveBeenCalled();
    await module.close();
  });

  it('processBatch sends pre-improve message before implementation when preImproveTicket is enabled', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        title: 'Test ticket',
        status: TicketStatus.TODO,
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 5,
        preImproveTicket: true,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest
        .fn()
        .mockResolvedValueOnce('pre-improve done')
        .mockResolvedValueOnce(`done\n${AGENSTRA_AUTOMATION_COMPLETE}\n`)
        .mockResolvedValueOnce('feat(automation): after pre-improve'),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue(defaultGitStatusDirty),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(remoteChat.sendChatSync).toHaveBeenCalledTimes(3);
    expect(remoteChat.sendChatSync.mock.calls[0][0].message).toContain('Improve ticket clarity only');
    expect(remoteChat.sendChatSync.mock.calls[1][0].message).toContain('Implement the ticket');
    expect(vcsProxy.push).toHaveBeenCalledWith(clientId, agentId, {});
    await module.close();
  });

  it('processBatch succeeds without git commit when working tree is clean after verify', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        title: 'Test ticket',
        status: TicketStatus.TODO,
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest.fn().mockResolvedValueOnce(`Done.\n${AGENSTRA_AUTOMATION_COMPLETE}\n`),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue({
        isClean: true,
        currentBranch: 'main',
        hasUnpushedCommits: false,
        aheadCount: 0,
        behindCount: 0,
        files: [],
      }),
      stageFiles: jest.fn(),
      commit: jest.fn(),
      push: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(remoteChat.sendChatSync).toHaveBeenCalledTimes(1);
    expect(vcsProxy.commit).not.toHaveBeenCalled();
    expect(vcsProxy.stageFiles).not.toHaveBeenCalled();
    expect(vcsProxy.push).not.toHaveBeenCalled();
    await module.close();
  });

  it('processBatch fails run when git commit throws after verify', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        title: 'Test ticket',
        status: TicketStatus.TODO,
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
        consecutiveFailureCount: 0,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({
        id: runId,
        ticketId,
        ticketStatusBefore: TicketStatus.TODO,
        branchName: 'automation/dddddddd',
        iterationCount: 1,
      }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
      find: jest.fn().mockResolvedValue([]),
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest
        .fn()
        .mockResolvedValueOnce(`Done.\n${AGENSTRA_AUTOMATION_COMPLETE}\n`)
        .mockResolvedValueOnce('feat(automation): ok'),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue(defaultGitStatusDirty),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockRejectedValue(new Error('commit rejected')),
      push: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(vcsProxy.push).not.toHaveBeenCalled();
    expect(activityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: TicketActionType.AUTOMATION_FAILED,
        payload: { runId, code: TicketAutomationFailureCode.COMMIT_FAILED },
      }),
    );
    await module.close();
  });

  it('processBatch fails run when git push throws after commit', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        title: 'Test ticket',
        status: TicketStatus.TODO,
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
        consecutiveFailureCount: 0,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({
        id: runId,
        ticketId,
        ticketStatusBefore: TicketStatus.TODO,
        branchName: 'automation/dddddddd',
        iterationCount: 1,
      }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
      find: jest.fn().mockResolvedValue([]),
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest
        .fn()
        .mockResolvedValueOnce(`Done.\n${AGENSTRA_AUTOMATION_COMPLETE}\n`)
        .mockResolvedValueOnce('feat(automation): ok'),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue(defaultGitStatusDirty),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockRejectedValue(new Error('push rejected')),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(vcsProxy.push).toHaveBeenCalledWith(clientId, agentId, {});
    expect(activityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: TicketActionType.AUTOMATION_FAILED,
        payload: { runId, code: TicketAutomationFailureCode.PUSH_FAILED },
      }),
    );
    await module.close();
  });

  it('processBatch reuses existing stable ticket branch when strategy is reuse_per_ticket', async () => {
    const stable = stableAutomationBranchNameForTicket(ticketId);
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        title: 'Test ticket',
        status: TicketStatus.TODO,
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
        automationBranchStrategy: 'reuse_per_ticket',
        forceNewAutomationBranchNextRun: false,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest
        .fn()
        .mockResolvedValueOnce(`Done.\n${AGENSTRA_AUTOMATION_COMPLETE}\n`)
        .mockResolvedValueOnce('feat(automation): implement ticket'),
    };
    const mainOnly = [{ name: 'main', isRemote: false }];
    const withStable = [...mainOnly, { name: stable, isRemote: false }];
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValueOnce(mainOnly).mockResolvedValue(withStable),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue(defaultGitStatusDirty),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(vcsProxy.switchBranch).toHaveBeenCalledWith(clientId, agentId, stable);
    expect(vcsProxy.createBranch).not.toHaveBeenCalled();
    await module.close();
  });

  it('processBatch uses ephemeral branch when strategy is new_per_run', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        title: 'Test ticket',
        status: TicketStatus.TODO,
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
        automationBranchStrategy: 'new_per_run',
        forceNewAutomationBranchNextRun: false,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest
        .fn()
        .mockResolvedValueOnce(`Done.\n${AGENSTRA_AUTOMATION_COMPLETE}\n`)
        .mockResolvedValueOnce('feat(automation): implement ticket'),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue(defaultGitStatusDirty),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(vcsProxy.createBranch).toHaveBeenCalledWith(clientId, agentId, {
      name: ephemeralAutomationBranchNameForRun(runId),
      baseBranch: 'main',
    });
    expect(vcsProxy.switchBranch).not.toHaveBeenCalled();
    await module.close();
  });

  it('processBatch clears forceNewAutomationBranchNextRun after starting ephemeral branch', async () => {
    const ticketRepo = {
      manager: {
        query: jest.fn().mockResolvedValue([{ ticket_id: ticketId, client_id: clientId, agent_id: agentId }]),
      },
      findOne: jest.fn().mockResolvedValue({
        id: ticketId,
        clientId,
        title: 'Test ticket',
        status: TicketStatus.TODO,
      }),
      save: jest.fn().mockImplementation((t) => Promise.resolve(t)),
    };
    const automationRepo = {
      findOne: jest.fn().mockResolvedValue({
        ticketId,
        allowedAgentIds: [agentId],
        verifierProfile: { commands: [{ cmd: 'echo ok' }] },
        automationBranchStrategy: 'reuse_per_ticket',
        forceNewAutomationBranchNextRun: true,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const autonomyRepo = {
      findOne: jest.fn().mockResolvedValue({
        clientId,
        agentId,
        maxRuntimeMs: 3_600_000,
        maxIterations: 20,
        preImproveTicket: false,
      }),
    };
    const runRepo = {
      manager: { transaction: makeTransactionMock() },
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const stepRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const activityRepo = {
      save: jest.fn().mockImplementation((row: unknown) => Promise.resolve(row)),
      create: (x: unknown) => x,
    };
    const leaseRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const remoteChat = {
      sendChatSync: jest
        .fn()
        .mockResolvedValueOnce(`Done.\n${AGENSTRA_AUTOMATION_COMPLETE}\n`)
        .mockResolvedValueOnce('feat(automation): implement ticket'),
    };
    const vcsProxy = {
      getBranches: jest.fn().mockResolvedValue([{ name: 'main', isRemote: false }]),
      fetch: jest.fn().mockResolvedValue(undefined),
      prepareCleanWorkspace: jest.fn().mockResolvedValue(undefined),
      createBranch: jest.fn().mockResolvedValue(undefined),
      switchBranch: jest.fn().mockResolvedValue(undefined),
      runVerifierCommands: jest.fn().mockResolvedValue({ results: [{ exitCode: 0, cmd: 'echo ok' }] }),
      getStatus: jest.fn().mockResolvedValue(defaultGitStatusDirty),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutonomousRunOrchestratorService,
        ...realtimeSideProviders(ticketId),
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: autonomyRepo },
        { provide: RemoteAgentsSessionService, useValue: remoteChat },
        { provide: ClientAgentVcsProxyService, useValue: vcsProxy },
      ],
    }).compile();
    const orchestrator = module.get(AutonomousRunOrchestratorService);

    await orchestrator.processBatch(3);

    expect(automationRepo.update).toHaveBeenCalledWith(
      { ticketId },
      expect.objectContaining({ forceNewAutomationBranchNextRun: false }),
    );
    expect(vcsProxy.createBranch).toHaveBeenCalledWith(clientId, agentId, {
      name: ephemeralAutomationBranchNameForRun(runId),
      baseBranch: 'main',
    });
    await module.close();
  });
});
