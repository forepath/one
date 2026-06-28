import { BadRequestException, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query, Req } from '@nestjs/common';

import type { PaginatedProjectsResponseDto, ProjectResponseDto, ProjectSummaryResponseDto } from '../dto/project.dto';
import { ProjectsService } from '../services/projects.service';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async list(
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedProjectsResponseDto> {
    const userInfo = getUserFromRequest(req);

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.projectsService.listForUser(userInfo.userId, limit ?? 10, offset ?? 0);
  }

  @Get(':id/summary')
  async summary(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<ProjectSummaryResponseDto> {
    return await this.projectsService.getSummary(getUserFromRequest(req), id);
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<ProjectResponseDto> {
    return await this.projectsService.getByIdForUser(getUserFromRequest(req), id);
  }
}
