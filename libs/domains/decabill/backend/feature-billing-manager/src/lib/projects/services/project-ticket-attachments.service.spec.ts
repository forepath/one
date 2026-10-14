import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@forepath/identity/backend';

import { ProjectTicketActionType } from '../entities/project.enums';
import { ProjectTicketAttachmentsService } from './project-ticket-attachments.service';

jest.mock('../../utils/tenant-query.utils', () => ({ getRequiredTenantId: jest.fn(() => 'tenant-1') }));

describe('ProjectTicketAttachmentsService', () => {
  const project = { id: 'project-1', userId: 'user-1' };
  const ticket = { id: 'ticket-1', projectId: 'project-1', locked: false };
  const req = { user: { id: 'user-1', roles: [UserRole.ADMIN] } } as never;
  const projectsRepository = { findByIdOrThrow: jest.fn() };
  const ticketsRepository = { findByIdOrThrow: jest.fn() };
  const activitiesRepository = { create: jest.fn() };
  const attachmentsRepo = {
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ ...row, createdAt: new Date('2026-01-01T00:00:00.000Z') })),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };
  const fileStorage = { writeProjectTicketAttachmentFile: jest.fn(), readProjectTicketAttachmentFile: jest.fn() };
  const storedFileRegistry = { registerFromBuffer: jest.fn(async () => ({ id: 'stored-1' })) };
  const notificationPublisher = { publish: jest.fn() };
  const service = new ProjectTicketAttachmentsService(
    projectsRepository as never,
    ticketsRepository as never,
    activitiesRepository as never,
    attachmentsRepo as never,
    fileStorage as never,
    storedFileRegistry as never,
    notificationPublisher as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    projectsRepository.findByIdOrThrow.mockResolvedValue(project);
    ticketsRepository.findByIdOrThrow.mockResolvedValue(ticket);
  });

  it('stores uploaded ticket attachments in file storage and registry', async () => {
    const result = await service.upload(
      'project-1',
      'ticket-1',
      {
        buffer: Buffer.from('hello'),
        originalname: '../brief.txt',
        mimetype: 'text/plain',
      },
      req,
    );

    expect(result.fileName).toBe('brief.txt');
    expect(fileStorage.writeProjectTicketAttachmentFile).toHaveBeenCalledWith(
      expect.stringContaining('user-1/project-1/ticket-1/'),
      Buffer.from('hello'),
    );
    expect(storedFileRegistry.registerFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
    );
    expect(activitiesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: ProjectTicketActionType.ATTACHMENT_ADDED }),
    );
    expect(notificationPublisher.publish).toHaveBeenCalledWith(
      'ticket.attachment.created',
      expect.any(Object),
      'user-1',
    );
  });

  it('rejects missing attachment bytes', async () => {
    await expect(service.upload('project-1', 'ticket-1', undefined, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(fileStorage.writeProjectTicketAttachmentFile).not.toHaveBeenCalled();
  });
});
