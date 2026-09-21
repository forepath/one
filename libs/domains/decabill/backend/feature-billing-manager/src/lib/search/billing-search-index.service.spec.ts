import { UserEntity } from '@forepath/identity/backend';
import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';

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

import { BillingSearchIndexService } from './billing-search-index.service';

describe('BillingSearchIndexService', () => {
  let service: BillingSearchIndexService;
  let openSearch: jest.Mocked<
    Pick<
      OpenSearchService,
      'isEnabled' | 'indexName' | 'ensureIndex' | 'indexDocument' | 'deleteDocument' | 'bulkUpsert' | 'search'
    >
  >;

  beforeEach(async () => {
    openSearch = {
      isEnabled: jest.fn().mockReturnValue(true),
      indexName: jest.fn((entity: string) => `decabill-${entity}`),
      ensureIndex: jest.fn().mockResolvedValue(undefined),
      indexDocument: jest.fn().mockResolvedValue(undefined),
      deleteDocument: jest.fn().mockResolvedValue(undefined),
      bulkUpsert: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue({ hits: [{ id: 'sub-1', score: 1, source: {} }], total: 1 }),
    };

    const emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingSearchIndexService,
        { provide: OpenSearchService, useValue: openSearch },
        { provide: getRepositoryToken(SubscriptionEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(InvoiceEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(OfferEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(ProjectEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(ProjectTicketEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(PromotionEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(CustomerProfileEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(ServicePlanEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(ServiceTypeEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(MeterEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(AddonEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(CloudInitConfigEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(DatevExportEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(ProjectTimeEntryEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(ProjectMilestoneEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(UserEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(BackorderEntity), useValue: emptyRepo },
      ],
    }).compile();

    service = module.get(BillingSearchIndexService);
  });

  it('searchIds_WhenDisabled_ReturnsNullForIlikeFallback', async () => {
    openSearch.isEnabled.mockReturnValue(false);

    const result = await service.searchIds('subscriptions', 'acme');

    expect(result).toBeNull();
    expect(openSearch.search).not.toHaveBeenCalled();
  });

  it('searchIds_AlwaysAppliesTenantIdFilter', async () => {
    const result = await service.searchIds('subscriptions', 'acme', {
      tenantId: 'tenant-a',
      limit: 10,
      offset: 0,
    });

    expect(result).toEqual({ ids: ['sub-1'], total: 1 });
    expect(openSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'decabill-subscriptions',
        query: 'acme',
        filters: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
  });

  it('searchIds_OnOpenSearchFailure_ReturnsNull', async () => {
    openSearch.search.mockRejectedValue(new Error('cluster down'));

    const result = await service.searchIds('invoices', 'INV', { tenantId: 'tenant-a' });

    expect(result).toBeNull();
  });

  it('upsert_IndexesDocument', async () => {
    await service.upsert('meters', {
      id: 'm1',
      tenantId: 'default',
      entityType: 'meters',
      key: 'cpu',
      name: 'CPU',
    });

    expect(openSearch.ensureIndex).toHaveBeenCalled();
    expect(openSearch.indexDocument).toHaveBeenCalledWith(
      'decabill-meters',
      'm1',
      expect.objectContaining({ id: 'm1', tenantId: 'default', entityType: 'meters' }),
    );
  });

  it('delete_RemovesDocument', async () => {
    await service.delete('projects', 'p1');

    expect(openSearch.deleteDocument).toHaveBeenCalledWith('decabill-projects', 'p1');
  });
});
