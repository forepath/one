import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import type { RequestWithUser } from '../../utils/billing-access.utils';
import { getAuthenticatedUserFromRequest, getUserFromRequest } from '../../utils/billing-access.utils';
import type {
  CreateProjectMilestoneDto,
  ProjectMilestoneResponseDto,
  UpdateProjectMilestoneDto,
} from '../dto/project-milestone.dto';
import { ProjectMilestonesService } from '../services/project-milestones.service';

@Controller('projects/:projectId/milestones')
export class ProjectMilestonesController {
  constructor(private readonly milestonesService: ProjectMilestonesService) {}

  @Get()
  async list(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Req() req: RequestWithUser,
  ): Promise<ProjectMilestoneResponseDto[]> {
    return await this.milestonesService.list(projectId, getAuthenticatedUserFromRequest(req));
  }

  @Post()
  async create(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body() dto: CreateProjectMilestoneDto,
    @Req() req: RequestWithUser,
  ): Promise<ProjectMilestoneResponseDto> {
    return await this.milestonesService.create(projectId, dto, getUserFromRequest(req));
  }

  @Post(':id')
  async update(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProjectMilestoneDto,
    @Req() req: RequestWithUser,
  ): Promise<ProjectMilestoneResponseDto> {
    return await this.milestonesService.update(projectId, id, dto, getUserFromRequest(req));
  }

  @Post(':id/lock')
  async lock(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<ProjectMilestoneResponseDto> {
    return await this.milestonesService.lock(projectId, id, getUserFromRequest(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    await this.milestonesService.delete(projectId, id, getUserFromRequest(req));
  }
}
