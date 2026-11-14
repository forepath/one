import { RequireScopes } from '@forepath/identity/backend';
import { BadRequestException, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query, Req } from '@nestjs/common';

import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import type {
  PaginatedProjectsResponseDto,
  ProjectResponseDto,
  ProjectSummaryResponseDto,
  ProjectsCatalogSummaryResponseDto,
} from '../dto/project.dto';
import { ProjectsService } from '../services/projects.service';

@Controller('projects')
@RequireScopes('projects:read')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async list(
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
  ): Promise<PaginatedProjectsResponseDto> {
    const userInfo = getUserFromRequest(req);

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.projectsService.listForUser(userInfo.userId, limit ?? 10, offset ?? 0, search);
  }

  @Get('summary')
  async catalogSummary(@Req() req: RequestWithUser): Promise<ProjectsCatalogSummaryResponseDto> {
    const userInfo = getUserFromRequest(req);

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.projectsService.getCatalogSummaryForUser(userInfo.userId);
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
