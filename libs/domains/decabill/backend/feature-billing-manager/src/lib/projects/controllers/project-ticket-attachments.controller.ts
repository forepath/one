import { RequireScopes } from '@forepath/identity/backend';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import type { RequestWithUser } from '../../utils/billing-access.utils';
import { ProjectTicketAttachmentResponseDto } from '../dto/project-ticket-attachment.dto';
import {
  ProjectTicketAttachmentsService,
  type UploadedProjectTicketAttachment,
} from '../services/project-ticket-attachments.service';

function contentDispositionAttachment(filename: string): string {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'attachment';
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

@Controller('projects/:projectId/tickets/:ticketId/attachments')
export class ProjectTicketAttachmentsController {
  constructor(private readonly attachments: ProjectTicketAttachmentsService) {}

  @RequireScopes('attachments:read')
  @Get()
  async list(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('ticketId', new ParseUUIDPipe({ version: '4' })) ticketId: string,
    @Req() req: RequestWithUser,
  ): Promise<ProjectTicketAttachmentResponseDto[]> {
    return await this.attachments.list(projectId, ticketId, req);
  }

  @RequireScopes('attachments:write')
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('ticketId', new ParseUUIDPipe({ version: '4' })) ticketId: string,
    @UploadedFile() file: UploadedProjectTicketAttachment,
    @Req() req: RequestWithUser,
  ): Promise<ProjectTicketAttachmentResponseDto> {
    return await this.attachments.upload(projectId, ticketId, file, req);
  }

  @RequireScopes('attachments:write')
  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('ticketId', new ParseUUIDPipe({ version: '4' })) ticketId: string,
    @Param('attachmentId', new ParseUUIDPipe({ version: '4' })) attachmentId: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    await this.attachments.delete(projectId, ticketId, attachmentId, req);
  }

  @RequireScopes('attachments:read')
  @Get(':attachmentId/download')
  async download(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('ticketId', new ParseUUIDPipe({ version: '4' })) ticketId: string,
    @Param('attachmentId', new ParseUUIDPipe({ version: '4' })) attachmentId: string,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.attachments.download(projectId, ticketId, attachmentId, req);
    res.setHeader('Content-Type', result.meta.contentType);
    res.setHeader('Content-Length', String(result.buffer.length));
    res.setHeader('Content-Disposition', contentDispositionAttachment(result.meta.fileName));
    return new StreamableFile(result.buffer);
  }
}
