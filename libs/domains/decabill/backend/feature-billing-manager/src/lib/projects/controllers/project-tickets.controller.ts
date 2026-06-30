import {
  Body,
  Controller,
  Delete,
  Get,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import type { RequestWithUser } from '../../utils/billing-access.utils';
import { getAuthenticatedUserFromRequest } from '../../utils/billing-access.utils';
import type {
  CreateProjectTicketCommentDto,
  CreateProjectTicketDto,
  ProjectTicketActivityResponseDto,
  ProjectTicketCommentResponseDto,
  ProjectTicketResponseDto,
  UpdateProjectTicketDto,
} from '../dto/project-ticket.dto';
import { ProjectTicketStatus } from '../entities/project.enums';
import { ProjectTicketsService } from '../services/project-tickets.service';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('projects/:projectId/tickets')
export class ProjectTicketsController {
  constructor(private readonly ticketsService: ProjectTicketsService) {}

  @Get()
  async list(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Req() req: RequestWithUser,
    @Query('status') status?: ProjectTicketStatus,
    @Query('parentId') parentIdRaw?: string,
  ): Promise<ProjectTicketResponseDto[]> {
    let parentId: string | null | undefined;

    if (parentIdRaw === 'null') {
      parentId = null;
    } else if (parentIdRaw !== undefined && parentIdRaw !== '') {
      if (!UUID_V4_PATTERN.test(parentIdRaw)) {
        throw new BadRequestException('parentId must be a valid UUID or "null"');
      }

      parentId = parentIdRaw;
    }

    return await this.ticketsService.listTickets(projectId, getAuthenticatedUserFromRequest(req), {
      status,
      parentId,
    });
  }

  @Get(':id/activity')
  async activity(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<ProjectTicketActivityResponseDto[]> {
    return await this.ticketsService.listActivity(
      projectId,
      id,
      limit ?? 100,
      offset ?? 0,
      getAuthenticatedUserFromRequest(req),
    );
  }

  @Get(':id/comments')
  async comments(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<ProjectTicketCommentResponseDto[]> {
    return await this.ticketsService.listComments(projectId, id, getAuthenticatedUserFromRequest(req));
  }

  @Get(':id')
  async get(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
    @Query('includeDescendants') includeDescendants?: string,
  ): Promise<ProjectTicketResponseDto> {
    return await this.ticketsService.findOne(
      projectId,
      id,
      includeDescendants === 'true',
      getAuthenticatedUserFromRequest(req),
    );
  }

  @Post()
  async create(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body() dto: CreateProjectTicketDto,
    @Req() req: RequestWithUser,
  ): Promise<ProjectTicketResponseDto> {
    return await this.ticketsService.create(projectId, dto, req);
  }

  @Post(':id/comments')
  async addComment(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateProjectTicketCommentDto,
    @Req() req: RequestWithUser,
  ): Promise<ProjectTicketCommentResponseDto> {
    return await this.ticketsService.addComment(projectId, id, dto, req);
  }

  @Post(':id')
  async update(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProjectTicketDto,
    @Req() req: RequestWithUser,
  ): Promise<ProjectTicketResponseDto> {
    return await this.ticketsService.update(projectId, id, dto, req);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    await this.ticketsService.delete(projectId, id, req);
  }
}
