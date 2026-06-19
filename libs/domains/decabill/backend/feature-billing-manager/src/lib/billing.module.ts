import {
  getAuthenticationMethod,
  KeycloakService,
  SocketAuthService,
  UserEntity,
  UsersRepository,
} from '@forepath/identity/backend';
import {
  BILLING_PROVISIONING_PROVIDER_REGISTRY,
  DECABILL_EXTENSION_KINDS,
  DecabillPluginHostModule,
  PAYMENT_PROCESSOR_REGISTRY,
} from '@forepath/decabill/backend/util-plugin-host';
import { EmailService } from '@forepath/shared/backend';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakConnectModule } from 'nest-keycloak-connect';
import { AdminBillingController } from './controllers/admin-billing.controller';
import { AdminCustomerProfilesController } from './controllers/admin-customer-profiles.controller';
import { AvailabilityController } from './controllers/availability.controller';
import { BackordersController } from './controllers/backorders.controller';
import { CustomerProfilesController } from './controllers/customer-profiles.controller';
import { InvoicesController } from './controllers/invoices.controller';
import { PaymentsWebhookController } from './controllers/payments-webhook.controller';
import { PricingController } from './controllers/pricing.controller';
import { PublicServicePlanOfferingsController } from './controllers/public-service-plan-offerings.controller';
import { ServicePlansController } from './controllers/service-plans.controller';
import { ServiceTypesController } from './controllers/service-types.controller';
import { SubscriptionItemsController } from './controllers/subscription-items.controller';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { UsageController } from './controllers/usage.controller';
import { AvailabilitySnapshotEntity } from './entities/availability-snapshot.entity';
import { BackorderEntity } from './entities/backorder.entity';
import { BillingAuditLogEntity } from './entities/billing-audit-log.entity';
import { CustomerProfileEntity } from './entities/customer-profile.entity';
import { InvoiceLineItemEntity } from './entities/invoice-line-item.entity';
import { InvoiceNumberSequenceEntity } from './entities/invoice-number-sequence.entity';
import { InvoiceVoidDocumentEntity } from './entities/invoice-void-document.entity';
import { InvoiceEntity } from './entities/invoice.entity';
import { OpenPositionEntity } from './entities/open-position.entity';
import { PaymentAttemptEntity } from './entities/payment-attempt.entity';
import { PaymentWebhookEventEntity } from './entities/payment-webhook-event.entity';
import { ProviderPriceSnapshotEntity } from './entities/provider-price-snapshot.entity';
import { ReservedHostnameEntity } from './entities/reserved-hostname.entity';
import { ServicePlanEntity } from './entities/service-plan.entity';
import { ServiceTypeEntity } from './entities/service-type.entity';
import { SubscriptionItemEntity } from './entities/subscription-item.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { UsageRecordEntity } from './entities/usage-record.entity';
import { BillingStatusGateway } from './gateways/billing-status.gateway';
import { TenantUserGuard } from './guards/tenant-user.guard';
import { AdminBillNowEnqueueAdapter } from './queue/admin-bill-now-enqueue.adapter';
import { ADMIN_BILL_NOW_ENQUEUE } from './queue/admin-bill-now-enqueue.token';
import { AvailabilitySnapshotsRepository } from './repositories/availability-snapshots.repository';
import { BackordersRepository } from './repositories/backorders.repository';
import { BillingAuditLogsRepository } from './repositories/billing-audit-logs.repository';
import { CustomerProfilesRepository } from './repositories/customer-profiles.repository';
import { InvoiceLineItemsRepository } from './repositories/invoice-line-items.repository';
import { InvoiceNumberSequencesRepository } from './repositories/invoice-number-sequences.repository';
import { InvoiceVoidDocumentsRepository } from './repositories/invoice-void-documents.repository';
import { InvoicesRepository } from './repositories/invoices.repository';
import { OpenPositionsRepository } from './repositories/open-positions.repository';
import { PaymentAttemptsRepository } from './repositories/payment-attempts.repository';
import { PaymentWebhookEventsRepository } from './repositories/payment-webhook-events.repository';
import { ProviderPriceSnapshotsRepository } from './repositories/provider-price-snapshots.repository';
import { ReservedHostnamesRepository } from './repositories/reserved-hostnames.repository';
import { ServicePlansRepository } from './repositories/service-plans.repository';
import { ServiceTypesRepository } from './repositories/service-types.repository';
import { SubscriptionItemsRepository } from './repositories/subscription-items.repository';
import { SubscriptionsRepository } from './repositories/subscriptions.repository';
import { UsageRecordsRepository } from './repositories/usage-records.repository';
import { UsersBillingDayRepository } from './repositories/users-billing-day.repository';
import { AdminBillNowService } from './services/admin-bill-now.service';
import { AvailabilityService } from './services/availability.service';
import { BackorderRetryJobHandler } from './services/backorder-retry.job-handler';
import { BackorderService } from './services/backorder.service';
import { BillingAdminService } from './services/billing-admin.service';
import { BillingAuditLogService } from './services/billing-audit-log.service';
import { BillingTenantService } from './services/billing-tenant.service';
import { BillingIssuerConfigService } from './services/billing-issuer-config.service';
import { BillingScheduleService } from './services/billing-schedule.service';
import { BillingStatisticsQueryService } from './services/billing-statistics-query.service';
import { CancellationPolicyService } from './services/cancellation-policy.service';
import { CloudflareDnsService } from './services/cloudflare-dns.service';
import { CustomerProfilesService } from './services/customer-profiles.service';
import { CustomerProfilesAdminService } from './services/customer-profiles-admin.service';
import { EInvoiceEmbedService } from './services/e-invoice-embed.service';
import { EInvoiceXmlService } from './services/e-invoice-xml.service';
import { HostnameReservationService } from './services/hostname-reservation.service';
import { InvoiceAdminService } from './services/invoice-admin.service';
import { InvoiceCreationService } from './services/invoice-creation.service';
import { ManualInvoiceService } from './services/manual-invoice.service';
import { InvoiceEmailService } from './services/invoice-email.service';
import { InvoiceIssuanceService } from './services/invoice-issuance.service';
import { InvoiceOverdueJobHandler } from './services/invoice-overdue.job-handler';
import { InvoicePdfHtmlRendererService } from './services/invoice-pdf-html-renderer.service';
import { InvoicePdfTemplateService } from './services/invoice-pdf-template.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { InvoiceService } from './services/invoice.service';
import { OpenPositionInvoiceJobHandler } from './services/open-position-invoice.job-handler';
import { PaymentOrchestrationService } from './services/payment-orchestration.service';
import { PricingService } from './services/pricing.service';
import { ProviderPricingService } from './services/provider-pricing.service';
import { ProviderServerTypesService } from './services/provider-server-types.service';
import { ProvisioningService } from './services/provisioning.service';
import { SshExecutorService } from './services/ssh-executor.service';
import { SubscriptionBillingJobHandler } from './services/subscription-billing.job-handler';
import { SubscriptionExpirationJobHandler } from './services/subscription-expiration.job-handler';
import { SubscriptionItemServerService } from './services/subscription-item-server.service';
import { SubscriptionItemUpdateJobHandler } from './services/subscription-item-update.job-handler';
import { SubscriptionRenewalReminderJobHandler } from './services/subscription-renewal-reminder.job-handler';
import { SubscriptionService } from './services/subscription.service';
import { TaxCalculationService } from './services/tax-calculation.service';
import { TaxRateConfigService } from './services/tax-rate-config.service';
import { UsageService } from './services/usage.service';

const authMethod = getAuthenticationMethod();

@Module({
  imports: [
    DecabillPluginHostModule.forRootAsync({
      kind: DECABILL_EXTENSION_KINDS.PAYMENT_PROCESSOR,
      registryToken: PAYMENT_PROCESSOR_REGISTRY,
      extensionsEnvKey: 'BILLING_PAYMENT_PROCESSORS',
      defaultExtensions: ['@forepath/decabill/backend/provider-stripe'],
    }),
    DecabillPluginHostModule.forRootAsync({
      kind: DECABILL_EXTENSION_KINDS.BILLING_PROVISIONING_PROVIDER,
      registryToken: BILLING_PROVISIONING_PROVIDER_REGISTRY,
      extensionsEnvKey: 'BILLING_PROVISIONING_PROVIDERS',
      defaultExtensions: [
        '@forepath/decabill/backend/provider-hetzner',
        '@forepath/decabill/backend/provider-digital-ocean',
      ],
    }),
    TypeOrmModule.forFeature([
      ServiceTypeEntity,
      ServicePlanEntity,
      SubscriptionEntity,
      SubscriptionItemEntity,
      ReservedHostnameEntity,
      UsageRecordEntity,
      InvoiceEntity,
      InvoiceVoidDocumentEntity,
      InvoiceLineItemEntity,
      InvoiceNumberSequenceEntity,
      PaymentAttemptEntity,
      PaymentWebhookEventEntity,
      BillingAuditLogEntity,
      OpenPositionEntity,
      ProviderPriceSnapshotEntity,
      BackorderEntity,
      AvailabilitySnapshotEntity,
      CustomerProfileEntity,
      UserEntity,
    ]),
    ...(authMethod === 'keycloak' ? [KeycloakConnectModule.registerAsync({ useExisting: KeycloakService })] : []),
  ],
  controllers: [
    ServiceTypesController,
    PublicServicePlanOfferingsController,
    ServicePlansController,
    AvailabilityController,
    SubscriptionItemsController,
    SubscriptionsController,
    BackordersController,
    PricingController,
    InvoicesController,
    AdminBillingController,
    AdminCustomerProfilesController,
    PaymentsWebhookController,
    UsageController,
    CustomerProfilesController,
  ],
  providers: [
    AvailabilityService,
    BackorderService,
    BackorderRetryJobHandler,
    BillingScheduleService,
    CancellationPolicyService,
    CloudflareDnsService,
    HostnameReservationService,
    ProviderServerTypesService,
    TaxRateConfigService,
    TaxCalculationService,
    BillingIssuerConfigService,
    AdminBillNowEnqueueAdapter,
    {
      provide: ADMIN_BILL_NOW_ENQUEUE,
      useExisting: AdminBillNowEnqueueAdapter,
    },
    AdminBillNowService,
    BillingAdminService,
    BillingAuditLogService,
    BillingTenantService,
    BillingStatisticsQueryService,
    InvoiceAdminService,
    ManualInvoiceService,
    EInvoiceXmlService,
    EInvoiceEmbedService,
    InvoicePdfTemplateService,
    InvoicePdfHtmlRendererService,
    InvoicePdfService,
    InvoiceEmailService,
    InvoiceService,
    InvoiceIssuanceService,
    InvoiceCreationService,
    PaymentOrchestrationService,
    ProvisioningService,
    SubscriptionItemServerService,
    PricingService,
    ProviderPricingService,
    SubscriptionService,
    UsageService,
    CustomerProfilesService,
    CustomerProfilesAdminService,
    SubscriptionBillingJobHandler,
    SubscriptionExpirationJobHandler,
    SubscriptionRenewalReminderJobHandler,
    OpenPositionInvoiceJobHandler,
    SubscriptionItemUpdateJobHandler,
    EmailService,
    AvailabilitySnapshotsRepository,
    BackordersRepository,
    InvoicesRepository,
    InvoiceLineItemsRepository,
    InvoiceVoidDocumentsRepository,
    InvoiceNumberSequencesRepository,
    PaymentAttemptsRepository,
    PaymentWebhookEventsRepository,
    BillingAuditLogsRepository,
    OpenPositionsRepository,
    UsersBillingDayRepository,
    ProviderPriceSnapshotsRepository,
    ServicePlansRepository,
    ServiceTypesRepository,
    ReservedHostnamesRepository,
    SubscriptionItemsRepository,
    SubscriptionsRepository,
    UsageRecordsRepository,
    CustomerProfilesRepository,
    InvoiceOverdueJobHandler,
    SshExecutorService,
    UsersRepository,
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
    CancellationPolicyService,
    CloudflareDnsService,
    HostnameReservationService,
    InvoiceCreationService,
    InvoiceService,
    InvoiceOverdueJobHandler,
    PaymentOrchestrationService,
    ProvisioningService,
    SubscriptionItemServerService,
    PricingService,
    ProviderPricingService,
    SubscriptionService,
    UsageService,
    CustomerProfilesService,
    SubscriptionBillingJobHandler,
    SubscriptionExpirationJobHandler,
    SubscriptionRenewalReminderJobHandler,
    OpenPositionInvoiceJobHandler,
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
    UsageRecordsRepository,
    CustomerProfilesRepository,
  ],
})
export class BillingModule {}
