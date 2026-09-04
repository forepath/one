import { OpenSearchModule } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '@forepath/identity/backend';

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
import { SearchReindexJobHandler } from './search-reindex.job-handler';

@Module({
  imports: [
    OpenSearchModule,
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      InvoiceEntity,
      OfferEntity,
      ProjectEntity,
      ProjectTicketEntity,
      PromotionEntity,
      CustomerProfileEntity,
      ServicePlanEntity,
      ServiceTypeEntity,
      MeterEntity,
      AddonEntity,
      CloudInitConfigEntity,
      DatevExportEntity,
      ProjectTimeEntryEntity,
      ProjectMilestoneEntity,
      UserEntity,
      BackorderEntity,
    ]),
  ],
  providers: [BillingSearchIndexService, SearchReindexJobHandler],
  exports: [BillingSearchIndexService, SearchReindexJobHandler, OpenSearchModule],
})
export class BillingSearchModule {}
