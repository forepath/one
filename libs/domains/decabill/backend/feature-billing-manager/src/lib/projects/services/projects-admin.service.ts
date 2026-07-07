import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  AdminProjectListItemDto,
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
import type { ProjectEntity } from '../entities/project.entity';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectBillingService } from './project-billing.service';
import { ProjectTimeReportService } from './project-time-report.service';
import { ProjectsService } from './projects.service';

@Injectable()
export class ProjectsAdminService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly projectsService: ProjectsService,
    private readonly usersRepository: UsersRepository,
    private readonly projectBillingService: ProjectBillingService,
    private readonly projectTimeReportService: ProjectTimeReportService,
  ) {}

  async list(
    limit: number,
    offset: number,
    options?: { search?: string; userId?: string },
  ): Promise<PaginatedAdminProjectsResponseDto> {
    const { items, total } = await this.projectsRepository.findAll(limit, offset, options);
    const userIds = [...new Set(items.map((item) => item.userId))];
    const userEmailById = new Map<string, string>();

    await Promise.all(
      userIds.map(async (userId) => {
        const user = await this.usersRepository.findByIdForTenant(userId);

        if (user?.email) {
          userEmailById.set(userId, user.email);
        }
      }),
    );

    return {
      items: await Promise.all(items.map((project) => this.mapListItem(project, userEmailById.get(project.userId)))),
      total,
      limit,
      offset,
    };
  }

  async getById(id: string): Promise<ProjectResponseDto & { userEmail?: string; summary: ProjectSummaryResponseDto }> {
    const project = await this.projectsRepository.findByIdOrThrow(id);
    const user = await this.usersRepository.findByIdForTenant(project.userId);
    const summary = await this.projectsService.buildSummary(project);

    return {
      ...this.mapResponse(project),
      userEmail: user?.email,
      summary,
    };
  }

  async getSummary(id: string): Promise<ProjectSummaryResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(id);

    return await this.projectsService.buildSummary(project);
  }

  async create(dto: CreateAdminProjectDto): Promise<ProjectResponseDto> {
    const user = await this.usersRepository.findByIdForTenant(dto.userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const project = await this.projectsRepository.create({
      userId: dto.userId,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      status: dto.status,
      hourlyRateNet: dto.hourlyRateNet,
      targetHours: dto.targetHours ?? null,
      currency: dto.currency ?? 'EUR',
    });

    return this.mapResponse(project);
  }

  async update(id: string, dto: UpdateAdminProjectDto): Promise<ProjectResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(id);
    const billedCount = await this.projectsRepository.countBilledTimeEntries(id);

    if (dto.userId !== undefined && dto.userId !== project.userId) {
      if (billedCount > 0) {
        throw new BadRequestException('Cannot reassign customer after billed time entries exist');
      }

      const user = await this.usersRepository.findByIdForTenant(dto.userId);

      if (!user) {
        throw new NotFoundException('User not found');
      }
    }

    if (dto.hourlyRateNet !== undefined && billedCount > 0 && dto.hourlyRateNet !== Number(project.hourlyRateNet)) {
      throw new BadRequestException('Hourly rate is locked after first bill');
    }

    const updated = await this.projectsRepository.update(id, {
      userId: dto.userId,
      name: dto.name?.trim(),
      description: dto.description === undefined ? undefined : (dto.description?.trim() ?? null),
      status: dto.status,
      hourlyRateNet: dto.hourlyRateNet,
      targetHours: dto.targetHours === undefined ? undefined : dto.targetHours,
      currency: dto.currency,
    });

    return this.mapResponse(updated);
  }

  async delete(id: string): Promise<void> {
    await this.projectsRepository.findByIdOrThrow(id);
    const unbilledCount = await this.projectsRepository.countUnbilledTimeEntries(id);

    if (unbilledCount > 0) {
      throw new BadRequestException('Cannot delete project with unbilled time entries');
    }

    await this.projectsRepository.delete(id);
  }

  async billTime(projectId: string, adminUserId: string, dto: BillProjectTimeDto): Promise<BillProjectTimeResponseDto> {
    return await this.projectBillingService.billUnbilledTime(projectId, adminUserId, dto);
  }

  async getUnbilledTimeBounds(projectId: string): Promise<ProjectUnbilledTimeBoundsDto> {
    return await this.projectBillingService.getUnbilledTimeBounds(projectId);
  }

  async generateTimeReport(projectId: string, dto: ProjectTimeReportRequestDto): Promise<Buffer> {
    return await this.projectTimeReportService.generateLivePdf(projectId, dto);
  }

  private async mapListItem(project: ProjectEntity, userEmail?: string): Promise<AdminProjectListItemDto> {
    const item = await this.projectsService.mapListItem(project);

    return {
      ...item,
      userEmail,
    };
  }

  private mapResponse(project: ProjectEntity): ProjectResponseDto {
    return this.projectsService.mapResponse(project);
  }
}
