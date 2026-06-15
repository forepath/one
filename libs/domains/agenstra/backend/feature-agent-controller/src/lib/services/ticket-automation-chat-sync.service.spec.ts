import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketAutomationRunPhase, TicketAutomationRunStatus } from '../entities/ticket-automation.enums';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketPriority, TicketStatus } from '../entities/ticket.enums';

import { AgentConsoleStatusService } from './agent-console-status.service';
import { ClientAutomationChatRealtimeService } from './client-automation-chat-realtime.service';
import { TicketAutomationChatSyncService } from './ticket-automation-chat-sync.service';

describe('TicketAutomationChatSyncService', () => {
  let service: TicketAutomationChatSyncService;
  const runRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
  };
  const ticketRepo = { findOne: jest.fn() };
  const automationRepo = { findOne: jest.fn() };
  const chatRealtime = { emitToClient: jest.fn(), emitToSocket: jest.fn() };
  const agentConsoleStatusService = {
    onAutomationChatActivity: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    runRepo.createQueryBuilder.mockReturnValue(qb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketAutomationChatSyncService,
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: ClientAutomationChatRealtimeService, useValue: chatRealtime },
        { provide: AgentConsoleStatusService, useValue: agentConsoleStatusService },
      ],
    }).compile();

    service = module.get(TicketAutomationChatSyncService);
  });

  it('hydrateForAgentClient queries bounded runs and emits per row', async () => {
    const run = {
      id: 'r1',
      ticketId: 't1',
      clientId: 'c1',
      agentId: 'a1',
      status: TicketAutomationRunStatus.SUCCEEDED,
      phase: TicketAutomationRunPhase.FINALIZE,
      ticketStatusBefore: TicketStatus.TODO,
      startedAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-02'),
      finishedAt: new Date('2020-01-02'),
      iterationCount: 1,
      completionMarkerSeen: true,
      verificationPassed: true,
      failureCode: null,
      summary: null,
      cancelRequestedAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
    } as TicketAutomationRunEntity;

    runRepo.createQueryBuilder().getMany.mockResolvedValue([run]);
    ticketRepo.findOne.mockResolvedValue({
      id: 't1',
      clientId: 'c1',
      title: 'Hello',
      priority: TicketPriority.MEDIUM,
      status: TicketStatus.TODO,
      preferredChatAgentId: null,
      createdAt: new Date('2019-12-01'),
      updatedAt: new Date('2019-12-02'),
    });
    automationRepo.findOne.mockResolvedValue({ eligible: true });
    const socket = { connected: true, emit: jest.fn() } as never;

    await service.hydrateForAgentClient(socket, 'c1', 'a1');
    expect(runRepo.createQueryBuilder).toHaveBeenCalled();
    expect(chatRealtime.emitToSocket).toHaveBeenCalledTimes(1);
    const payload = (chatRealtime.emitToSocket as jest.Mock).mock.calls[0][1] as {
      hydrate: boolean;
      run: { id: string };
    };

    expect(payload.hydrate).toBe(true);
    expect(payload.run.id).toBe('r1');
    expect(agentConsoleStatusService.onAutomationChatActivity).not.toHaveBeenCalled();
  });

  it('emitLiveRunUpdateFromEntity notifies status service', async () => {
    const run = {
      id: 'r1',
      ticketId: 't1',
      clientId: 'c1',
      agentId: 'a1',
      status: TicketAutomationRunStatus.SUCCEEDED,
      phase: TicketAutomationRunPhase.FINALIZE,
      ticketStatusBefore: TicketStatus.TODO,
      startedAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-02'),
      finishedAt: new Date('2020-01-02'),
      iterationCount: 1,
      completionMarkerSeen: true,
      verificationPassed: true,
      failureCode: null,
      summary: null,
      cancelRequestedAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
    } as TicketAutomationRunEntity;

    ticketRepo.findOne.mockResolvedValue({
      id: 't1',
      clientId: 'c1',
      title: 'Hello',
      priority: TicketPriority.MEDIUM,
      status: TicketStatus.TODO,
      preferredChatAgentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    automationRepo.findOne.mockResolvedValue({ eligible: true });

    service.emitLiveRunUpdateFromEntity(run);

    await new Promise((resolve) => setImmediate(resolve));

    expect(chatRealtime.emitToClient).toHaveBeenCalled();
    expect(agentConsoleStatusService.onAutomationChatActivity).toHaveBeenCalledWith('c1', 'a1', run.updatedAt);
  });
});
