import { ClientUsersRepository, UsersRepository } from '@forepath/identity/backend';
import { ensureWorkspaceManagementAccess } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketAutomationEntity } from '../entities/ticket-automation.entity';
import { TicketBodyGenerationSessionEntity } from '../entities/ticket-body-generation-session.entity';
import { TicketCommentEntity } from '../entities/ticket-comment.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketCreationTemplate, TicketPriority, TicketStatus } from '../entities/ticket.enums';
import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAutomationChatRealtimeService } from './client-automation-chat-realtime.service';
import { ClientsService } from './clients.service';
import { ExternalImportSyncMarkerService } from './external-import-sync-marker.service';
import { TicketAutomationService } from './ticket-automation.service';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { TicketsService } from './tickets.service';

jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return {
    ...actual,
    ensureClientAccess: jest.fn().mockResolvedValue(undefined),
    ensureWorkspaceManagementAccess: jest.fn().mockResolvedValue(undefined),
    getUserFromRequest: jest.fn().mockReturnValue({ userId: 'user-1', userRole: 'admin', isApiKeyAuth: false }),
  };
});

describe('TicketsService', () => {
  let service: TicketsService;
  const ticketId = '00000000-0000-4000-8000-000000000001';
  const clientId = '00000000-0000-4000-8000-0000000000c1';
  const agentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const agentB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ticketLongSha = '329ec4f443e9dd75319f770816c5c1ee337f2134';
  const ticketShortSha = '329ec4f';
  let ticket: TicketEntity;
  const commentRepo = {};
  const bodySessionRepo = {};
  const activityRepo = {
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
    find: jest.fn().mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-00000000a099',
        ticketId,
        occurredAt: new Date('2024-01-02T00:00:00.000Z'),
        actorType: 'human',
        actorUserId: 'user-1',
        actionType: 'FIELD_UPDATED',
        payload: {},
      },
    ]),
  };

  async function defaultManagerTransaction(fn: (em: unknown) => Promise<unknown>): Promise<unknown> {
    const em = {
      getRepository: (entity: unknown) => {
        if (entity === TicketEntity) {
          return { save: jest.fn().mockResolvedValue(undefined) };
        }

        if (entity === TicketActivityEntity) {
          return activityRepo;
        }

        throw new Error(`Unexpected repository for ${String(entity)}`);
      },
    };

    return fn(em);
  }

  function makeTicketQueryBuilder() {
    return {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
    };
  }

  const ticketRepo = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn(),
    createQueryBuilder: jest.fn().mockImplementation(() => makeTicketQueryBuilder()),
    manager: {
      transaction: jest.fn(defaultManagerTransaction),
    },
  };
  const ticketAutomationService = {
    invalidateAfterTicketFieldChanges: jest.fn().mockResolvedValue(undefined),
  };
  const ticketAutomationRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const usersRepository = {
    findById: jest.fn().mockResolvedValue(null),
  };
  const clientsService = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    ticket = {
      id: ticketId,
      clientId,
      parentId: null,
      title: 'Example',
      content: null,
      longSha: ticketLongSha,
      priority: TicketPriority.MEDIUM,
      status: TicketStatus.DRAFT,
      createdByUserId: null,
      preferredChatAgentId: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    } as unknown as TicketEntity;
    ticketRepo.findOne.mockResolvedValue(ticket);
    ticketRepo.find.mockResolvedValue([ticket]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketCommentEntity), useValue: commentRepo },
        { provide: getRepositoryToken(TicketActivityEntity), useValue: activityRepo },
        { provide: getRepositoryToken(TicketBodyGenerationSessionEntity), useValue: bodySessionRepo },
        { provide: getRepositoryToken(TicketAutomationEntity), useValue: ticketAutomationRepo },
        { provide: ClientsRepository, useValue: {} },
        { provide: ClientUsersRepository, useValue: {} },
        { provide: UsersRepository, useValue: usersRepository },
        { provide: ClientsService, useValue: clientsService },
        { provide: TicketAutomationService, useValue: ticketAutomationService },
        { provide: TicketBoardRealtimeService, useValue: { emitToClient: jest.fn() } },
        { provide: ClientAutomationChatRealtimeService, useValue: { emitTicketChatUpsert: jest.fn() } },
        {
          provide: ExternalImportSyncMarkerService,
          useValue: { applyTicketDeleteInTransaction: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(TicketsService);
  });

  describe('update preferredChatAgentId', () => {
    it('persists and returns preferredChatAgentId', async () => {
      const dto = await service.update(ticketId, { preferredChatAgentId: agentA }, undefined);

      expect(dto.preferredChatAgentId).toBe(agentA);
      expect(ticket.preferredChatAgentId).toBe(agentA);
      expect(ticketRepo.manager.transaction).toHaveBeenCalled();
      expect(activityRepo.save).toHaveBeenCalled();
    });

    it('clears preferredChatAgentId when set to null', async () => {
      ticket.preferredChatAgentId = agentA;
      const dto = await service.update(ticketId, { preferredChatAgentId: null }, undefined);

      expect(dto.preferredChatAgentId).toBeNull();
      expect(ticket.preferredChatAgentId).toBeNull();
    });

    it('skips transaction when value unchanged', async () => {
      ticket.preferredChatAgentId = agentB;
      const dto = await service.update(ticketId, { preferredChatAgentId: agentB }, undefined);

      expect(dto.preferredChatAgentId).toBe(agentB);
      expect(ticketRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('returns derived short and long shas', async () => {
      const dto = await service.update(ticketId, { preferredChatAgentId: agentA }, undefined);

      expect(dto.shas).toEqual({
        short: ticketShortSha,
        long: ticketLongSha,
      });
    });
  });

  describe('automationEligible on ticket response', () => {
    it('returns false when no ticket_automation row exists', async () => {
      ticketAutomationRepo.find.mockResolvedValue([]);
      const dto = await service.update(ticketId, { preferredChatAgentId: agentB }, undefined);

      expect(dto.automationEligible).toBe(false);
      expect(ticketAutomationRepo.find).toHaveBeenCalled();
    });

    it('returns eligible from ticket_automation when present', async () => {
      ticketAutomationRepo.find.mockResolvedValue([{ ticketId, eligible: true }]);
      const dto = await service.update(ticketId, { preferredChatAgentId: agentB }, undefined);

      expect(dto.automationEligible).toBe(true);
    });
  });

  describe('create', () => {
    let ticketSeq = 0;

    beforeEach(() => {
      ticketSeq = 0;
      ticketAutomationRepo.find.mockResolvedValue([]);
      activityRepo.find.mockImplementation(async (opts: { where: { ticketId: string } }) => {
        const tid = opts.where.ticketId;

        return [
          {
            id: '00000000-0000-4000-8000-00000000a099',
            ticketId: tid,
            occurredAt: new Date('2024-01-01T00:00:00.000Z'),
            actorType: 'human' as const,
            actorUserId: 'user-1',
            actionType: 'CREATED',
            payload: {},
          },
        ];
      });
      ticketRepo.manager.transaction.mockImplementation(async (fn: (em: unknown) => Promise<unknown>) => {
        const em = {
          getRepository: (entity: unknown) => {
            if (entity === TicketEntity) {
              return {
                create: (fields: Partial<TicketEntity>) => ({ ...fields }) as TicketEntity,
                save: jest.fn(async (entity: TicketEntity) => {
                  if (entity.id) {
                    return {
                      ...entity,
                      createdAt: entity.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
                      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
                    } as TicketEntity;
                  }

                  ticketSeq += 1;
                  const id = `00000000-0000-4000-8000-${String(ticketSeq).padStart(12, '0')}`;

                  return {
                    ...entity,
                    id,
                    createdAt: new Date('2024-01-01T00:00:00.000Z'),
                    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
                  } as TicketEntity;
                }),
              };
            }

            if (entity === TicketActivityEntity) {
              return activityRepo;
            }

            throw new Error(`Unexpected repository for ${String(entity)}`);
          },
        };

        return fn(em);
      });
    });

    afterEach(() => {
      ticketRepo.manager.transaction.mockImplementation(defaultManagerTransaction);
      activityRepo.find.mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-00000000a099',
          ticketId,
          occurredAt: new Date('2024-01-02T00:00:00.000Z'),
          actorType: 'human',
          actorUserId: 'user-1',
          actionType: 'FIELD_UPDATED',
          payload: {},
        },
      ]);
    });

    it('creates a single ticket when creationTemplate is empty', async () => {
      const result = await service.create({ clientId, title: 'Root', creationTemplate: undefined }, undefined);

      expect(result.title).toBe('Root');
      expect(result).not.toHaveProperty('createdChildTickets');
      expect(activityRepo.save).toHaveBeenCalledTimes(1);
    });

    it('creates parent and four children for specification template', async () => {
      const result = await service.create(
        {
          clientId,
          title: 'Feature',
          content: 'desc',
          creationTemplate: TicketCreationTemplate.SPECIFICATION,
        },
        undefined,
      );

      expect(result.title).toBe('Feature');
      expect(result.createdChildTickets).toHaveLength(4);
      expect(result.createdChildTickets?.map((c) => c.title)).toEqual([
        'Proposal',
        'Specifications',
        'Technical design',
        'Implementation plan',
      ]);
      expect(result.shas.short).toHaveLength(7);
      expect(result.shas.long).toHaveLength(40);
      expect(result.shas.long.startsWith(result.shas.short)).toBe(true);

      for (const child of result.createdChildTickets ?? []) {
        expect(child.shas.short).toHaveLength(7);
        expect(child.shas.long).toHaveLength(40);
        expect(child.shas.long.startsWith(child.shas.short)).toBe(true);
      }

      expect(activityRepo.save).toHaveBeenCalledTimes(5);
    });

    it('rejects specification template with parentId', async () => {
      ticketRepo.findOne.mockResolvedValueOnce({
        id: '00000000-0000-4000-8000-00000000aaaa',
        clientId,
        parentId: null,
        title: 'Parent',
        content: null,
        priority: TicketPriority.MEDIUM,
        status: TicketStatus.DRAFT,
        createdByUserId: null,
        preferredChatAgentId: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      } as TicketEntity);
      await expect(
        service.create(
          {
            parentId: '00000000-0000-4000-8000-00000000aaaa',
            title: 'Child',
            creationTemplate: TicketCreationTemplate.SPECIFICATION,
          },
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getPrototypePromptByClientSha', () => {
    const prototypeLeafTicket = {
      id: ticketId,
      clientId,
      parentId: null,
      title: 'Example',
      content: null,
      longSha: ticketLongSha,
      priority: TicketPriority.MEDIUM,
      status: TicketStatus.DRAFT,
      createdByUserId: null,
      preferredChatAgentId: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    } as TicketEntity;

    beforeEach(() => {
      ticketRepo.findOne.mockReset();
      ticketRepo.find.mockResolvedValue([]);
      ticketRepo.findOne.mockImplementation(async (opts?: unknown) => {
        const serialized = JSON.stringify(opts ?? {});

        if (serialized.includes(ticketLongSha) && serialized.includes(clientId)) {
          return prototypeLeafTicket;
        }

        return null;
      });
    });

    afterEach(() => {
      ticketRepo.find.mockResolvedValue([ticket]);
      ticketRepo.findOne.mockReset();
      ticketRepo.findOne.mockResolvedValue(ticket);
    });

    it('returns prompt for exact long sha', async () => {
      const result = await service.getPrototypePromptByClientSha(clientId, ticketLongSha);

      expect(result).not.toBeNull();
      expect(result?.prompt).toContain(prototypeLeafTicket.title);
    });

    it('returns prompt when resolving by short sha prefix via query builder', async () => {
      const qb = makeTicketQueryBuilder();

      (qb.getOne as jest.Mock).mockResolvedValue(prototypeLeafTicket);
      ticketRepo.createQueryBuilder.mockReturnValueOnce(qb as never);
      const result = await service.getPrototypePromptByClientSha(clientId, ticketShortSha);

      expect(ticketRepo.createQueryBuilder).toHaveBeenCalledWith('t');
      expect(result).not.toBeNull();
      expect(result?.prompt).toContain(prototypeLeafTicket.title);
    });

    it('returns null for missing sha', async () => {
      const result = await service.getPrototypePromptByClientSha(clientId, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');

      expect(result).toBeNull();
    });
  });

  describe('migrateTicket', () => {
    const targetClientId = '90000000-9000-4000-8000-0000000000c2';

    afterEach(() => {
      (ensureWorkspaceManagementAccess as jest.Mock).mockResolvedValue(undefined);
    });

    it('rejects when target workspace equals source', async () => {
      await expect(service.migrateTicket(ticketId, { targetClientId: clientId }, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('propagates Forbidden when workspace management is denied', async () => {
      (ensureWorkspaceManagementAccess as jest.Mock).mockRejectedValueOnce(new ForbiddenException('no'));
      await expect(service.migrateTicket(ticketId, { targetClientId: targetClientId }, undefined)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('requires workspace management on source and target before updating', async () => {
      (ensureWorkspaceManagementAccess as jest.Mock).mockClear();
      ticket.parentId = null;
      ticket.clientId = clientId;
      ticketRepo.findOne.mockResolvedValue({ ...ticket });
      ticketRepo.find.mockImplementation(async (opts?: { where?: Record<string, unknown> }) => {
        const w = opts?.where;

        if (w && w.clientId === clientId) {
          return [{ id: ticketId, parentId: null } as TicketEntity];
        }

        if (w && w.clientId === targetClientId) {
          return [{ ...ticket, clientId: targetClientId } as TicketEntity];
        }

        if (w && Object.prototype.hasOwnProperty.call(w, 'id')) {
          return [{ ...ticket, clientId: targetClientId } as TicketEntity];
        }

        return [];
      });
      ticketRepo.manager.transaction.mockImplementation(async (fn: (em: unknown) => Promise<unknown>) => {
        const em = {
          getRepository: (entity: unknown) => {
            if (entity === TicketEntity) {
              return { update: jest.fn().mockResolvedValue({ affected: 1 }) };
            }

            if (entity === TicketActivityEntity) {
              return activityRepo;
            }

            throw new Error(`Unexpected entity ${String(entity)}`);
          },
        };

        return fn(em);
      });

      await service.migrateTicket(ticketId, { targetClientId: targetClientId }, undefined);

      expect(ensureWorkspaceManagementAccess).toHaveBeenCalledTimes(2);
      expect(ensureWorkspaceManagementAccess).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.anything(),
        clientId,
        undefined,
      );
      expect(ensureWorkspaceManagementAccess).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.anything(),
        targetClientId,
        undefined,
      );
    });
  });
});
