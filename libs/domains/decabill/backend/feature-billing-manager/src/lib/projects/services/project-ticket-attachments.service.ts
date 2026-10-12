import { randomUUID } from 'crypto';
import * as path from 'path';

import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { StoredFileRegistryService } from '../../services/stored-file-registry.service';
import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { ProjectTicketAttachmentResponseDto } from '../dto/project-ticket-attachment.dto';
import { ProjectTicketAttachmentEntity } from '../entities/project-ticket-attachment.entity';
import { ProjectTicketActionType, ProjectTicketActorType } from '../entities/project.enums';
import { ProjectTicketActivitiesRepository } from '../repositories/project-ticket-activities.repository';
import { ProjectTicketsRepository } from '../repositories/project-tickets.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ensureProjectAdmin, ensureProjectReadable, ensureTicketUnlocked } from '../utils/project-access.utils';
import type { RequestWithUser } from '../../utils/billing-access.utils';
import { getUserFromRequest } from '../../utils/billing-access.utils';

export type UploadedProjectTicketAttachment = {
  buffer: Buffer;
  size?: number;
  originalname?: string;
  mimetype?: string;
};

const MAX_ATTACHMENT_BYTES = Number.parseInt(
  process.env.DECABILL_TICKET_ATTACHMENT_MAX_BYTES || `${25 * 1024 * 1024}`,
  10,
);

@Injectable()
export class ProjectTicketAttachmentsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly ticketsRepository: ProjectTicketsRepository,
    private readonly activitiesRepository: ProjectTicketActivitiesRepository,
    @InjectRepository(ProjectTicketAttachmentEntity)
    private readonly attachmentsRepo: Repository<ProjectTicketAttachmentEntity>,
    private readonly fileStorage: FileStorageService,
    private readonly storedFileRegistry: StoredFileRegistryService,
    private readonly notificationPublisher: BillingNotificationPublisher,
  ) {}

  async list(projectId: string, ticketId: string, req: RequestWithUser): Promise<ProjectTicketAttachmentResponseDto[]> {
    await this.assertReadable(projectId, ticketId, req);
    const rows = await this.attachmentsRepo.find({ where: { ticketId }, order: { createdAt: 'ASC' } });
    return rows.map((row) => this.toDto(row, projectId));
  }

  async upload(
    projectId: string,
    ticketId: string,
    file: UploadedProjectTicketAttachment | undefined,
    req: RequestWithUser,
  ) {
    const { project, ticket, userInfo } = await this.assertWritable(projectId, ticketId, req);
    if (!file?.buffer?.length) throw new BadRequestException('Attachment file is required');
    const size = file.size ?? file.buffer.byteLength;
    if (size > MAX_ATTACHMENT_BYTES) throw new PayloadTooLargeException('Attachment exceeds maximum size');
    const fileName = this.sanitizeFileName(file.originalname || 'attachment');
    const id = randomUUID();
    const storageKey = `${project.userId}/${projectId}/${ticketId}/${id}/${fileName}`;
    await this.fileStorage.writeProjectTicketAttachmentFile(storageKey, file.buffer);
    const stored = await this.storedFileRegistry.registerFromBuffer({
      tenantId: getRequiredTenantId(),
      scope: FileStorageScope.projectTicketAttachments,
      storageKey,
      content: file.buffer,
    });
    const row = await this.attachmentsRepo.save(
      this.attachmentsRepo.create({
        id,
        ticketId: ticket.id,
        fileName,
        contentType: file.mimetype || 'application/octet-stream',
        byteSize: String(size),
        storageKey,
        storedFileId: stored.id,
        createdByUserId: userInfo.userId ?? null,
      }),
    );
    await this.activitiesRepository.create({
      ticketId,
      actorType: ProjectTicketActorType.HUMAN,
      actorUserId: userInfo.userId ?? null,
      actionType: ProjectTicketActionType.ATTACHMENT_ADDED,
      payload: { attachmentId: row.id, fileName: row.fileName, byteSize: Number(row.byteSize) },
    });
    const dto = this.toDto(row, projectId);
    this.notificationPublisher.publish('ticket.attachment.created', { ...dto, projectId }, project.userId);
    return dto;
  }

  async delete(projectId: string, ticketId: string, attachmentId: string, req: RequestWithUser): Promise<void> {
    const { project, userInfo } = await this.assertWritable(projectId, ticketId, req);
    const row = await this.attachmentsRepo.findOne({ where: { id: attachmentId, ticketId } });
    if (!row) throw new NotFoundException('Attachment not found');
    await this.attachmentsRepo.remove(row);
    await this.activitiesRepository.create({
      ticketId,
      actorType: ProjectTicketActorType.HUMAN,
      actorUserId: userInfo.userId ?? null,
      actionType: ProjectTicketActionType.ATTACHMENT_REMOVED,
      payload: { attachmentId: row.id, fileName: row.fileName, byteSize: Number(row.byteSize) },
    });
    this.notificationPublisher.publish(
      'ticket.attachment.deleted',
      { ...this.toDto(row, projectId), projectId },
      project.userId,
    );
  }

  async download(projectId: string, ticketId: string, attachmentId: string, req: RequestWithUser) {
    await this.assertReadable(projectId, ticketId, req);
    const row = await this.attachmentsRepo.findOne({ where: { id: attachmentId, ticketId } });
    if (!row) throw new NotFoundException('Attachment not found');
    return {
      meta: this.toDto(row, projectId),
      buffer: await this.fileStorage.readProjectTicketAttachmentFile(row.storageKey),
    };
  }

  async listForTicketIds(
    ticketIds: string[],
    projectId: string,
  ): Promise<Map<string, ProjectTicketAttachmentResponseDto[]>> {
    const map = new Map<string, ProjectTicketAttachmentResponseDto[]>();
    if (!ticketIds.length) return map;
    const rows = await this.attachmentsRepo
      .createQueryBuilder('a')
      .where('a.ticket_id IN (:...ticketIds)', { ticketIds })
      .orderBy('a.created_at', 'ASC')
      .getMany();
    for (const row of rows) {
      const current = map.get(row.ticketId) ?? [];
      current.push(this.toDto(row, projectId));
      map.set(row.ticketId, current);
    }
    return map;
  }

  private async assertReadable(projectId: string, ticketId: string, req: RequestWithUser) {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const userInfo = getUserFromRequest(req);
    const ticket = await this.ticketsRepository.findByIdOrThrow(ticketId);
    if (ticket.projectId !== projectId) throw new NotFoundException('Attachment not found');
    ensureProjectReadable(userInfo, project);
    return { project, ticket, userInfo };
  }

  private async assertWritable(projectId: string, ticketId: string, req: RequestWithUser) {
    const ctx = await this.assertReadable(projectId, ticketId, req);
    ensureProjectAdmin(ctx.userInfo);
    ensureTicketUnlocked(ctx.ticket);
    return ctx;
  }

  private sanitizeFileName(name: string): string {
    const base = path
      .basename(name.replace(/\\/g, '/'))
      .replace(/[\0\r\n]/g, '')
      .trim();
    return (base || 'attachment').slice(0, 255);
  }

  private toDto(row: ProjectTicketAttachmentEntity, projectId: string): ProjectTicketAttachmentResponseDto {
    return {
      id: row.id,
      ticketId: row.ticketId,
      fileName: row.fileName,
      contentType: row.contentType,
      byteSize: Number(row.byteSize),
      downloadUrl: `/api/projects/${projectId}/tickets/${row.ticketId}/attachments/${row.id}/download`,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: row.createdAt,
    };
  }
}
