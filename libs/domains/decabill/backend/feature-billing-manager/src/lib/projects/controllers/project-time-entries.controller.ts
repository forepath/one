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
  CreateProjectTimeEntryDto,
  PaginatedProjectTimeEntriesResponseDto,
  ProjectTimeEntryResponseDto,
  UpdateProjectTimeEntryDto,
} from '../dto/project-time-entry.dto';
import { ProjectTimeEntriesService } from '../services/project-time-entries.service';

@Controller('projects/:projectId/time-entries')
export class ProjectTimeEntriesController {
  constructor(private readonly timeEntriesService: ProjectTimeEntriesService) {}

  @Get()
  async list(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Req() req?: RequestWithUser,
  ): Promise<PaginatedProjectTimeEntriesResponseDto> {
    return await this.timeEntriesService.list(
      projectId,
      limit ?? 10,
      offset ?? 0,
      getUserFromRequest(req || ({} as RequestWithUser)),
    );
  }

  @Post()
  async create(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body() dto: CreateProjectTimeEntryDto,
    @Req() req: RequestWithUser,
  ): Promise<ProjectTimeEntryResponseDto> {
    return await this.timeEntriesService.create(projectId, dto, req);
  }

  @Post(':id')
  async update(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProjectTimeEntryDto,
    @Req() req: RequestWithUser,
  ): Promise<ProjectTimeEntryResponseDto> {
    return await this.timeEntriesService.update(projectId, id, dto, req);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    await this.timeEntriesService.delete(projectId, id, req);
  }
}
