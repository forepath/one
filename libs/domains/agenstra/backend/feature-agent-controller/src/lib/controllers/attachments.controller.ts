import {
  ClientUsersRepository,
  RequireScopes,
  ensureClientAccess,
  getUserFromRequest,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { AgenstraAttachmentOwnerType } from '../entities/attachment.enums';
import { ClientsRepository } from '../repositories/clients.repository';
import { AgenstraAttachmentsService, type UploadedAttachmentFile } from '../services/agenstra-attachments.service';

function contentDispositionAttachment(filename: string): string {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'attachment';
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

@Controller()
export class AttachmentsController {
  constructor(
    private readonly attachments: AgenstraAttachmentsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  @Post('tickets/:id/attachments')
  @RequireScopes('attachments:write')
  @UseInterceptors(FileInterceptor('file'))
  async uploadTicket(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedAttachmentFile,
    @Req() req?: RequestWithUser,
  ) {
    const clientId = await this.attachments.getTicketClientId(id);
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    const dto = await this.attachments.uploadForTicket(
      id,
      file,
      getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null,
    );
    return dto;
  }

  @Get('tickets/:id/attachments')
  @RequireScopes('attachments:read')
  async listTicket(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    await ensureClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      await this.attachments.getTicketClientId(id),
      req,
    );
    const rows = await this.attachments.listForOwner(AgenstraAttachmentOwnerType.TICKET, id);
    return rows;
  }

  @Delete('tickets/:id/attachments/:attachmentId')
  @RequireScopes('attachments:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTicket(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Req() req?: RequestWithUser,
  ) {
    const row = await this.attachments.getForOwner(AgenstraAttachmentOwnerType.TICKET, id, attachmentId);
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, row.clientId, req);
    await this.attachments.deleteForOwner(
      AgenstraAttachmentOwnerType.TICKET,
      id,
      attachmentId,
      getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null,
    );
  }

  @Post('knowledge/:id/attachments')
  @RequireScopes('attachments:write')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedAttachmentFile,
    @Req() req?: RequestWithUser,
  ) {
    const clientId = await this.attachments.getKnowledgePageClientId(id);
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    const dto = await this.attachments.uploadForKnowledgePage(
      id,
      file,
      getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null,
    );
    return dto;
  }

  @Get('knowledge/:id/attachments')
  @RequireScopes('attachments:read')
  async listPage(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    await ensureClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      await this.attachments.getKnowledgePageClientId(id),
      req,
    );
    const rows = await this.attachments.listForOwner(AgenstraAttachmentOwnerType.KNOWLEDGE_PAGE, id);
    return rows;
  }

  @Delete('knowledge/:id/attachments/:attachmentId')
  @RequireScopes('attachments:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Req() req?: RequestWithUser,
  ) {
    const row = await this.attachments.getForOwner(AgenstraAttachmentOwnerType.KNOWLEDGE_PAGE, id, attachmentId);
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, row.clientId, req);
    await this.attachments.deleteForOwner(
      AgenstraAttachmentOwnerType.KNOWLEDGE_PAGE,
      id,
      attachmentId,
      getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null,
    );
  }

  @Post('attachments/chat')
  @RequireScopes('attachments:write')
  @UseInterceptors(FileInterceptor('file'))
  async uploadChat(
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @UploadedFile() file: UploadedAttachmentFile,
    @Req() req?: RequestWithUser,
  ) {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
    return await this.attachments.uploadForChat(
      clientId,
      file,
      getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null,
    );
  }

  @Get('attachments/:id/download')
  @RequireScopes('attachments:read')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const metadata = await this.attachments.getById(id);
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, metadata.clientId, req);
    const result = await this.attachments.readForDownload(id);
    res.setHeader('Content-Type', result.meta.contentType);
    res.setHeader('Content-Length', String(result.buffer.length));
    res.setHeader('Content-Disposition', contentDispositionAttachment(result.meta.fileName));
    return new StreamableFile(result.buffer);
  }
}
