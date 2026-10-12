import { BadRequestException } from '@nestjs/common';

import { AgenstraAttachmentOwnerType } from '../entities/attachment.enums';
import { KnowledgeNodeType } from '../entities/knowledge-node.enums';
import { AgenstraAttachmentsService } from './agenstra-attachments.service';

describe('AgenstraAttachmentsService', () => {
  const attachmentRepo = {
    save: jest.fn(async (row) => ({ ...row, createdAt: new Date('2026-01-01T00:00:00.000Z') })),
    create: jest.fn((row) => row),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };
  const ticketRepo = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const knowledgeRepo = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const ticketActivityRepo = { create: jest.fn((row) => row), save: jest.fn() };
  const knowledgeActivityRepo = { create: jest.fn((row) => row), save: jest.fn() };
  const clientsRepository = { findByIdOrThrow: jest.fn() };
  const fileStorage = { writeAgenstraAttachmentFile: jest.fn(), readAgenstraAttachmentFile: jest.fn() };
  const fileSystemProxy = { writeFile: jest.fn() };
  const notificationPublisher = { publishAttachment: jest.fn() };

  const service = new AgenstraAttachmentsService(
    attachmentRepo as never,
    ticketRepo as never,
    knowledgeRepo as never,
    ticketActivityRepo as never,
    knowledgeActivityRepo as never,
    clientsRepository as never,
    fileStorage as never,
    fileSystemProxy as never,
    notificationPublisher as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('stores ticket attachments under generated keys and records activity', async () => {
    ticketRepo.findOne.mockResolvedValue({ id: 'ticket-1', clientId: 'client-1' });

    const result = await service.uploadForTicket(
      'ticket-1',
      { buffer: Buffer.from('hello'), originalname: '../notes.txt', mimetype: 'text/plain' },
      'user-1',
    );

    expect(result.fileName).toBe('notes.txt');
    expect(result.ownerType).toBe(AgenstraAttachmentOwnerType.TICKET);
    expect(fileStorage.writeAgenstraAttachmentFile).toHaveBeenCalledWith(
      expect.stringContaining('client-1/ticket/ticket-1/'),
      Buffer.from('hello'),
    );
    expect(ticketActivityRepo.save).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'ATTACHMENT_ADDED' }));
    expect(notificationPublisher.publishAttachment).toHaveBeenCalledWith('attachment.created', result);
  });

  it('rejects missing files before storing bytes', async () => {
    ticketRepo.findOne.mockResolvedValue({ id: 'ticket-1', clientId: 'client-1' });

    await expect(service.uploadForTicket('ticket-1', undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(fileStorage.writeAgenstraAttachmentFile).not.toHaveBeenCalled();
  });

  it('mirrors attachment context into the agent read-only context path', async () => {
    const row = {
      id: 'att-1',
      clientId: 'client-1',
      ownerType: AgenstraAttachmentOwnerType.CHAT,
      ownerId: 'owner-1',
      fileName: 'brief.pdf',
      contentType: 'application/pdf',
      byteSize: '3',
      storageKey: 'k',
      contentSha256: 'abc',
      createdByUserId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    attachmentRepo.find.mockResolvedValue([row]);
    fileStorage.readAgenstraAttachmentFile.mockResolvedValue(Buffer.from('pdf'));

    const result = await service.resolveContextAttachments({
      clientId: 'client-1',
      agentId: 'agent-1',
      attachmentIds: ['att-1'],
    });

    expect(fileSystemProxy.writeFile).toHaveBeenCalledWith(
      'client-1',
      'agent-1',
      expect.stringContaining('/opt/agenstra/context/client-1/chat/owner-1/att-1-brief.pdf'),
      Buffer.from('pdf'),
      'app',
      { contentType: 'application/pdf' },
    );
    expect(result[0].agentPath).toContain('/opt/agenstra/context/client-1/chat/owner-1/att-1-brief.pdf');
  });

  it('stores knowledge page attachments only for pages', async () => {
    knowledgeRepo.findOne.mockResolvedValue({ id: 'page-1', clientId: 'client-1', nodeType: KnowledgeNodeType.PAGE });

    const result = await service.uploadForKnowledgePage('page-1', { buffer: Buffer.from('x'), originalname: 'p.md' });

    expect(result.ownerType).toBe(AgenstraAttachmentOwnerType.KNOWLEDGE_PAGE);
    expect(knowledgeActivityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'ATTACHMENT_ADDED' }),
    );
  });
});
