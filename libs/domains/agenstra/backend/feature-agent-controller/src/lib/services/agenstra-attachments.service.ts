import { randomUUID } from 'crypto';
import * as path from 'path';

import { FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AttachmentResponseDto } from '../dto/attachment.dto';
import { AgenstraAttachmentEntity } from '../entities/agenstra-attachment.entity';
import { AgenstraAttachmentOwnerType } from '../entities/attachment.enums';
import { KnowledgePageActivityEntity } from '../entities/knowledge-page-activity.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { KnowledgeActionType, KnowledgeActorType, KnowledgeNodeType } from '../entities/knowledge-node.enums';
import { TicketActivityEntity } from '../entities/ticket-activity.entity';
import { TicketEntity } from '../entities/ticket.entity';
import { TicketActionType, TicketActorType } from '../entities/ticket.enums';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentFileSystemProxyService } from './client-agent-file-system-proxy.service';

export type UploadedAttachmentFile = { buffer: Buffer; size?: number; originalname?: string; mimetype?: string };

export interface AttachmentContextReference {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  agentPath: string;
  downloadUrl: string;
}

const MAX_ATTACHMENT_BYTES = Number.parseInt(process.env.AGENSTRA_ATTACHMENT_MAX_BYTES || `${25 * 1024 * 1024}`, 10);

@Injectable()
export class AgenstraAttachmentsService {
  constructor(
    @InjectRepository(AgenstraAttachmentEntity)
    private readonly attachmentRepo: Repository<AgenstraAttachmentEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepo: Repository<TicketEntity>,
    @InjectRepository(KnowledgeNodeEntity)
    private readonly knowledgeRepo: Repository<KnowledgeNodeEntity>,
    @InjectRepository(TicketActivityEntity)
    private readonly ticketActivityRepo: Repository<TicketActivityEntity>,
    @InjectRepository(KnowledgePageActivityEntity)
    private readonly knowledgeActivityRepo: Repository<KnowledgePageActivityEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly fileStorage: FileStorageService,
    private readonly fileSystemProxy: ClientAgentFileSystemProxyService,
    private readonly notificationPublisher: AgenstraNotificationPublisher,
  ) {}

  async uploadForTicket(ticketId: string, file: UploadedAttachmentFile | undefined, userId?: string | null) {
    return await this.store(
      AgenstraAttachmentOwnerType.TICKET,
      ticketId,
      await this.getTicketClientId(ticketId),
      file,
      userId,
    );
  }

  async uploadForKnowledgePage(pageId: string, file: UploadedAttachmentFile | undefined, userId?: string | null) {
    return await this.store(
      AgenstraAttachmentOwnerType.KNOWLEDGE_PAGE,
      pageId,
      await this.getKnowledgePageClientId(pageId),
      file,
      userId,
    );
  }

  async getTicketClientId(ticketId: string): Promise<string> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId }, select: ['id', 'clientId'] });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket.clientId;
  }

  async getKnowledgePageClientId(pageId: string): Promise<string> {
    const page = await this.knowledgeRepo.findOne({ where: { id: pageId }, select: ['id', 'clientId', 'nodeType'] });
    if (!page || page.nodeType !== KnowledgeNodeType.PAGE) throw new NotFoundException('Knowledge page not found');
    return page.clientId;
  }

  async uploadForChat(clientId: string, file: UploadedAttachmentFile | undefined, userId?: string | null) {
    await this.clientsRepository.findByIdOrThrow(clientId);
    return await this.store(AgenstraAttachmentOwnerType.CHAT, randomUUID(), clientId, file, userId);
  }

  async listForOwner(ownerType: AgenstraAttachmentOwnerType, ownerId: string): Promise<AttachmentResponseDto[]> {
    const rows = await this.attachmentRepo.find({ where: { ownerType, ownerId }, order: { createdAt: 'ASC' } });
    return rows.map((row) => this.toDto(row));
  }

  async deleteForOwner(
    ownerType: AgenstraAttachmentOwnerType,
    ownerId: string,
    attachmentId: string,
    userId?: string | null,
  ): Promise<void> {
    const row = await this.getForOwner(ownerType, ownerId, attachmentId);
    const dto = this.toDto(row);
    await this.attachmentRepo.remove(row);
    await this.recordAttachmentActivity(dto, userId ?? null, 'removed');
    this.notificationPublisher.publishAttachment('attachment.deleted', dto);
  }

  async getForOwner(
    ownerType: AgenstraAttachmentOwnerType,
    ownerId: string,
    attachmentId: string,
  ): Promise<AgenstraAttachmentEntity> {
    const row = await this.attachmentRepo.findOne({ where: { id: attachmentId, ownerType, ownerId } });
    if (!row) throw new NotFoundException('Attachment not found');
    return row;
  }

  async readForDownload(attachmentId: string): Promise<{ meta: AttachmentResponseDto; buffer: Buffer }> {
    const row = await this.getById(attachmentId);
    const buffer = await this.fileStorage.readAgenstraAttachmentFile(row.storageKey);
    return { meta: this.toDto(row), buffer };
  }

  async getById(attachmentId: string): Promise<AgenstraAttachmentEntity> {
    const row = await this.attachmentRepo.findOne({ where: { id: attachmentId } });
    if (!row) throw new NotFoundException('Attachment not found');
    return row;
  }

  async assertAttachmentClient(attachmentId: string, clientId: string): Promise<AgenstraAttachmentEntity> {
    const row = await this.attachmentRepo.findOne({ where: { id: attachmentId, clientId } });
    if (!row) throw new NotFoundException('Attachment not found');
    return row;
  }

  async resolveContextAttachments(params: {
    clientId: string;
    agentId: string;
    attachmentIds?: string[];
    ticketShas?: string[];
    knowledgeShas?: string[];
  }): Promise<AttachmentContextReference[]> {
    const rows: AgenstraAttachmentEntity[] = [];
    const explicitIds = [...new Set((params.attachmentIds ?? []).filter(Boolean))];
    if (explicitIds.length) {
      rows.push(...(await this.attachmentRepo.find({ where: { id: In(explicitIds), clientId: params.clientId } })));
    }

    const ticketIds = await this.resolveTicketIds(params.clientId, params.ticketShas ?? []);
    if (ticketIds.length) {
      rows.push(
        ...(await this.attachmentRepo.find({
          where: { clientId: params.clientId, ownerType: AgenstraAttachmentOwnerType.TICKET, ownerId: In(ticketIds) },
        })),
      );
    }

    const pageIds = await this.resolveKnowledgePageIds(params.clientId, params.knowledgeShas ?? []);
    if (pageIds.length) {
      rows.push(
        ...(await this.attachmentRepo.find({
          where: {
            clientId: params.clientId,
            ownerType: AgenstraAttachmentOwnerType.KNOWLEDGE_PAGE,
            ownerId: In(pageIds),
          },
        })),
      );
    }

    const unique = Array.from(new Map(rows.map((row) => [row.id, row])).values());
    const mirrored: AttachmentContextReference[] = [];
    for (const row of unique) {
      const agentPath = this.agentContextPath(row);
      const buffer = await this.fileStorage.readAgenstraAttachmentFile(row.storageKey);
      await this.fileSystemProxy.writeSystemFile(params.clientId, params.agentId, agentPath, buffer, {
        contentType: row.contentType,
      });
      mirrored.push({
        id: row.id,
        fileName: row.fileName,
        contentType: row.contentType,
        byteSize: Number(row.byteSize),
        agentPath,
        downloadUrl: `/api/attachments/${row.id}/download`,
      });
    }
    return mirrored;
  }

  private async resolveTicketIds(clientId: string, shas: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const raw of shas) {
      const sha = raw.trim().toLowerCase();
      if (!sha) continue;
      const qb = this.ticketRepo
        .createQueryBuilder('t')
        .select(['t.id'])
        .where('t.client_id = :clientId', { clientId });
      if (sha.length >= 40) qb.andWhere('t.long_sha = :sha', { sha: sha.slice(0, 40) });
      else qb.andWhere('t.long_sha LIKE :prefix', { prefix: `${sha}%` });
      const row = await qb.orderBy('t.created_at', 'DESC').getOne();
      if (row?.id) ids.push(row.id);
    }
    return [...new Set(ids)];
  }

  private async resolveKnowledgePageIds(clientId: string, shas: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const raw of shas) {
      const sha = raw.trim().toLowerCase();
      if (!sha) continue;
      const qb = this.knowledgeRepo
        .createQueryBuilder('n')
        .select(['n.id'])
        .where('n.client_id = :clientId', { clientId })
        .andWhere('n.node_type = :nodeType', { nodeType: KnowledgeNodeType.PAGE });
      if (sha.length >= 40) qb.andWhere('n.long_sha = :sha', { sha: sha.slice(0, 40) });
      else qb.andWhere('n.long_sha LIKE :prefix', { prefix: `${sha}%` });
      const row = await qb.orderBy('n.created_at', 'DESC').getOne();
      if (row?.id) ids.push(row.id);
    }
    return [...new Set(ids)];
  }

  private async store(
    ownerType: AgenstraAttachmentOwnerType,
    ownerId: string,
    clientId: string,
    file: UploadedAttachmentFile | undefined,
    userId?: string | null,
  ): Promise<AttachmentResponseDto> {
    if (!file?.buffer?.length) throw new BadRequestException('Attachment file is required');
    const size = file.size ?? file.buffer.byteLength;
    if (size > MAX_ATTACHMENT_BYTES) throw new PayloadTooLargeException('Attachment exceeds maximum size');
    const fileName = this.sanitizeFileName(file.originalname || 'attachment');
    const id = randomUUID();
    const storageKey = `${clientId}/${ownerType}/${ownerId}/${id}/${fileName}`;
    await this.fileStorage.writeAgenstraAttachmentFile(storageKey, file.buffer);
    const row = await this.attachmentRepo.save(
      this.attachmentRepo.create({
        id,
        clientId,
        ownerType,
        ownerId,
        fileName,
        contentType: file.mimetype || 'application/octet-stream',
        byteSize: String(size),
        storageKey,
        contentSha256: AgenstraAttachmentEntity.contentSha256(file.buffer),
        createdByUserId: userId ?? null,
      }),
    );
    const dto = this.toDto(row);
    await this.recordAttachmentActivity(dto, userId ?? null, 'added');
    this.notificationPublisher.publishAttachment('attachment.created', dto);
    return dto;
  }

  private async recordAttachmentActivity(
    attachment: AttachmentResponseDto,
    userId: string | null,
    op: 'added' | 'removed',
  ): Promise<void> {
    const payload = { attachmentId: attachment.id, fileName: attachment.fileName, byteSize: attachment.byteSize };

    if (attachment.ownerType === AgenstraAttachmentOwnerType.TICKET) {
      await this.ticketActivityRepo.save(
        this.ticketActivityRepo.create({
          ticketId: attachment.ownerId,
          actorType: userId ? TicketActorType.HUMAN : TicketActorType.SYSTEM,
          actorUserId: userId,
          actionType: op === 'added' ? TicketActionType.ATTACHMENT_ADDED : TicketActionType.ATTACHMENT_REMOVED,
          payload,
        }),
      );
    } else if (attachment.ownerType === AgenstraAttachmentOwnerType.KNOWLEDGE_PAGE) {
      await this.knowledgeActivityRepo.save(
        this.knowledgeActivityRepo.create({
          pageId: attachment.ownerId,
          actorType: userId ? KnowledgeActorType.HUMAN : KnowledgeActorType.SYSTEM,
          actorUserId: userId,
          actionType: op === 'added' ? KnowledgeActionType.ATTACHMENT_ADDED : KnowledgeActionType.ATTACHMENT_REMOVED,
          payload,
        }),
      );
    }
  }

  private sanitizeFileName(name: string): string {
    const base = path
      .basename(name.replace(/\\/g, '/'))
      // Control characters are rejected by the agent-manager file APIs (mirrored context path).
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();
    return (base || 'attachment').slice(0, 255);
  }

  private agentContextPath(row: AgenstraAttachmentEntity): string {
    // Re-sanitize: rows stored before control-character stripping must still yield a valid manager path.
    return `/opt/agenstra/context/${row.clientId}/${row.ownerType}/${row.ownerId}/${row.id}-${this.sanitizeFileName(row.fileName)}`;
  }

  private toDto(row: AgenstraAttachmentEntity): AttachmentResponseDto {
    return {
      id: row.id,
      clientId: row.clientId,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      fileName: row.fileName,
      contentType: row.contentType,
      byteSize: Number(row.byteSize),
      contentSha256: row.contentSha256,
      downloadUrl: `/api/attachments/${row.id}/download`,
      agentPath: this.agentContextPath(row),
      createdByUserId: row.createdByUserId ?? null,
      createdAt: row.createdAt,
    };
  }
}
