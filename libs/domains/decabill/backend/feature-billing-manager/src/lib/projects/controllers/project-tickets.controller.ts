import {
  Body,
  Controller,
  Delete,
  Get,
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
import { getUserFromRequest } from '../../utils/billing-access.utils';
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

@Controller('projects/:projectId/tickets')
export class ProjectTicketsController {
  constructor(private readonly ticketsService: ProjectTicketsService) {}

  @Get()
  async list(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Query('status') status?: ProjectTicketStatus,
    @Query('parentId') parentIdRaw?: string,
    @Req() req?: RequestWithUser,
  ): Promise<ProjectTicketResponseDto[]> {
    let parentId: string | null | undefined;

    if (parentIdRaw === 'null') {
      parentId = null;
    } else if (parentIdRaw) {
      parentId = parentIdRaw;
    }

    return await this.ticketsService.listTickets(projectId, getUserFromRequest(req || ({} as RequestWithUser)), {
      status,
      parentId,
    });
  }

  @Get(':id/activity')
  async activity(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ): Promise<ProjectTicketActivityResponseDto[]> {
    return await this.ticketsService.listActivity(
      projectId,
      id,
      limit ?? 100,
      offset ?? 0,
      getUserFromRequest(req || ({} as RequestWithUser)),
    );
  }

  @Get(':id/comments')
  async comments(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<ProjectTicketCommentResponseDto[]> {
    return await this.ticketsService.listComments(projectId, id, getUserFromRequest(req || ({} as RequestWithUser)));
  }

  @Get(':id')
  async get(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('includeDescendants') includeDescendants?: string,
    @Req() req?: RequestWithUser,
  ): Promise<ProjectTicketResponseDto> {
    return await this.ticketsService.findOne(
      projectId,
      id,
      includeDescendants === 'true',
      getUserFromRequest(req || ({} as RequestWithUser)),
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
