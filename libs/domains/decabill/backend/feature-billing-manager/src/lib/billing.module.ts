import {
  RevokedUserTokenEntity,
  SocketAuthService,
  UserEntity,
  UserPersonalAccessTokenEntity,
  UsersRepository,
  RevokedUserTokensRepository,
} from '@forepath/identity/backend';
import {
  EMAIL_ATTACHMENT_RESOLVER,
  EmailDeliveriesRepository,
  EmailDeliveryService,
  EmailService,
  EmailTemplateRendererService,
  NOTIFICATIONS_MODULE_OPTIONS,
  type NotificationsModuleOptions,
} from '@forepath/shared/backend';
import {
  DynamicProviderLoaderService,
  registerDynamicProviderMetadata,
  registerDynamicProviders,
} from '@forepath/shared/backend/util-dynamic-provider-registry';
import { FileStorageModule } from '@forepath/shared/backend/util-file-storage';
import { RedisCacheModule } from '@forepath/shared/backend/util-redis-cache';
import { DynamicModule, Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PAYMENT_PROCESSOR_INIT } from './constants/payment-processor-init.token';
import { AgenstraControllerContributorModule } from './contributors/agenstra-controller/agenstra-controller.contributor.module';
import { AgenstraManagerContributorModule } from './contributors/agenstra-manager/agenstra-manager.contributor.module';
import { BillingContributorHostModule } from './contributors/billing-contributor-host.module';
import { ContainerManagerContributorModule } from './contributors/container-manager/container-manager.contributor.module';
import { DecabillBillingContributorModule } from './contributors/decabill-billing/decabill-billing.contributor.module';
import { DigitalOceanContributorModule } from './contributors/digital-ocean/digital-ocean.contributor.module';
import { HetznerContributorModule } from './contributors/hetzner/hetzner.contributor.module';
import { AddonsController } from './controllers/addons.controller';
import { AdminBillingController } from './controllers/admin-billing.controller';
import { AdminCustomerAutoBillingController } from './controllers/admin-customer-auto-billing.controller';
import { AdminCustomerProfilesController } from './controllers/admin-customer-profiles.controller';
import { AdminDatevExportsController } from './controllers/admin-datev-exports.controller';
import { AdminFileManagerController } from './controllers/admin-file-manager.controller';
import { AdminPromotionsController } from './controllers/admin-promotions.controller';
import { AdminSubscriptionItemsController } from './controllers/admin-subscription-items.controller';
import { AdminSubscriptionMetersController } from './controllers/admin-subscription-meters.controller';
import { AdminSupplierInvoicesController } from './controllers/admin-supplier-invoices.controller';
import { AdminSupplierProfilesController } from './controllers/admin-supplier-profiles.controller';
import { AdminUsageController } from './controllers/admin-usage.controller';
import { AvailabilityController } from './controllers/availability.controller';
import { BackordersController } from './controllers/backorders.controller';
import { CloudInitConfigsController } from './controllers/cloud-init-configs.controller';
import { CustomerAutoBillingController } from './controllers/customer-auto-billing.controller';
import { CustomerProfilesController } from './controllers/customer-profiles.controller';
import { InvoicesController } from './controllers/invoices.controller';
import { MetersController } from './controllers/meters.controller';
import { PaymentsWebhookController } from './controllers/payments-webhook.controller';
import { PricingController } from './controllers/pricing.controller';
import { PromotionsController } from './controllers/promotions.controller';
import { PublicServicePlanOfferingsController } from './controllers/public-service-plan-offerings.controller';
import { PublicWithdrawalController } from './controllers/public-withdrawal.controller';
import { ServicePlansController } from './controllers/service-plans.controller';
import { ServiceTypesController } from './controllers/service-types.controller';
import { SubscriptionItemsController } from './controllers/subscription-items.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { UsageController } from './controllers/usage.controller';
import { BillingEmailAttachmentResolver } from './email/billing-email-attachment.resolver';
import { BillingEmailPublisher } from './email/billing-email.publisher';
import { AddonMeterEntity } from './entities/addon-meter.entity';
import { AddonEntity } from './entities/addon.entity';
import { AvailabilitySnapshotEntity } from './entities/availability-snapshot.entity';
import { BackorderEntity } from './entities/backorder.entity';
import { BillingAuditLogEntity } from './entities/billing-audit-log.entity';
import { CloudInitConfigEntity } from './entities/cloud-init-config.entity';
import { ContainerStatsSampleEntity } from './entities/container-stats-sample.entity';
import { ContainerStatsSummaryEntity } from './entities/container-stats-summary.entity';
import { ContributorJobRunEntity } from './entities/contributor-job-run.entity';
import { CustomerNumberSequenceEntity } from './entities/customer-number-sequence.entity';
import { CustomerProfileEntity } from './entities/customer-profile.entity';
import { DatevCreditorAccountEntity } from './entities/datev-creditor-account.entity';
import { DatevDebtorAccountEntity } from './entities/datev-debtor-account.entity';
import { DatevExportEntity } from './entities/datev-export.entity';
import { InvoiceCreditDocumentEntity } from './entities/invoice-credit-document.entity';
import { InvoiceLineItemEntity } from './entities/invoice-line-item.entity';
import { InvoiceNumberSequenceEntity } from './entities/invoice-number-sequence.entity';
import { InvoicePromotionApplicationEntity } from './entities/invoice-promotion-application.entity';
import { InvoiceVoidDocumentEntity } from './entities/invoice-void-document.entity';
import { InvoiceEntity } from './entities/invoice.entity';
import { MeterEntity } from './entities/meter.entity';
import { OpenPositionEntity } from './entities/open-position.entity';
import { OssThresholdLedgerEntity } from './entities/oss-threshold-ledger.entity';
import { PaymentAttemptEntity } from './entities/payment-attempt.entity';
import { PaymentRefundEntity } from './entities/payment-refund.entity';
import { PaymentWebhookEventEntity } from './entities/payment-webhook-event.entity';
import { PromotionRedemptionEntity } from './entities/promotion-redemption.entity';
import { PromotionEntity } from './entities/promotion.entity';
import { ProviderPriceSnapshotEntity } from './entities/provider-price-snapshot.entity';
import { PublicWithdrawalRequestEntity } from './entities/public-withdrawal-request.entity';
import { ReservedHostnameEntity } from './entities/reserved-hostname.entity';
import { ServicePlanMeterEntity } from './entities/service-plan-meter.entity';
import { ServicePlanEntity } from './entities/service-plan.entity';
import { ServiceTypeMeterEntity } from './entities/service-type-meter.entity';
import { ServiceTypeEntity } from './entities/service-type.entity';
import { StoredFileEntity } from './entities/stored-file.entity';
import { SubscriptionAddonEntity } from './entities/subscription-addon.entity';
import { SubscriptionConfigChangeEntity } from './entities/subscription-config-change.entity';
import { SubscriptionItemEntity } from './entities/subscription-item.entity';
import { SubscriptionNumberSequenceEntity } from './entities/subscription-number-sequence.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { SupplierContractEntity } from './entities/supplier-contract.entity';
import { SupplierInvoiceLineItemEntity } from './entities/supplier-invoice-line-item.entity';
import { SupplierInvoiceNumberSequenceEntity } from './entities/supplier-invoice-number-sequence.entity';
import { SupplierInvoiceEntity } from './entities/supplier-invoice.entity';
import { SupplierNumberSequenceEntity } from './entities/supplier-number-sequence.entity';
import { SupplierProfileEntity } from './entities/supplier-profile.entity';
import { UsageRecordEntity } from './entities/usage-record.entity';
import { BillingMeterRealtimeService } from './gateways/billing-meter-realtime.service';
import { BillingStatusGateway } from './gateways/billing-status.gateway';
import { DatevExportEnabledGuard } from './guards/datev-export-enabled.guard';
import { TenantUserGuard } from './guards/tenant-user.guard';
import { BillingIdentityEmailBridgeModule } from './modules/billing-identity-email-bridge.module';
import { BillingIdentityNotificationBridgeModule } from './modules/billing-identity-notification-bridge.module';
import { BillingUpdatesModule } from './modules/billing-updates.module';
import { AdminOffersController } from './offers/controllers/admin-offers.controller';
import { OffersController } from './offers/controllers/offers.controller';
import { OfferLineItemEntity } from './offers/entities/offer-line-item.entity';
import { OfferNumberSequenceEntity } from './offers/entities/offer-number-sequence.entity';
import { OfferEntity } from './offers/entities/offer.entity';
import { OfferLineItemsRepository } from './offers/repositories/offer-line-items.repository';
import { OfferNumberSequencesRepository } from './offers/repositories/offer-number-sequences.repository';
import { OffersRepository } from './offers/repositories/offers.repository';
import { OfferArchiveService } from './offers/services/offer-archive.service';
import { OfferExpirationJobHandler } from './offers/services/offer-expiration.job-handler';
import { OfferFulfillmentJobHandler } from './offers/services/offer-fulfillment.job-handler';
import { OfferFulfillmentService } from './offers/services/offer-fulfillment.service';
import { OfferPdfTemplateService } from './offers/services/offer-pdf-template.service';
import { OfferPdfService } from './offers/services/offer-pdf.service';
import { OfferProfileSummaryService } from './offers/services/offer-profile-summary.service';
import { OfferStatisticsQueryService } from './offers/services/offer-statistics-query.service';
import { OffersAdminService } from './offers/services/offers-admin.service';
import { OffersCustomerService } from './offers/services/offers-customer.service';
import { SubscriptionOrderPreparationService } from './offers/services/subscription-order-preparation.service';
import { PaymentProcessorFactory } from './payment-processors/payment-processor.factory';
import type { PaymentProcessor } from './payment-processors/payment-processor.interface';
import { StripePaymentProcessor } from './payment-processors/processors/stripe-payment.processor';
import { AdminProjectsController } from './projects/controllers/admin-projects.controller';
import { ProjectMilestonesController } from './projects/controllers/project-milestones.controller';
import { ProjectTicketAttachmentsController } from './projects/controllers/project-ticket-attachments.controller';
import { ProjectTicketsController } from './projects/controllers/project-tickets.controller';
import { ProjectTimeEntriesController } from './projects/controllers/project-time-entries.controller';
import { ProjectsController } from './projects/controllers/projects.controller';
import { ProjectMilestoneEntity } from './projects/entities/project-milestone.entity';
import { ProjectTicketActivityEntity } from './projects/entities/project-ticket-activity.entity';
import { ProjectTicketAttachmentEntity } from './projects/entities/project-ticket-attachment.entity';
import { ProjectTicketCommentEntity } from './projects/entities/project-ticket-comment.entity';
import { ProjectTicketEntity } from './projects/entities/project-ticket.entity';
import { ProjectTimeEntryEntity } from './projects/entities/project-time-entry.entity';
import { ProjectEntity } from './projects/entities/project.entity';
import { ProjectBoardGateway } from './projects/gateways/project-board.gateway';
import { ProjectMilestonesRepository } from './projects/repositories/project-milestones.repository';
import { ProjectTicketActivitiesRepository } from './projects/repositories/project-ticket-activities.repository';
import { ProjectTicketCommentsRepository } from './projects/repositories/project-ticket-comments.repository';
import { ProjectTicketsRepository } from './projects/repositories/project-tickets.repository';
import { ProjectTimeEntriesRepository } from './projects/repositories/project-time-entries.repository';
import { ProjectsRepository } from './projects/repositories/projects.repository';
import { ProjectBillingService } from './projects/services/project-billing.service';
import { ProjectBoardRealtimeService } from './projects/services/project-board-realtime.service';
import { ProjectBoardSummaryService } from './projects/services/project-board-summary.service';
import { ProjectMilestonesService } from './projects/services/project-milestones.service';
import { ProjectTicketAttachmentsService } from './projects/services/project-ticket-attachments.service';
import { ProjectTicketsService } from './projects/services/project-tickets.service';
import { ProjectTimeEntriesService } from './projects/services/project-time-entries.service';
import { ProjectTimeReportPdfTemplateService } from './projects/services/project-time-report-pdf-template.service';
import { ProjectTimeReportPdfService } from './projects/services/project-time-report-pdf.service';
import { ProjectTimeReportService } from './projects/services/project-time-report.service';
import { ProjectsAdminService } from './projects/services/projects-admin.service';
import { ProjectsService } from './projects/services/projects.service';
import { AdminBillNowEnqueueAdapter } from './queue/admin-bill-now-enqueue.adapter';
import { ADMIN_BILL_NOW_ENQUEUE } from './queue/admin-bill-now-enqueue.token';
import { DatevExportEnqueueAdapter } from './queue/datev-export-enqueue.adapter';
import { DATEV_EXPORT_ENQUEUE } from './queue/datev-export-enqueue.token';
import { PlanPriceMigrateEnqueueAdapter } from './queue/plan-price-migrate-enqueue.adapter';
import { PLAN_PRICE_MIGRATE_ENQUEUE } from './queue/plan-price-migrate-enqueue.token';
import { VatIdValidationEnqueueAdapter } from './queue/vat-id-validation-enqueue.adapter';
import { VAT_ID_VALIDATION_ENQUEUE } from './queue/vat-id-validation-enqueue.token';
import { AddonMetersRepository } from './repositories/addon-meters.repository';
import { AddonsRepository } from './repositories/addons.repository';
import { AvailabilitySnapshotsRepository } from './repositories/availability-snapshots.repository';
import { BackordersRepository } from './repositories/backorders.repository';
import { BillingAuditLogsRepository } from './repositories/billing-audit-logs.repository';
import { CloudInitConfigsRepository } from './repositories/cloud-init-configs.repository';
import { ContainerStatsSamplesRepository } from './repositories/container-stats-samples.repository';
import { ContainerStatsSummariesRepository } from './repositories/container-stats-summaries.repository';
import { ContributorJobRunsRepository } from './repositories/contributor-job-runs.repository';
import { CustomerNumberSequencesRepository } from './repositories/customer-number-sequences.repository';
import { CustomerProfilesRepository } from './repositories/customer-profiles.repository';
import { DatevCreditorAccountsRepository } from './repositories/datev-creditor-accounts.repository';
import { DatevDebtorAccountsRepository } from './repositories/datev-debtor-accounts.repository';
import { DatevExportRepository } from './repositories/datev-export.repository';
import { InvoiceCreditDocumentsRepository } from './repositories/invoice-credit-documents.repository';
import { InvoiceLineItemsRepository } from './repositories/invoice-line-items.repository';
import { InvoiceNumberSequencesRepository } from './repositories/invoice-number-sequences.repository';
import { InvoicePromotionApplicationsRepository } from './repositories/invoice-promotion-applications.repository';
import { InvoiceVoidDocumentsRepository } from './repositories/invoice-void-documents.repository';
import { InvoicesRepository } from './repositories/invoices.repository';
import { MetersRepository } from './repositories/meters.repository';
import { OpenPositionsRepository } from './repositories/open-positions.repository';
import { OssThresholdLedgersRepository } from './repositories/oss-threshold-ledgers.repository';
import { PaymentAttemptsRepository } from './repositories/payment-attempts.repository';
import { PaymentRefundsRepository } from './repositories/payment-refunds.repository';
import { PaymentWebhookEventsRepository } from './repositories/payment-webhook-events.repository';
import { PromotionRedemptionsRepository } from './repositories/promotion-redemptions.repository';
import { PromotionsRepository } from './repositories/promotions.repository';
import { ProviderPriceSnapshotsRepository } from './repositories/provider-price-snapshots.repository';
import { PublicWithdrawalRequestsRepository } from './repositories/public-withdrawal-requests.repository';
import { ReservedHostnamesRepository } from './repositories/reserved-hostnames.repository';
import { ServicePlanMetersRepository } from './repositories/service-plan-meters.repository';
import { ServicePlansRepository } from './repositories/service-plans.repository';
import { ServiceTypeMetersRepository } from './repositories/service-type-meters.repository';
import { ServiceTypesRepository } from './repositories/service-types.repository';
import { SubscriptionAddonsRepository } from './repositories/subscription-addons.repository';
import { SubscriptionConfigChangesRepository } from './repositories/subscription-config-changes.repository';
import { SubscriptionItemsRepository } from './repositories/subscription-items.repository';
import { SubscriptionNumberSequencesRepository } from './repositories/subscription-number-sequences.repository';
import { SubscriptionsRepository } from './repositories/subscriptions.repository';
import { SupplierContractsRepository } from './repositories/supplier-contracts.repository';
import { SupplierInvoiceLineItemsRepository } from './repositories/supplier-invoice-line-items.repository';
import { SupplierInvoiceNumberSequencesRepository } from './repositories/supplier-invoice-number-sequences.repository';
import { SupplierInvoicesRepository } from './repositories/supplier-invoices.repository';
import { SupplierNumberSequencesRepository } from './repositories/supplier-number-sequences.repository';
import { SupplierProfilesRepository } from './repositories/supplier-profiles.repository';
import { UsageRecordsRepository } from './repositories/usage-records.repository';
import { UsersBillingDayRepository } from './repositories/users-billing-day.repository';
import { BillingSearchModule } from './search/billing-search.module';
import { SearchReindexJobHandler } from './search/search-reindex.job-handler';
import { AddonLifecycleService } from './services/addon-lifecycle.service';
import type { BillingAddonModule } from './services/addon-module-registry.service';
import { AddonModuleRegistryService } from './services/addon-module-registry.service';
import { AddonService } from './services/addon.service';
import { AdminBillNowService } from './services/admin-bill-now.service';
import { AdminFileManagerService } from './services/admin-file-manager.service';
import { AutoBillingService } from './services/auto-billing.service';
import { AvailabilityService } from './services/availability.service';
import { BackorderRetryJobHandler } from './services/backorder-retry.job-handler';
import { BackorderService } from './services/backorder.service';
import { BillingAdminService } from './services/billing-admin.service';
import { BillingAuditLogService } from './services/billing-audit-log.service';
import { BillingDocumentTermsConfigService } from './services/billing-document-terms-config.service';
import { BillingIssuerConfigService } from './services/billing-issuer-config.service';
import { BillingMetricsCollectorService } from './services/billing-metrics-collector.service';
import { BillingScheduleService } from './services/billing-schedule.service';
import { BillingStatisticsQueryService } from './services/billing-statistics-query.service';
import { BillingTenantService } from './services/billing-tenant.service';
import { CancellationPolicyService } from './services/cancellation-policy.service';
import { CloudInitConfigService } from './services/cloud-init-config.service';
import { CloudInitDispatchService } from './services/cloud-init-dispatch.service';
import { CloudInitModuleRegistryService } from './services/cloud-init-module-registry.service';
import type { CloudInitConfigModule } from './services/cloud-init-module-registry.service';
import { CloudflareDnsService } from './services/cloudflare-dns.service';
import { ContributorCollectJobHandler } from './services/contributor-collect.job-handler';
import { ContributorJobRegistryService } from './services/contributor-job-registry.service';
import { ContributorMigrationService } from './services/contributor-migration.service';
import { CustomerProfilesAdminService } from './services/customer-profiles-admin.service';
import { CustomerProfilesService } from './services/customer-profiles.service';
import { DatevBookingMapperService } from './services/datev-booking-mapper.service';
import { DatevCreditorAccountService } from './services/datev-creditor-account.service';
import { DatevCreditorMapperService } from './services/datev-creditor-mapper.service';
import { DatevDebtorAccountService } from './services/datev-debtor-account.service';
import { DatevDebtorMapperService } from './services/datev-debtor-mapper.service';
import { DatevDocumentArchiveService } from './services/datev-document-archive.service';
import { DatevExportAdminService } from './services/datev-export-admin.service';
import { DatevExportConfigService } from './services/datev-export-config.service';
import { DatevExportJobHandler } from './services/datev-export.job-handler';
import { DatevExportService } from './services/datev-export.service';
import { DatevExtfCsvService } from './services/datev-extf-csv.service';
import { EInvoiceEmbedService } from './services/e-invoice-embed.service';
import { EInvoiceInboundParseService } from './services/e-invoice-inbound-parse.service';
import { EInvoiceXmlService } from './services/e-invoice-xml.service';
import { HostnameReservationService } from './services/hostname-reservation.service';
import { IntegratedStackRegistryService } from './services/integrated-stack-registry.service';
import type { IntegratedStackModule } from './services/integrated-stack-registry.service';
import { InvoiceAdminService } from './services/invoice-admin.service';
import { InvoiceAutoPaymentJobHandler } from './services/invoice-auto-payment.job-handler';
import { InvoiceCreationService } from './services/invoice-creation.service';
import { InvoiceIssuanceService } from './services/invoice-issuance.service';
import { InvoiceOverdueJobHandler } from './services/invoice-overdue.job-handler';
import { InvoicePdfHtmlRendererService } from './services/invoice-pdf-html-renderer.service';
import { InvoicePdfTemplateService } from './services/invoice-pdf-template.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { InvoiceTaxContextService } from './services/invoice-tax-context.service';
import { InvoiceService } from './services/invoice.service';
import { ManualInvoiceService } from './services/manual-invoice.service';
import { MeterBillingService } from './services/meter-billing.service';
import { MeterCollectJobHandler } from './services/meter-collect.job-handler';
import { MeterService } from './services/meter.service';
import { OpenPositionInvoiceJobHandler } from './services/open-position-invoice.job-handler';
import { OssThresholdService } from './services/oss-threshold.service';
import { PaymentOrchestrationService } from './services/payment-orchestration.service';
import { PriceRecalcJobHandler } from './services/price-recalc.job-handler';
import { PricingService } from './services/pricing.service';
import { PromotionAdminService } from './services/promotion-admin.service';
import { PromotionApplicationService } from './services/promotion-application.service';
import { PromotionRedemptionService } from './services/promotion-redemption.service';
import { PromotionValidationService } from './services/promotion-validation.service';
import { ProviderCatalogDispatchService } from './services/provider-catalog-dispatch.service';
import { ProviderLocationsService } from './services/provider-locations.service';
import type { BillingProviderModule } from './services/provider-module-registry.service';
import { ProviderModuleRegistryService } from './services/provider-module-registry.service';
import { ProviderPricingService } from './services/provider-pricing.service';
import { ProviderRegistryService } from './services/provider-registry.service';
import { ProviderServerTypesService } from './services/provider-server-types.service';
import { ProvisioningDispatchService } from './services/provisioning-dispatch.service';
import { PublicWithdrawalService } from './services/public-withdrawal.service';
import { ServicePlanPriceRecalcService } from './services/service-plan-price-recalc.service';
import { StoredFileRegistryService } from './services/stored-file-registry.service';
import { StoredFileSigningConfigService } from './services/stored-file-signing-config.service';
import { StoredFilesBackfillJobHandler } from './services/stored-files-backfill.job-handler';
import { SubscriptionBillingJobHandler } from './services/subscription-billing.job-handler';
import { SubscriptionChargePeriodService } from './services/subscription-charge-period.service';
import { SubscriptionConfigChangeBillingService } from './services/subscription-config-change-billing.service';
import { SubscriptionConfigChangeJobHandler } from './services/subscription-config-change.job-handler';
import { SubscriptionConfigChangeService } from './services/subscription-config-change.service';
import { SubscriptionExpirationJobHandler } from './services/subscription-expiration.job-handler';
import { SubscriptionInstantCancelJobHandler } from './services/subscription-instant-cancel.job-handler';
import { SubscriptionItemServerService } from './services/subscription-item-server.service';
import { SubscriptionItemUpdateJobHandler } from './services/subscription-item-update.job-handler';
import { SubscriptionPeriodChargeService } from './services/subscription-period-charge.service';
import { SubscriptionProvisioningJobHandler } from './services/subscription-provisioning.job-handler';
import { SubscriptionRenewalReminderJobHandler } from './services/subscription-renewal-reminder.job-handler';
import { SubscriptionTeardownService } from './services/subscription-teardown.service';
import { SubscriptionWithdrawalJobHandler } from './services/subscription-withdrawal.job-handler';
import { SubscriptionService } from './services/subscription.service';
import { SupplierContractsService } from './services/supplier-contracts.service';
import { SupplierInvoicePdfService } from './services/supplier-invoice-pdf.service';
import { SupplierInvoicesAdminService } from './services/supplier-invoices-admin.service';
import { SupplierProfilesAdminService } from './services/supplier-profiles-admin.service';
import { SupplierProfilesService } from './services/supplier-profiles.service';
import { TaxCalculationService } from './services/tax-calculation.service';
import { TaxPreviewService } from './services/tax-preview.service';
import { TaxRateConfigService } from './services/tax-rate-config.service';
import { TaxTreatmentService } from './services/tax-treatment.service';
import { TenantsGlobalViewsConfigService } from './services/tenants-global-views-config.service';
import { UsageService } from './services/usage.service';
import { VatIdValidationJobHandler } from './services/vat-id-validation.job-handler';
import { VatIdValidationService } from './services/vat-id-validation.service';
import { WithdrawalPolicyService } from './services/withdrawal-policy.service';
import { WithdrawalRefundService } from './services/withdrawal-refund.service';
import { CustomerTrustScoreService } from './trust-score/customer-trust-score.service';
import { InternalBillingTrustScoreProvider } from './trust-score/internal-billing-trust-score.provider';
import { TrustScoreProviderRegistry } from './trust-score/trust-score-provider.registry';
import { resolveContributorNestImports } from './utils/contributor-nest-registration';
import type { RegisteredContributorNestModule } from './utils/contributor-nest.types';

@Module({
  imports: [
    BillingContributorHostModule,
    HetznerContributorModule,
    DigitalOceanContributorModule,
    ContainerManagerContributorModule,
    AgenstraControllerContributorModule,
    AgenstraManagerContributorModule,
    DecabillBillingContributorModule,
    BillingIdentityEmailBridgeModule,
    BillingIdentityNotificationBridgeModule,
    BillingUpdatesModule,
    BillingSearchModule,
    TypeOrmModule.forFeature([
      ServiceTypeEntity,
      ServicePlanEntity,
      ServicePlanMeterEntity,
      ServiceTypeMeterEntity,
      CloudInitConfigEntity,
      ContributorJobRunEntity,
      ContainerStatsSampleEntity,
      ContainerStatsSummaryEntity,
      AddonEntity,
      AddonMeterEntity,
      SubscriptionAddonEntity,
      SubscriptionEntity,
      SubscriptionConfigChangeEntity,
      SubscriptionItemEntity,
      ReservedHostnameEntity,
      MeterEntity,
      UsageRecordEntity,
      InvoiceEntity,
      InvoicePromotionApplicationEntity,
      PromotionEntity,
      PromotionRedemptionEntity,
      InvoiceVoidDocumentEntity,
      InvoiceCreditDocumentEntity,
      InvoiceLineItemEntity,
      InvoiceNumberSequenceEntity,
      SubscriptionNumberSequenceEntity,
      CustomerNumberSequenceEntity,
      PaymentAttemptEntity,
      PaymentRefundEntity,
      PaymentWebhookEventEntity,
      BillingAuditLogEntity,
      OpenPositionEntity,
      ProviderPriceSnapshotEntity,
      BackorderEntity,
      AvailabilitySnapshotEntity,
      CustomerProfileEntity,
      OssThresholdLedgerEntity,
      UserEntity,
      RevokedUserTokenEntity,
      UserPersonalAccessTokenEntity,
      DatevExportEntity,
      StoredFileEntity,
      DatevDebtorAccountEntity,
      DatevCreditorAccountEntity,
      SupplierProfileEntity,
      SupplierContractEntity,
      SupplierInvoiceEntity,
      OfferEntity,
      OfferLineItemEntity,
      OfferNumberSequenceEntity,
      SupplierInvoiceLineItemEntity,
      SupplierNumberSequenceEntity,
      SupplierInvoiceNumberSequenceEntity,
      ProjectEntity,
      ProjectMilestoneEntity,
      ProjectTicketEntity,
      ProjectTicketAttachmentEntity,
      ProjectTicketCommentEntity,
      ProjectTicketActivityEntity,
      ProjectTimeEntryEntity,
      PublicWithdrawalRequestEntity,
    ]),
    RedisCacheModule,
    FileStorageModule,
    BillingIdentityEmailBridgeModule,
  ],
  controllers: [
    ServiceTypesController,
    CloudInitConfigsController,
    AddonsController,
    MetersController,
    PublicServicePlanOfferingsController,
    PublicWithdrawalController,
    ServicePlansController,
    AvailabilityController,
    SubscriptionItemsController,
    SubscriptionsController,
    BackordersController,
    PricingController,
    InvoicesController,
    PromotionsController,
    AdminPromotionsController,
    AdminOffersController,
    OffersController,
    AdminBillingController,
    AdminSubscriptionItemsController,
    AdminSubscriptionMetersController,
    AdminCustomerProfilesController,
    AdminSupplierProfilesController,
    AdminSupplierInvoicesController,
    AdminCustomerAutoBillingController,
    AdminDatevExportsController,
    AdminFileManagerController,
    PaymentsWebhookController,
    AdminUsageController,
    UsageController,
    CustomerProfilesController,
    CustomerAutoBillingController,
    ProjectsController,
    AdminProjectsController,
    ProjectMilestonesController,
    ProjectTicketsController,
    ProjectTicketAttachmentsController,
    ProjectTimeEntriesController,
  ],
  providers: [
    AvailabilityService,
    BackorderService,
    BackorderRetryJobHandler,
    BillingScheduleService,
    CancellationPolicyService,
    WithdrawalPolicyService,
    WithdrawalRefundService,
    SubscriptionTeardownService,
    SubscriptionPeriodChargeService,
    CloudInitConfigService,
    AddonService,
    MeterService,
    MeterBillingService,
    AddonLifecycleService,
    CloudInitDispatchService,
    CloudInitModuleRegistryService,
    ContributorJobRegistryService,
    ContributorMigrationService,
    ContributorCollectJobHandler,
    ProvisioningDispatchService,
    ProviderCatalogDispatchService,
    MeterCollectJobHandler,
    SearchReindexJobHandler,
    CloudflareDnsService,
    HostnameReservationService,
    ProviderServerTypesService,
    ProviderLocationsService,
    TaxRateConfigService,
    TaxTreatmentService,
    TaxCalculationService,
    VatIdValidationService,
    VatIdValidationJobHandler,
    VatIdValidationEnqueueAdapter,
    {
      provide: VAT_ID_VALIDATION_ENQUEUE,
      useExisting: VatIdValidationEnqueueAdapter,
    },
    OssThresholdLedgersRepository,
    OssThresholdService,
    InvoiceTaxContextService,
    TaxPreviewService,
    BillingIssuerConfigService,
    BillingDocumentTermsConfigService,
    AdminBillNowEnqueueAdapter,
    DatevExportEnqueueAdapter,
    PlanPriceMigrateEnqueueAdapter,
    {
      provide: ADMIN_BILL_NOW_ENQUEUE,
      useExisting: AdminBillNowEnqueueAdapter,
    },
    {
      provide: DATEV_EXPORT_ENQUEUE,
      useExisting: DatevExportEnqueueAdapter,
    },
    {
      provide: PLAN_PRICE_MIGRATE_ENQUEUE,
      useExisting: PlanPriceMigrateEnqueueAdapter,
    },
    AdminBillNowService,
    BillingAdminService,
    BillingMetricsCollectorService,
    BillingAuditLogService,
    BillingTenantService,
    TenantsGlobalViewsConfigService,
    AdminFileManagerService,
    StoredFileSigningConfigService,
    StoredFileRegistryService,
    StoredFilesBackfillJobHandler,
    BillingStatisticsQueryService,
    InvoiceAdminService,
    ManualInvoiceService,
    EInvoiceXmlService,
    EInvoiceEmbedService,
    InvoicePdfTemplateService,
    InvoicePdfHtmlRendererService,
    InvoicePdfService,
    BillingEmailPublisher,
    BillingEmailAttachmentResolver,
    {
      provide: EMAIL_ATTACHMENT_RESOLVER,
      useExisting: BillingEmailAttachmentResolver,
    },
    {
      provide: EmailDeliveryService,
      useFactory: (
        emailService: EmailService,
        templateRenderer: EmailTemplateRendererService,
        deliveriesRepository: EmailDeliveriesRepository,
        options: NotificationsModuleOptions,
        attachmentResolver: BillingEmailAttachmentResolver,
      ) => new EmailDeliveryService(emailService, templateRenderer, deliveriesRepository, options, attachmentResolver),
      inject: [
        EmailService,
        EmailTemplateRendererService,
        EmailDeliveriesRepository,
        NOTIFICATIONS_MODULE_OPTIONS,
        BillingEmailAttachmentResolver,
      ],
    },
    InvoiceService,
    InvoiceIssuanceService,
    InvoiceCreationService,
    PromotionValidationService,
    PromotionRedemptionService,
    PromotionApplicationService,
    PromotionAdminService,
    SubscriptionChargePeriodService,
    PaymentProcessorFactory,
    StripePaymentProcessor,
    DynamicProviderLoaderService,
    PaymentOrchestrationService,
    AutoBillingService,
    CustomerTrustScoreService,
    TrustScoreProviderRegistry,
    InternalBillingTrustScoreProvider,
    InvoiceAutoPaymentJobHandler,
    {
      provide: PAYMENT_PROCESSOR_INIT,
      useFactory: async (
        factory: PaymentProcessorFactory,
        stripe: StripePaymentProcessor,
        dynamicLoader: DynamicProviderLoaderService,
      ) => {
        factory.registerProcessor(stripe);

        await registerDynamicProviders<PaymentProcessor>({
          envKey: 'DYNAMIC_PAYMENT_PROCESSORS',
          criticality: 'critical',
          register: (processor) => factory.registerProcessor(processor),
          dynamicLoader,
          loggerContext: 'PaymentProcessorFactory',
        });

        return true;
      },
      inject: [PaymentProcessorFactory, StripePaymentProcessor, DynamicProviderLoaderService],
    },
    ProvisioningDispatchService,
    ProviderCatalogDispatchService,
    SubscriptionItemServerService,
    PricingService,
    ProviderPricingService,
    SubscriptionService,
    SubscriptionConfigChangeService,
    SubscriptionConfigChangeBillingService,
    ServicePlanPriceRecalcService,
    PublicWithdrawalService,
    UsageService,
    CustomerProfilesService,
    CustomerProfilesAdminService,
    SupplierProfilesService,
    SupplierProfilesAdminService,
    SupplierContractsService,
    SupplierInvoicesAdminService,
    OffersRepository,
    OfferLineItemsRepository,
    OfferNumberSequencesRepository,
    SubscriptionOrderPreparationService,
    OffersAdminService,
    OffersCustomerService,
    OfferArchiveService,
    OfferPdfService,
    OfferPdfTemplateService,
    OfferFulfillmentService,
    OfferStatisticsQueryService,
    OfferExpirationJobHandler,
    OfferFulfillmentJobHandler,
    OfferProfileSummaryService,
    SupplierInvoicePdfService,
    EInvoiceInboundParseService,
    ProjectsService,
    ProjectsAdminService,
    ProjectMilestonesService,
    ProjectTicketsService,
    ProjectTicketAttachmentsService,
    ProjectTimeEntriesService,
    ProjectBillingService,
    ProjectTimeReportService,
    ProjectTimeReportPdfService,
    ProjectTimeReportPdfTemplateService,
    ProjectBoardRealtimeService,
    BillingMeterRealtimeService,
    ProjectBoardSummaryService,
    ProjectBoardGateway,
    ProjectsRepository,
    ProjectMilestonesRepository,
    ProjectTicketsRepository,
    ProjectTicketCommentsRepository,
    ProjectTicketActivitiesRepository,
    ProjectTimeEntriesRepository,
    SubscriptionBillingJobHandler,
    SubscriptionExpirationJobHandler,
    SubscriptionWithdrawalJobHandler,
    SubscriptionInstantCancelJobHandler,
    SubscriptionProvisioningJobHandler,
    SubscriptionConfigChangeJobHandler,
    PriceRecalcJobHandler,
    SubscriptionRenewalReminderJobHandler,
    OpenPositionInvoiceJobHandler,
    SubscriptionItemUpdateJobHandler,
    EmailService,
    AvailabilitySnapshotsRepository,
    BackordersRepository,
    InvoicesRepository,
    InvoicePromotionApplicationsRepository,
    PromotionsRepository,
    PromotionRedemptionsRepository,
    InvoiceLineItemsRepository,
    InvoiceVoidDocumentsRepository,
    InvoiceCreditDocumentsRepository,
    InvoiceNumberSequencesRepository,
    SubscriptionNumberSequencesRepository,
    CustomerNumberSequencesRepository,
    PaymentAttemptsRepository,
    PaymentRefundsRepository,
    PaymentWebhookEventsRepository,
    BillingAuditLogsRepository,
    OpenPositionsRepository,
    UsersBillingDayRepository,
    ProviderPriceSnapshotsRepository,
    CloudInitConfigsRepository,
    ContributorJobRunsRepository,
    ContainerStatsSamplesRepository,
    ContainerStatsSummariesRepository,
    AddonsRepository,
    AddonMetersRepository,
    SubscriptionAddonsRepository,
    SubscriptionConfigChangesRepository,
    ServicePlansRepository,
    ServicePlanMetersRepository,
    ServiceTypeMetersRepository,
    ServiceTypesRepository,
    ReservedHostnamesRepository,
    SubscriptionItemsRepository,
    SubscriptionsRepository,
    PublicWithdrawalRequestsRepository,
    MetersRepository,
    UsageRecordsRepository,
    CustomerProfilesRepository,
    SupplierProfilesRepository,
    SupplierContractsRepository,
    SupplierInvoicesRepository,
    SupplierInvoiceLineItemsRepository,
    SupplierNumberSequencesRepository,
    SupplierInvoiceNumberSequencesRepository,
    DatevExportRepository,
    DatevDebtorAccountsRepository,
    DatevCreditorAccountsRepository,
    DatevExportConfigService,
    DatevBookingMapperService,
    DatevDebtorMapperService,
    DatevDebtorAccountService,
    DatevCreditorAccountService,
    DatevCreditorMapperService,
    DatevExtfCsvService,
    DatevDocumentArchiveService,
    DatevExportService,
    DatevExportJobHandler,
    DatevExportAdminService,
    DatevExportEnabledGuard,
    InvoiceOverdueJobHandler,
    UsersRepository,
    RevokedUserTokensRepository,
    SocketAuthService,
    BillingStatusGateway,
    TenantUserGuard,
    {
      provide: APP_GUARD,
      useClass: TenantUserGuard,
    },
  ],
  exports: [
    AdminBillNowService,
    AvailabilityService,
    BackorderService,
    BackorderRetryJobHandler,
    BillingScheduleService,
    BillingTenantService,
    TenantsGlobalViewsConfigService,
    BillingEmailAttachmentResolver,
    EMAIL_ATTACHMENT_RESOLVER,
    EmailDeliveryService,
    CancellationPolicyService,
    CloudflareDnsService,
    HostnameReservationService,
    InvoiceCreationService,
    InvoiceService,
    InvoiceOverdueJobHandler,
    InvoiceAutoPaymentJobHandler,
    AutoBillingService,
    PaymentOrchestrationService,
    ProvisioningDispatchService,
    ProviderCatalogDispatchService,
    SubscriptionItemServerService,
    PricingService,
    ProviderPricingService,
    SubscriptionService,
    SubscriptionConfigChangeService,
    SubscriptionConfigChangeBillingService,
    ServicePlanPriceRecalcService,
    PublicWithdrawalService,
    UsageService,
    CustomerProfilesService,
    CustomerTrustScoreService,
    SubscriptionBillingJobHandler,
    SubscriptionExpirationJobHandler,
    SubscriptionWithdrawalJobHandler,
    SubscriptionInstantCancelJobHandler,
    SubscriptionProvisioningJobHandler,
    SubscriptionConfigChangeJobHandler,
    PriceRecalcJobHandler,
    MeterCollectJobHandler,
    ContributorCollectJobHandler,
    ContributorMigrationService,
    SubscriptionRenewalReminderJobHandler,
    OpenPositionInvoiceJobHandler,
    OfferExpirationJobHandler,
    OfferFulfillmentJobHandler,
    SubscriptionItemUpdateJobHandler,
    EmailService,
    AvailabilitySnapshotsRepository,
    BackordersRepository,
    InvoicesRepository,
    OpenPositionsRepository,
    UsersBillingDayRepository,
    ProviderPriceSnapshotsRepository,
    ServicePlansRepository,
    ServiceTypesRepository,
    ReservedHostnamesRepository,
    SubscriptionItemsRepository,
    SubscriptionsRepository,
    PublicWithdrawalRequestsRepository,
    UsageRecordsRepository,
    CustomerProfilesRepository,
    ProjectsService,
    ProjectsRepository,
    DatevExportJobHandler,
    VatIdValidationJobHandler,
    DatevExportConfigService,
    BillingContributorHostModule,
    SearchReindexJobHandler,
    StoredFilesBackfillJobHandler,
    BillingSearchModule,
    BillingIdentityEmailBridgeModule,
    BillingIdentityNotificationBridgeModule,
    BillingUpdatesModule,
    ContainerManagerContributorModule,
  ],
})
export class BillingModule implements OnModuleInit {
  private static extraContributorModules: RegisteredContributorNestModule[] = [];

  static withContributors(extra?: RegisteredContributorNestModule[]): DynamicModule {
    if (extra !== undefined) {
      BillingModule.extraContributorModules = extra;
    }

    const nestModules = resolveContributorNestImports(BillingModule.extraContributorModules);

    return {
      module: BillingModule,
      imports: nestModules,
      exports: [ContainerManagerContributorModule],
    };
  }

  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    private readonly providerModuleRegistry: ProviderModuleRegistryService,
    private readonly dynamicLoader: DynamicProviderLoaderService,
    private readonly trustScoreProviderRegistry: TrustScoreProviderRegistry,
    private readonly internalBillingTrustScoreProvider: InternalBillingTrustScoreProvider,
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly integratedStackRegistry: IntegratedStackRegistryService,
    private readonly cloudInitModuleRegistry: CloudInitModuleRegistryService,
    private readonly contributorJobRegistry: ContributorJobRegistryService,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerDynamicProviderMetadata({
      envKey: 'DYNAMIC_BILLING_PROVIDER_METADATA',
      criticality: 'optional',
      register: (metadata) => this.providerRegistry.register(metadata),
      dynamicLoader: this.dynamicLoader,
      loggerContext: 'ProviderRegistryService',
    });

    await registerDynamicProviders<BillingProviderModule>({
      envKey: 'DYNAMIC_BILLING_PROVIDER_MODULES',
      criticality: 'optional',
      register: (module) => this.providerModuleRegistry.register(module),
      dynamicLoader: this.dynamicLoader,
      loggerContext: 'ProviderModuleRegistryService',
    });

    await registerDynamicProviders<BillingAddonModule>({
      envKey: 'DYNAMIC_ADDON_MODULES',
      criticality: 'optional',
      register: (module) => this.addonModuleRegistry.register(module),
      dynamicLoader: this.dynamicLoader,
      loggerContext: 'AddonModuleRegistryService',
    });

    await registerDynamicProviders<IntegratedStackModule>({
      envKey: 'DYNAMIC_INTEGRATED_STACK_MODULES',
      criticality: 'optional',
      register: (module) => this.integratedStackRegistry.register(module),
      dynamicLoader: this.dynamicLoader,
      loggerContext: 'IntegratedStackRegistryService',
    });

    await registerDynamicProviders<CloudInitConfigModule>({
      envKey: 'DYNAMIC_CLOUD_INIT_MODULES',
      criticality: 'optional',
      register: (module) => this.cloudInitModuleRegistry.register(module),
      dynamicLoader: this.dynamicLoader,
      loggerContext: 'CloudInitModuleRegistryService',
    });

    this.contributorJobRegistry.rebuild();

    this.trustScoreProviderRegistry.register(this.internalBillingTrustScoreProvider);
  }
}
