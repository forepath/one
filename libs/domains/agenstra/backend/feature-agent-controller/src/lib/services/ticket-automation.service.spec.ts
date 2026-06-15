import { ClientUsersRepository } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketAutomationLeaseEntity } from '../entities/ticket-automation-lease.entity';
import { TicketAutomationRunStepEntity } from '../entities/ticket-automation-run-step.entity';
import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketAutomationLeaseStatus, TicketAutomationRunStatus } from '../entities/ticket-automation.enums';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketActionType, TicketStatus } from '../entities/ticket.enums';
import { ClientsRepository } from '../repositories/clients.repository';

import { TicketAutomationChatSyncService } from './ticket-automation-chat-sync.service';
import { TicketAutomationService } from './ticket-automation.service';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { TicketsService } from './tickets.service';

jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return {
    ...actual,
    ensureClientAccess: jest.fn().mockResolvedValue(undefined),
    getUserFromRequest: jest.fn().mockReturnValue({ userId: 'user-1', userRole: 'admin', isApiKeyAuth: false }),
  };
});

describe('TicketAutomationService', () => {
  let service: TicketAutomationService;
  const automationRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
    update: jest.fn(),
    manager: { query: jest.fn() },
  };
  const runRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), update: jest.fn() };
  const leaseRepo = { findOne: jest.fn(), save: jest.fn(), update: jest.fn() };
  const stepRepo = { find: jest.fn() };
  const ticketRepo = { findOne: jest.fn(), save: jest.fn() };
  const activityRepo = { save: jest.fn(), create: jest.fn((x: unknown) => x) };

  beforeEach(async () => {
    jest.clearAllMocks();
    activityRepo.save.mockImplementation((row: unknown) =>
      Promise.resolve({
        ...(row as object),
        id: '00000000-0000-4000-8000-00000000a001',
        occurredAt: new Date('2020-01-02'),
      }),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketAutomationService,
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: automationRepo },
        { provide: getRepositoryToken(TicketAutomationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(TicketAutomationLeaseEntity), useValue: leaseRepo },
        { provide: getRepositoryToken(TicketAutomationRunStepEntity), useValue: stepRepo },
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: ClientsRepository, useValue: {} },
        { provide: ClientUsersRepository, useValue: {} },
        { provide: TicketBoardRealtimeService, useValue: { emitToClient: jest.fn() } },
        { provide: TicketAutomationChatSyncService, useValue: { emitLiveRunUpdateFromEntity: jest.fn() } },
        {
          provide: TicketsService,
          useValue: {
            emitBoardTicketSnapshotInternal: jest.fn().mockResolvedValue(undefined),
            emitBoardTicketAndActivity: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(TicketAutomationService);
  });

  it('throws when ticket not found on getAutomation', async () => {
    ticketRepo.findOne.mockResolvedValue(null);
    await expect(service.getAutomation('00000000-0000-4000-8000-000000000001', undefined)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns automation dto when row exists', async () => {
    const tid = '00000000-0000-4000-8000-000000000002';

    ticketRepo.findOne.mockResolvedValue({
      id: tid,
      clientId: 'c1',
      status: TicketStatus.TODO,
    });
    automationRepo.findOne.mockResolvedValueOnce(null);
    automationRepo.save.mockImplementation(async (row: TicketAutomationEntity) =>
      Promise.resolve({
        ...row,
        allowedAgentIds: row.allowedAgentIds ?? [],
        requiresApproval: row.requiresApproval ?? false,
        consecutiveFailureCount: 0,
        createdAt: new Date('2020-01-01'),
        updatedAt: new Date('2020-01-01'),
      }),
    );
    const dto = await service.getAutomation(tid, undefined);

    expect(dto.ticketId).toBe(tid);
    expect(dto.eligible).toBe(false);
  });

  describe('patchAutomation', () => {
    const tid = '00000000-0000-4000-8000-000000000010';

    function baseTicket() {
      return { id: tid, clientId: 'c1', status: TicketStatus.TODO };
    }

    function baseAutomation(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        ticketId: tid,
        eligible: false,
        allowedAgentIds: [] as string[],
        includeWorkspaceContext: true,
        contextEnvironmentIds: [] as string[],
        autoEnrichmentEnabled: true,
        verifierProfile: null as { commands: Array<{ cmd: string; cwd?: string }> } | null,
        requiresApproval: false,
        approvedAt: null as Date | null,
        approvedByUserId: null as string | null,
        approvalBaselineTicketUpdatedAt: null as Date | null,
        defaultBranchOverride: null as string | null,
        automationBranchStrategy: 'reuse_per_ticket' as const,
        forceNewAutomationBranchNextRun: false,
        consecutiveFailureCount: 0,
        createdAt: new Date('2020-01-01'),
        updatedAt: new Date('2020-01-01'),
        ...overrides,
      };
    }

    beforeEach(() => {
      ticketRepo.findOne.mockResolvedValue(baseTicket());
      runRepo.find.mockResolvedValue([]);
      automationRepo.save.mockImplementation(async (row: object) => Promise.resolve({ ...(row as object) }));
    });

    it('logs eligibility change without approval invalidated when approval is not required', async () => {
      automationRepo.findOne.mockResolvedValue(baseAutomation({ eligible: false, requiresApproval: false }));
      await service.patchAutomation(tid, { eligible: true }, undefined);
      const types = activityRepo.save.mock.calls.map((c) => (c[0] as { actionType: string }).actionType);

      expect(types).toEqual([TicketActionType.AUTOMATION_ELIGIBILITY_CHANGED]);
    });

    it('logs approval requirement change only when turning off requirement (no approval invalidated)', async () => {
      const approvedAt = new Date('2024-06-01');

      automationRepo.findOne.mockResolvedValue(
        baseAutomation({
          requiresApproval: true,
          approvedAt,
          approvedByUserId: 'user-1',
        }),
      );
      await service.patchAutomation(tid, { requiresApproval: false }, undefined);
      const types = activityRepo.save.mock.calls.map((c) => (c[0] as { actionType: string }).actionType);

      expect(types).toEqual([TicketActionType.AUTOMATION_APPROVAL_REQUIREMENT_CHANGED]);
    });

    it('logs approval invalidated when prior approval existed and an eligibility change voids it', async () => {
      const approvedAt = new Date('2024-06-01');

      automationRepo.findOne.mockResolvedValue(
        baseAutomation({
          eligible: true,
          requiresApproval: true,
          approvedAt,
          approvedByUserId: 'user-1',
        }),
      );
      await service.patchAutomation(tid, { eligible: false }, undefined);
      const types = activityRepo.save.mock.calls.map((c) => (c[0] as { actionType: string }).actionType);

      expect(types).toEqual([
        TicketActionType.AUTOMATION_ELIGIBILITY_CHANGED,
        TicketActionType.AUTOMATION_APPROVAL_INVALIDATED,
      ]);
    });

    it('logs settings updated when allowed agents change', async () => {
      automationRepo.findOne.mockResolvedValue(baseAutomation({ allowedAgentIds: [] }));
      await service.patchAutomation(tid, { allowedAgentIds: ['00000000-0000-4000-8000-0000000000aa'] }, undefined);
      const types = activityRepo.save.mock.calls.map((c) => (c[0] as { actionType: string }).actionType);

      expect(types).toEqual([TicketActionType.AUTOMATION_SETTINGS_UPDATED]);
    });

    it('does not save or log when patch is a no-op', async () => {
      automationRepo.findOne.mockResolvedValue(
        baseAutomation({ eligible: true, allowedAgentIds: ['00000000-0000-4000-8000-0000000000aa'] }),
      );
      await service.patchAutomation(
        tid,
        {
          eligible: true,
          allowedAgentIds: ['00000000-0000-4000-8000-0000000000aa'],
        },
        undefined,
      );
      expect(automationRepo.save).not.toHaveBeenCalled();
      expect(activityRepo.save).not.toHaveBeenCalled();
    });

    it('saves forceNewAutomationBranchNextRun without other changes', async () => {
      automationRepo.findOne.mockResolvedValue(baseAutomation({ forceNewAutomationBranchNextRun: false }));
      await service.patchAutomation(tid, { forceNewAutomationBranchNextRun: true }, undefined);
      expect(automationRepo.save).toHaveBeenCalled();
      const types = activityRepo.save.mock.calls.map((c) => (c[0] as { actionType: string }).actionType);

      expect(types).toEqual([TicketActionType.AUTOMATION_SETTINGS_UPDATED]);
    });

    it('invalidates approval when automationBranchStrategy changes while approved', async () => {
      const approvedAt = new Date('2024-06-01');

      automationRepo.findOne.mockResolvedValue(
        baseAutomation({
          requiresApproval: true,
          approvedAt,
          approvedByUserId: 'user-1',
          automationBranchStrategy: 'reuse_per_ticket',
        }),
      );
      await service.patchAutomation(tid, { automationBranchStrategy: 'new_per_run' }, undefined);
      const types = activityRepo.save.mock.calls.map((c) => (c[0] as { actionType: string }).actionType);

      expect(types).toEqual([
        TicketActionType.AUTOMATION_SETTINGS_UPDATED,
        TicketActionType.AUTOMATION_APPROVAL_INVALIDATED,
      ]);
    });
  });

  describe('cancelRun', () => {
    const tid = '00000000-0000-4000-8000-000000000020';
    const rid = '00000000-0000-4000-8000-000000000021';

    it('refreshes approval baseline after restoring ticket status when automation was approved', async () => {
      const postCancelUpdatedAt = new Date('2026-04-17T20:00:00.000Z');

      ticketRepo.findOne.mockImplementation((opts: { select?: string[] }) => {
        if (opts?.select?.length === 1 && opts.select[0] === 'updatedAt') {
          return Promise.resolve({ updatedAt: postCancelUpdatedAt });
        }

        return Promise.resolve({ id: tid, clientId: 'c1', status: TicketStatus.IN_PROGRESS });
      });
      ticketRepo.save.mockImplementation((t: { updatedAt?: Date }) => {
        t.updatedAt = postCancelUpdatedAt;

        return Promise.resolve(t);
      });

      runRepo.findOne.mockResolvedValue({
        id: rid,
        ticketId: tid,
        status: TicketAutomationRunStatus.RUNNING,
        ticketStatusBefore: TicketStatus.TODO,
        updatedAt: new Date('2026-04-01'),
      });
      runRepo.save.mockImplementation((r: object) => Promise.resolve(r));

      leaseRepo.findOne.mockResolvedValue({
        ticketId: tid,
        status: TicketAutomationLeaseStatus.ACTIVE,
      });
      leaseRepo.save.mockImplementation((x: object) => Promise.resolve(x));

      automationRepo.findOne.mockResolvedValue({
        ticketId: tid,
        approvedAt: new Date('2026-04-17T08:09:00.000Z'),
        approvalBaselineTicketUpdatedAt: new Date('2026-04-15T10:00:00.000Z'),
      });

      await service.cancelRun(tid, rid, undefined);

      expect(automationRepo.update).toHaveBeenCalledWith(
        { ticketId: tid },
        { approvalBaselineTicketUpdatedAt: postCancelUpdatedAt },
      );
    });
  });

  describe('approve', () => {
    const tid = '00000000-0000-4000-8000-000000000030';

    it('copies approval baseline directly from tickets.updated_at via SQL update', async () => {
      ticketRepo.findOne.mockResolvedValue({
        id: tid,
        clientId: 'c1',
        status: TicketStatus.TODO,
        updatedAt: new Date('2026-04-17T08:09:00.123Z'),
      });
      automationRepo.findOne
        .mockResolvedValueOnce({
          ticketId: tid,
          requiresApproval: true,
          approvedAt: null,
        })
        .mockResolvedValueOnce({
          ticketId: tid,
          eligible: true,
          allowedAgentIds: [],
          verifierProfile: null,
          requiresApproval: true,
          approvedAt: new Date('2026-04-17T08:09:01.000Z'),
          approvedByUserId: 'user-1',
          approvalBaselineTicketUpdatedAt: new Date('2026-04-17T08:09:00.123Z'),
          consecutiveFailureCount: 0,
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-17T08:09:01.000Z'),
        });
      automationRepo.manager.query.mockResolvedValue(undefined);

      await service.approve(tid, undefined);

      expect(automationRepo.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('approval_baseline_ticket_updated_at = t.updated_at'),
        [tid, 'user-1'],
      );
      expect(activityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: TicketActionType.AUTOMATION_APPROVED,
          payload: { approvedByUserId: 'user-1' },
        }),
      );
    });
  });

  describe('unapprove', () => {
    const tid = '00000000-0000-4000-8000-000000000040';

    it('throws when no interactive user is present', async () => {
      const identity = jest.requireMock('@forepath/identity/backend') as {
        getUserFromRequest: jest.Mock;
      };

      identity.getUserFromRequest.mockReturnValueOnce({ userId: null, userRole: 'admin', isApiKeyAuth: true });
      ticketRepo.findOne.mockResolvedValue({ id: tid, clientId: 'c1', status: TicketStatus.TODO });

      await expect(service.unapprove(tid, undefined)).rejects.toThrow(ForbiddenException);
    });

    it('throws when approval is not required', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: tid, clientId: 'c1', status: TicketStatus.TODO });
      automationRepo.findOne.mockResolvedValue({
        ticketId: tid,
        requiresApproval: false,
        approvedAt: null,
      });

      await expect(service.unapprove(tid, undefined)).rejects.toThrow(BadRequestException);
    });

    it('clears approval fields, logs activity and returns updated config', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: tid, clientId: 'c1', status: TicketStatus.TODO });
      const row = {
        ticketId: tid,
        eligible: true,
        allowedAgentIds: [],
        verifierProfile: null,
        requiresApproval: true,
        approvedAt: new Date('2026-04-17T08:09:00.000Z'),
        approvedByUserId: 'user-1',
        approvalBaselineTicketUpdatedAt: new Date('2026-04-17T08:08:59.000Z'),
        defaultBranchOverride: null,
        nextRetryAt: null,
        consecutiveFailureCount: 0,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-17T08:09:00.000Z'),
      };

      automationRepo.findOne.mockResolvedValue(row);
      automationRepo.save.mockImplementation(async (r: typeof row) => Promise.resolve(r));
      runRepo.find.mockResolvedValue([]);

      const result = await service.unapprove(tid, undefined);

      expect(automationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: tid,
          approvedAt: null,
          approvedByUserId: null,
          approvalBaselineTicketUpdatedAt: null,
        }),
      );
      expect(activityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: TicketActionType.AUTOMATION_UNAPPROVED,
          payload: { unapprovedByUserId: 'user-1' },
        }),
      );
      expect(result.approvedAt).toBeNull();
      expect(result.approvedByUserId).toBeNull();
      expect(result.approvalBaselineTicketUpdatedAt).toBeNull();
    });
  });
});
