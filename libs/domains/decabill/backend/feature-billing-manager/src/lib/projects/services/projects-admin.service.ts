import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';

import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { CustomerProfilesRepository } from '../../repositories/customer-profiles.repository';
import { mapProjectToSearchDocument } from '../../search/billing-search-document.mapper';
import { BillingSearchIndexService } from '../../search/billing-search-index.service';
import { resolveCustomerNamesByUserId } from '../../utils/customer-display-name.util';
import { getRequiredTenantId } from '../../utils/tenant-query.utils';
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
import { ProjectPricingModel } from '../entities/project.enums';
import { ProjectsRepository } from '../repositories/projects.repository';
import { PROJECT_PRICE_EPSILON, resolveProjectPricing } from '../utils/project-pricing.utils';

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
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingSearchIndexService: BillingSearchIndexService,
    @Optional() private readonly customerProfilesRepository?: CustomerProfilesRepository,
  ) {}

  async list(
    limit: number,
    offset: number,
    options?: { search?: string; userId?: string },
  ): Promise<PaginatedAdminProjectsResponseDto> {
    const { items, total } = await this.projectsRepository.findAll(limit, offset, options);
    const userIds = [...new Set(items.map((item) => item.userId))];
    const userEmailById = new Map<string, string>();
    const customerNameById = await resolveCustomerNamesByUserId(this.customerProfilesRepository, userIds);

    await Promise.all(
      userIds.map(async (userId) => {
        const user = await this.usersRepository.findByIdForTenant(userId);

        if (user?.email) {
          userEmailById.set(userId, user.email);
        }
      }),
    );

    return {
      items: await Promise.all(
        items.map((project) =>
          this.mapListItem(project, userEmailById.get(project.userId), customerNameById.get(project.userId)),
        ),
      ),
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

    const pricing = resolveProjectPricing(dto.pricingModel, dto.priceLimitNet);
    const project = await this.projectsRepository.create({
      userId: dto.userId,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      status: dto.status,
      hourlyRateNet: dto.hourlyRateNet,
      pricingModel: pricing.pricingModel,
      priceLimitNet: pricing.priceLimitNet,
      targetHours: dto.targetHours ?? null,
      currency: dto.currency ?? 'EUR',
    });

    this.billingNotificationPublisher.publishProject('project.created', project);
    this.billingSearchIndexService.scheduleUpsert(
      'projects',
      mapProjectToSearchDocument(project, getRequiredTenantId()),
    );

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

    const pricingChanged = dto.pricingModel !== undefined || dto.priceLimitNet !== undefined;
    const pricing = pricingChanged
      ? resolveProjectPricing(
          dto.pricingModel ?? project.pricingModel,
          dto.priceLimitNet !== undefined
            ? dto.priceLimitNet
            : project.priceLimitNet != null
              ? Number(project.priceLimitNet)
              : null,
        )
      : undefined;

    if (pricing && billedCount > 0) {
      this.assertPricingChangeAllowedAfterBill(project, pricing);
    }

    const updated = await this.projectsRepository.update(id, {
      userId: dto.userId,
      name: dto.name?.trim(),
      description: dto.description === undefined ? undefined : (dto.description?.trim() ?? null),
      status: dto.status,
      hourlyRateNet: dto.hourlyRateNet,
      pricingModel: pricing?.pricingModel,
      priceLimitNet: pricing === undefined ? undefined : pricing.priceLimitNet,
      targetHours: dto.targetHours === undefined ? undefined : dto.targetHours,
      currency: dto.currency,
    });

    this.billingNotificationPublisher.publishProject('project.updated', updated);
    this.billingSearchIndexService.scheduleUpsert(
      'projects',
      mapProjectToSearchDocument(updated, getRequiredTenantId()),
    );

    return this.mapResponse(updated);
  }

  async delete(id: string): Promise<void> {
    const project = await this.projectsRepository.findByIdOrThrow(id);
    const unbilledCount = await this.projectsRepository.countUnbilledTimeEntries(id);

    if (unbilledCount > 0) {
      throw new BadRequestException('Cannot delete project with unbilled time entries');
    }

    await this.projectsRepository.delete(id);
    this.billingNotificationPublisher.publishProject('project.deleted', project);
    this.billingSearchIndexService.scheduleDelete('projects', id);
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

  /**
   * After the first bill the pricing model is locked (like the hourly rate); the maximum / fixed price may still be
   * adjusted, but never below what has already been invoiced.
   */
  private assertPricingChangeAllowedAfterBill(
    project: ProjectEntity,
    pricing: { pricingModel: ProjectPricingModel; priceLimitNet: number | null },
  ): void {
    if (pricing.pricingModel !== (project.pricingModel ?? ProjectPricingModel.HOURLY)) {
      throw new BadRequestException('Pricing model is locked after first bill');
    }

    const billedAmountNet = Number(project.billedAmountNet ?? 0);

    if (pricing.priceLimitNet != null && pricing.priceLimitNet - billedAmountNet < -PROJECT_PRICE_EPSILON) {
      throw new BadRequestException(
        `Price limit cannot be lower than the already billed amount of ${billedAmountNet.toFixed(2)}`,
      );
    }
  }

  private async mapListItem(
    project: ProjectEntity,
    userEmail?: string,
    customerName?: string,
  ): Promise<AdminProjectListItemDto> {
    const item = await this.projectsService.mapListItem(project);

    return {
      ...item,
      userEmail,
      customerName,
    };
  }

  private mapResponse(project: ProjectEntity): ProjectResponseDto {
    return this.projectsService.mapResponse(project);
  }
}
