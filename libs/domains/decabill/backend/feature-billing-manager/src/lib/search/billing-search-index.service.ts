import { UserEntity } from '@forepath/identity/backend';
import { OpenSearchService } from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AddonEntity } from '../entities/addon.entity';
import { BackorderEntity } from '../entities/backorder.entity';
import { CloudInitConfigEntity } from '../entities/cloud-init-config.entity';
import { CustomerProfileEntity } from '../entities/customer-profile.entity';
import { DatevExportEntity } from '../entities/datev-export.entity';
import { InvoiceEntity } from '../entities/invoice.entity';
import { OfferEntity } from '../offers/entities/offer.entity';
import { MeterEntity } from '../entities/meter.entity';
import { PromotionEntity } from '../entities/promotion.entity';
import { ServicePlanEntity } from '../entities/service-plan.entity';
import { ServiceTypeEntity } from '../entities/service-type.entity';
import { SubscriptionEntity } from '../entities/subscription.entity';
import { ProjectMilestoneEntity } from '../projects/entities/project-milestone.entity';
import { ProjectTicketEntity } from '../projects/entities/project-ticket.entity';
import { ProjectTimeEntryEntity } from '../projects/entities/project-time-entry.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

import {
  mapAddonToSearchDocument,
  mapBackorderToSearchDocument,
  mapCloudInitConfigToSearchDocument,
  mapCustomerProfileToSearchDocument,
  mapDatevExportToSearchDocument,
  mapInvoiceToSearchDocument,
  mapOfferToSearchDocument,
  mapMeterToSearchDocument,
  mapMilestoneToSearchDocument,
  mapProjectToSearchDocument,
  mapPromotionToSearchDocument,
  mapServicePlanToSearchDocument,
  mapServiceTypeToSearchDocument,
  mapSubscriptionToSearchDocument,
  mapTicketToSearchDocument,
  mapTimeEntryToSearchDocument,
  mapUserToSearchDocument,
} from './billing-search-document.mapper';
import {
  BILLING_SEARCH_FIELDS,
  BILLING_SEARCH_REINDEX_BATCH_SIZE,
  type BillingSearchDocument,
  type BillingSearchEntityType,
  type BillingSearchIdsLookup,
} from './billing-search.types';

@Injectable()
export class BillingSearchIndexService {
  private readonly logger = new Logger(BillingSearchIndexService.name);
  private readonly ensuredIndexes = new Set<string>();

  constructor(
    private readonly openSearch: OpenSearchService,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionsRepository: Repository<SubscriptionEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoicesRepository: Repository<InvoiceEntity>,
    @InjectRepository(OfferEntity)
    private readonly offersRepository: Repository<OfferEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @InjectRepository(ProjectTicketEntity)
    private readonly ticketsRepository: Repository<ProjectTicketEntity>,
    @InjectRepository(PromotionEntity)
    private readonly promotionsRepository: Repository<PromotionEntity>,
    @InjectRepository(CustomerProfileEntity)
    private readonly customerProfilesRepository: Repository<CustomerProfileEntity>,
    @InjectRepository(ServicePlanEntity)
    private readonly servicePlansRepository: Repository<ServicePlanEntity>,
    @InjectRepository(ServiceTypeEntity)
    private readonly serviceTypesRepository: Repository<ServiceTypeEntity>,
    @InjectRepository(MeterEntity)
    private readonly metersRepository: Repository<MeterEntity>,
    @InjectRepository(AddonEntity)
    private readonly addonsRepository: Repository<AddonEntity>,
    @InjectRepository(CloudInitConfigEntity)
    private readonly cloudInitConfigsRepository: Repository<CloudInitConfigEntity>,
    @InjectRepository(DatevExportEntity)
    private readonly datevExportsRepository: Repository<DatevExportEntity>,
    @InjectRepository(ProjectTimeEntryEntity)
    private readonly timeEntriesRepository: Repository<ProjectTimeEntryEntity>,
    @InjectRepository(ProjectMilestoneEntity)
    private readonly milestonesRepository: Repository<ProjectMilestoneEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(BackorderEntity)
    private readonly backordersRepository: Repository<BackorderEntity>,
  ) {}

  isEnabled(): boolean {
    return this.openSearch.isEnabled();
  }

  scheduleUpsert(entityType: BillingSearchEntityType, document: BillingSearchDocument): void {
    void this.upsert(entityType, document).catch((error: unknown) => {
      this.logger.warn(`Search upsert failed for ${entityType}/${document.id}: ${(error as Error).message}`);
    });
  }

  scheduleDelete(entityType: BillingSearchEntityType, id: string): void {
    void this.delete(entityType, id).catch((error: unknown) => {
      this.logger.warn(`Search delete failed for ${entityType}/${id}: ${(error as Error).message}`);
    });
  }

  async upsert(entityType: BillingSearchEntityType, document: BillingSearchDocument): Promise<void> {
    if (!this.openSearch.isEnabled()) {
      return;
    }

    const index = await this.ensureEntityIndex(entityType);

    try {
      await this.openSearch.indexDocument(index, document.id, document);
    } catch (error) {
      this.logger.warn(`OpenSearch upsert failed for ${entityType}/${document.id}: ${(error as Error).message}`);
      throw error;
    }
  }

  async delete(entityType: BillingSearchEntityType, id: string): Promise<void> {
    if (!this.openSearch.isEnabled()) {
      return;
    }

    const index = await this.ensureEntityIndex(entityType);

    try {
      await this.openSearch.deleteDocument(index, id);
    } catch (error) {
      this.logger.warn(`OpenSearch delete failed for ${entityType}/${id}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Returns matching document ids ordered by relevance.
   * Always applies `tenantId` filter. Returns `null` when OpenSearch is disabled or the query fails
   * so list endpoints can fall back to ILIKE.
   */
  async searchIds(
    entityType: BillingSearchEntityType,
    query: string,
    options?: {
      tenantId?: string;
      limit?: number;
      offset?: number;
      extraFilters?: Record<string, string | string[] | number | boolean | null | undefined>;
    },
  ): Promise<BillingSearchIdsLookup> {
    if (!this.openSearch.isEnabled()) {
      return null;
    }

    const tenantId = options?.tenantId ?? getRequiredTenantId();
    const index = await this.ensureEntityIndex(entityType);

    try {
      const result = await this.openSearch.search({
        index,
        query,
        fields: BILLING_SEARCH_FIELDS[entityType],
        filters: {
          tenantId,
          ...(options?.extraFilters ?? {}),
        },
        from: options?.offset,
        size: options?.limit,
      });

      return {
        ids: result.hits.map((hit) => hit.id).filter((id) => id.length > 0),
        total: result.total,
      };
    } catch (error) {
      this.logger.warn(`OpenSearch search failed for ${entityType}: ${(error as Error).message}`);

      return null;
    }
  }

  async reindexBatch(
    entityType: BillingSearchEntityType,
    offset: number,
    limit = BILLING_SEARCH_REINDEX_BATCH_SIZE,
  ): Promise<{ processed: number; hasMore: boolean }> {
    if (!this.openSearch.isEnabled()) {
      return { processed: 0, hasMore: false };
    }

    const tenantId = getRequiredTenantId();
    const documents = await this.loadBatchDocuments(entityType, tenantId, offset, limit);
    const index = await this.ensureEntityIndex(entityType);

    try {
      if (documents.length > 0) {
        await this.openSearch.bulkUpsert(
          index,
          documents.map((document) => ({ id: document.id, document })),
        );
      }
    } catch (error) {
      this.logger.warn(
        `OpenSearch reindexBatch failed for ${entityType} offset=${offset}: ${(error as Error).message}`,
      );
      throw error;
    }

    return {
      processed: documents.length,
      hasMore: documents.length >= limit,
    };
  }

  private async ensureEntityIndex(entityType: BillingSearchEntityType): Promise<string> {
    const index = this.openSearch.indexName(entityType);

    if (!this.ensuredIndexes.has(index) && this.openSearch.isEnabled()) {
      await this.openSearch.ensureIndex(index, {
        properties: {
          id: { type: 'keyword' },
          tenantId: { type: 'keyword' },
          entityType: { type: 'keyword' },
          userId: { type: 'keyword' },
          projectId: { type: 'keyword' },
          number: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          invoiceNumber: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          offerNumber: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          subscriptionNumber: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          name: { type: 'text' },
          title: { type: 'text' },
          description: { type: 'text' },
          content: { type: 'text' },
          status: { type: 'keyword' },
          planName: { type: 'text' },
          userEmail: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          email: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          code: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          key: { type: 'text', fields: { keyword: { type: 'keyword' } } },
        },
      });
      this.ensuredIndexes.add(index);
    }

    return index;
  }

  private async loadBatchDocuments(
    entityType: BillingSearchEntityType,
    tenantId: string,
    offset: number,
    limit: number,
  ): Promise<BillingSearchDocument[]> {
    switch (entityType) {
      case 'subscriptions':
        return await this.loadSubscriptions(tenantId, offset, limit);
      case 'invoices':
        return await this.loadInvoices(tenantId, offset, limit);
      case 'offers':
        return await this.loadOffers(tenantId, offset, limit);
      case 'projects':
        return await this.loadProjects(tenantId, offset, limit);
      case 'tickets':
        return await this.loadTickets(tenantId, offset, limit);
      case 'promotions':
        return (
          await this.promotionsRepository.find({
            where: { tenantId },
            order: { createdAt: 'ASC' },
            skip: offset,
            take: limit,
          })
        ).map((row) => mapPromotionToSearchDocument(row));
      case 'customer-profiles':
        return await this.loadCustomerProfiles(tenantId, offset, limit);
      case 'service-plans':
        return (
          await this.servicePlansRepository.find({
            where: { tenantId },
            order: { createdAt: 'ASC' },
            skip: offset,
            take: limit,
          })
        ).map((row) => mapServicePlanToSearchDocument(row));
      case 'service-types':
        return (
          await this.serviceTypesRepository.find({
            where: { tenantId },
            order: { createdAt: 'ASC' },
            skip: offset,
            take: limit,
          })
        ).map((row) => mapServiceTypeToSearchDocument(row));
      case 'meters':
        return (
          await this.metersRepository.find({
            where: { tenantId },
            order: { createdAt: 'ASC' },
            skip: offset,
            take: limit,
          })
        ).map((row) => mapMeterToSearchDocument(row));
      case 'addons':
        return (
          await this.addonsRepository.find({
            where: { tenantId },
            order: { createdAt: 'ASC' },
            skip: offset,
            take: limit,
          })
        ).map((row) => mapAddonToSearchDocument(row));
      case 'cloud-init-configs':
        return (
          await this.cloudInitConfigsRepository.find({
            where: { tenantId },
            order: { createdAt: 'ASC' },
            skip: offset,
            take: limit,
          })
        ).map((row) => mapCloudInitConfigToSearchDocument(row));
      case 'datev-exports':
        return (
          await this.datevExportsRepository.find({
            where: { tenantId },
            order: { createdAt: 'ASC' },
            skip: offset,
            take: limit,
          })
        ).map((row) => mapDatevExportToSearchDocument(row));
      case 'time-entries':
        return await this.loadTimeEntries(tenantId, offset, limit);
      case 'milestones':
        return await this.loadMilestones(tenantId, offset, limit);
      case 'users':
        return (
          await this.usersRepository.find({
            where: { tenantId },
            order: { createdAt: 'ASC' },
            skip: offset,
            take: limit,
          })
        ).map((row) => mapUserToSearchDocument(row));
      case 'backorders':
        return await this.loadBackorders(tenantId, offset, limit);
      default: {
        const _exhaustive: never = entityType;

        return _exhaustive;
      }
    }
  }

  private async loadSubscriptions(tenantId: string, offset: number, limit: number): Promise<BillingSearchDocument[]> {
    const rows = await this.subscriptionsRepository
      .createQueryBuilder('subscription')
      .innerJoin(UserEntity, 'user', 'user.id = subscription.user_id')
      .leftJoinAndSelect('subscription.plan', 'plan')
      .addSelect('user.email', 'userEmail')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('subscription.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getRawAndEntities();

    return rows.entities.map((subscription, index) => {
      const raw = rows.raw[index] as { userEmail?: string };

      return mapSubscriptionToSearchDocument(subscription, tenantId, {
        userEmail: raw?.userEmail,
        planName: subscription.plan?.name,
      });
    });
  }

  private async loadInvoices(tenantId: string, offset: number, limit: number): Promise<BillingSearchDocument[]> {
    const rows = await this.invoicesRepository
      .createQueryBuilder('inv')
      .innerJoin(UserEntity, 'user', 'user.id = inv.user_id')
      .leftJoinAndSelect('inv.subscription', 'subscription')
      .addSelect('user.email', 'userEmail')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('inv.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getRawAndEntities();

    return rows.entities.map((invoice, index) => {
      const raw = rows.raw[index] as { userEmail?: string };

      return mapInvoiceToSearchDocument(invoice, tenantId, {
        userEmail: raw?.userEmail,
        subscriptionNumber: invoice.subscription?.number,
      });
    });
  }

  private async loadOffers(tenantId: string, offset: number, limit: number): Promise<BillingSearchDocument[]> {
    const rows = await this.offersRepository
      .createQueryBuilder('offer')
      .innerJoin(UserEntity, 'user', 'user.id = offer.user_id')
      .addSelect('user.email', 'userEmail')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('offer.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getRawAndEntities();

    return rows.entities.map((offer, index) => {
      const raw = rows.raw[index] as { userEmail?: string };

      return mapOfferToSearchDocument(offer, tenantId, { userEmail: raw?.userEmail });
    });
  }

  private async loadProjects(tenantId: string, offset: number, limit: number): Promise<BillingSearchDocument[]> {
    const rows = await this.projectsRepository
      .createQueryBuilder('project')
      .innerJoin(UserEntity, 'user', 'user.id = project.user_id')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('project.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return rows.map((project) => mapProjectToSearchDocument(project, tenantId));
  }

  private async loadTickets(tenantId: string, offset: number, limit: number): Promise<BillingSearchDocument[]> {
    const rows = await this.ticketsRepository
      .createQueryBuilder('ticket')
      .innerJoin(ProjectEntity, 'project', 'project.id = ticket.project_id')
      .innerJoin(UserEntity, 'user', 'user.id = project.user_id')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('ticket.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return rows.map((ticket) => mapTicketToSearchDocument(ticket, tenantId));
  }

  private async loadCustomerProfiles(
    tenantId: string,
    offset: number,
    limit: number,
  ): Promise<BillingSearchDocument[]> {
    const rows = await this.customerProfilesRepository
      .createQueryBuilder('profile')
      .innerJoin(UserEntity, 'user', 'user.id = profile.user_id')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('profile.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return rows.map((profile) => mapCustomerProfileToSearchDocument(profile, tenantId));
  }

  private async loadTimeEntries(tenantId: string, offset: number, limit: number): Promise<BillingSearchDocument[]> {
    const rows = await this.timeEntriesRepository
      .createQueryBuilder('entry')
      .innerJoin(ProjectEntity, 'project', 'project.id = entry.project_id')
      .innerJoin(UserEntity, 'user', 'user.id = project.user_id')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('entry.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return rows.map((entry) => mapTimeEntryToSearchDocument(entry, tenantId));
  }

  private async loadMilestones(tenantId: string, offset: number, limit: number): Promise<BillingSearchDocument[]> {
    const rows = await this.milestonesRepository
      .createQueryBuilder('milestone')
      .innerJoin(ProjectEntity, 'project', 'project.id = milestone.project_id')
      .innerJoin(UserEntity, 'user', 'user.id = project.user_id')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('milestone.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return rows.map((milestone) => mapMilestoneToSearchDocument(milestone, tenantId));
  }

  private async loadBackorders(tenantId: string, offset: number, limit: number): Promise<BillingSearchDocument[]> {
    const rows = await this.backordersRepository
      .createQueryBuilder('backorder')
      .innerJoin(UserEntity, 'user', 'user.id = backorder.user_id')
      .where('user.tenant_id = :tenantId', { tenantId })
      .orderBy('backorder.createdAt', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return rows.map((backorder) => mapBackorderToSearchDocument(backorder, tenantId));
  }
}
