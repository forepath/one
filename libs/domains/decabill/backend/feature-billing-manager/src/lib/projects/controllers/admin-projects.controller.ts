import { KeycloakRoles, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

import type { RequestWithUser } from '../../utils/billing-access.utils';
import { getUserFromRequest } from '../../utils/billing-access.utils';

import type {
  BillProjectTimeDto,
  BillProjectTimeResponseDto,
  CreateAdminProjectDto,
  PaginatedAdminProjectsResponseDto,
  ProjectResponseDto,
  ProjectSummaryResponseDto,
  ProjectTimeReportRequestDto,
  ProjectUnbilledTimeBoundsDto,
  UpdateAdminProjectDto,
} from '../dto/project.dto';
import { ProjectsAdminService } from '../services/projects-admin.service';

@Controller('admin/billing/projects')
@KeycloakRoles(UserRole.ADMIN)
@UsersRoles(UserRole.ADMIN)
export class AdminProjectsController {
  constructor(private readonly projectsAdminService: ProjectsAdminService) {}

  @Get()
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('search') search?: string,
    @Query('userId', new ParseUUIDPipe({ version: '4', optional: true })) userId?: string,
  ): Promise<PaginatedAdminProjectsResponseDto> {
    return await this.projectsAdminService.list(limit ?? 10, offset ?? 0, { search, userId });
  }

  @Get(':id/summary')
  async summary(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<ProjectSummaryResponseDto> {
    return await this.projectsAdminService.getSummary(id);
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return await this.projectsAdminService.getById(id);
  }

  @Post()
  async create(@Body() dto: CreateAdminProjectDto): Promise<ProjectResponseDto> {
    return await this.projectsAdminService.create(dto);
  }

  @Post(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateAdminProjectDto,
  ): Promise<ProjectResponseDto> {
    return await this.projectsAdminService.update(id, dto);
  }

  @Get(':id/unbilled-time-bounds')
  async unbilledTimeBounds(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ProjectUnbilledTimeBoundsDto> {
    return await this.projectsAdminService.getUnbilledTimeBounds(id);
  }

  @Post(':id/time-report')
  @Header('Content-Type', 'application/pdf')
  async generateTimeReport(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ProjectTimeReportRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.projectsAdminService.generateTimeReport(id, dto);

    res.setHeader('Content-Disposition', `attachment; filename="time-report-${id}.pdf"`);

    return new StreamableFile(buffer);
  }

  @Post(':id/bill-time')
  async billTime(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: BillProjectTimeDto,
    @Req() req: RequestWithUser,
  ): Promise<BillProjectTimeResponseDto> {
    const userInfo = getUserFromRequest(req);

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.projectsAdminService.billTime(id, userInfo.userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.projectsAdminService.delete(id);
  }
}
