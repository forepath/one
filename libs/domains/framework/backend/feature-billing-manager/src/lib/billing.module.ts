import {
  getAuthenticationMethod,
  KeycloakService,
  SocketAuthService,
  UserEntity,
  UsersRepository,
} from '@forepath/identity/backend';
import { EmailService } from '@forepath/shared/backend';
import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakConnectModule } from 'nest-keycloak-connect';

import { PAYMENT_PROCESSOR_INIT } from './constants/payment-processor-init.token';
import { AdminBillingController } from './controllers/admin-billing.controller';
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
import { PaymentProcessorFactory } from './payment-processors/payment-processor.factory';
import { StripePaymentProcessor } from './payment-processors/processors/stripe-payment.processor';
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
import { AvailabilityService } from './services/availability.service';
import { BackorderRetryJobHandler } from './services/backorder-retry.job-handler';
import { BackorderService } from './services/backorder.service';
import { BillingAdminService } from './services/billing-admin.service';
import { BillingAuditLogService } from './services/billing-audit-log.service';
import { BillingIssuerConfigService } from './services/billing-issuer-config.service';
import { BillingScheduleService } from './services/billing-schedule.service';
import { BillingStatisticsQueryService } from './services/billing-statistics-query.service';
import { CancellationPolicyService } from './services/cancellation-policy.service';
import { CloudflareDnsService } from './services/cloudflare-dns.service';
import { CustomerProfilesService } from './services/customer-profiles.service';
import { DigitaloceanProvisioningService } from './services/digitalocean-provisioning.service';
import { EInvoiceEmbedService } from './services/e-invoice-embed.service';
import { EInvoiceXmlService } from './services/e-invoice-xml.service';
import { HetznerProvisioningService } from './services/hetzner-provisioning.service';
import { HostnameReservationService } from './services/hostname-reservation.service';
import { InvoiceAdminService } from './services/invoice-admin.service';
import { InvoiceCreationService } from './services/invoice-creation.service';
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
import { ProviderRegistryService } from './services/provider-registry.service';
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
/**
 * Default config schema for Hetzner provisioning (serverType, location, optional firewallId).
 * Matches the shape expected by HetznerProvisioningService.provisionServer.
 * - basePriceFromField: when set, the UI fetches options from GET .../server-types and uses the selected option's price as plan base price.
 * - properties may include optional `enum` arrays for static options, or the field named in basePriceFromField gets options from the server-types API.
 */
const HETZNER_CONFIG_SCHEMA: Record<string, unknown> = {
  required: ['serverType', 'location', 'service'],
  basePriceFromField: 'serverType',
  properties: {
    service: {
      type: 'string',
      description: 'Product service: controller (full stack) or manager (agent manager only)',
      enum: ['controller', 'manager'],
    },
    serverType: {
      type: 'string',
      description: 'Hetzner server type (options and price from API)',
    },
    location: {
      type: 'string',
      description: 'Hetzner location',
      enum: ['fsn1', 'nbg1', 'hel1', 'ash', 'hil', 'sgp'],
    },
    firewallId: { type: 'number', description: 'Optional firewall ID to attach to server' },
    authenticationMethod: {
      type: 'string',
      description: 'Authentication method for the agent (users, api-key, keycloak)',
    },
    staticApiKey: {
      type: 'string',
      description: 'Static API key (required when authenticationMethod is api-key)',
    },
    disableSignup: { type: 'boolean', description: 'Whether to disable user signup' },
    smtp: {
      type: 'object',
      description: 'SMTP configuration for email',
      properties: {
        host: { type: 'string' },
        port: { type: 'number' },
        user: { type: 'string' },
        password: { type: 'string' },
        from: { type: 'string' },
      },
    },
    keycloak: {
      type: 'object',
      description: 'Keycloak configuration (when authenticationMethod is keycloak)',
      properties: {
        serverUrl: { type: 'string' },
        authServerUrl: { type: 'string' },
        realm: { type: 'string' },
        clientId: { type: 'string' },
        clientSecret: { type: 'string' },
      },
    },
    hetznerApiToken: {
      type: 'string',
      description: 'Optional Hetzner API token for nested provisioning from the instance',
    },
    digitaloceanApiToken: {
      type: 'string',
      description: 'Optional DigitalOcean API token for nested provisioning from the instance',
    },
    git: {
      type: 'object',
      description: 'Optional Git configuration for manager instances (GIT_* env vars)',
      properties: {
        setupMode: {
          type: 'string',
          description: 'Repository setup mode: clone from remote or empty local repository (git init)',
          enum: ['clone', 'empty'],
        },
        repositoryUrl: { type: 'string', description: 'Git repository URL' },
        username: { type: 'string', description: 'Git username (HTTPS)' },
        token: { type: 'string', description: 'Git token (e.g. PAT)' },
        password: { type: 'string', description: 'Git password (alternative to token)' },
        privateKey: { type: 'string', description: 'SSH private key for git@ URLs' },
        commitAuthorName: { type: 'string', description: 'Default commit author name' },
        commitAuthorEmail: { type: 'string', description: 'Default commit author email' },
      },
    },
    cursorApiKey: {
      type: 'string',
      description: 'Optional Cursor API key for manager instances (CURSOR_API_KEY env var). Sensitive.',
    },
  },
};
const DIGITALOCEAN_CONFIG_SCHEMA: Record<string, unknown> = {
  required: ['serverType', 'region', 'service'],
  basePriceFromField: 'serverType',
  properties: {
    service: {
      type: 'string',
      description: 'Product service: controller (full stack) or manager (agent manager only)',
      enum: ['controller', 'manager'],
    },
    serverType: {
      type: 'string',
      description: 'DigitalOcean droplet size (options and price from API)',
    },
    region: {
      type: 'string',
      description: 'DigitalOcean region',
      enum: ['ams3', 'blr1', 'fra1', 'lon1', 'nyc1', 'nyc3', 'sfo2', 'sfo3', 'sgp1', 'syd1', 'tor1'],
    },
    authenticationMethod: {
      type: 'string',
      description: 'Authentication method for the agent (users, api-key, keycloak)',
    },
    staticApiKey: {
      type: 'string',
      description: 'Static API key (required when authenticationMethod is api-key)',
    },
    disableSignup: { type: 'boolean', description: 'Whether to disable user signup' },
    smtp: {
      type: 'object',
      description: 'SMTP configuration for email',
      properties: {
        host: { type: 'string' },
        port: { type: 'number' },
        user: { type: 'string' },
        password: { type: 'string' },
        from: { type: 'string' },
      },
    },
    keycloak: {
      type: 'object',
      description: 'Keycloak configuration (when authenticationMethod is keycloak)',
      properties: {
        serverUrl: { type: 'string' },
        authServerUrl: { type: 'string' },
        realm: { type: 'string' },
        clientId: { type: 'string' },
        clientSecret: { type: 'string' },
      },
    },
    hetznerApiToken: {
      type: 'string',
      description: 'Optional Hetzner API token for nested provisioning from the instance',
    },
    digitaloceanApiToken: {
      type: 'string',
      description: 'Optional DigitalOcean API token for nested provisioning from the instance',
    },
    git: {
      type: 'object',
      description: 'Optional Git configuration for manager instances (GIT_* env vars)',
      properties: {
        setupMode: {
          type: 'string',
          description: 'Repository setup mode: clone from remote or empty local repository (git init)',
          enum: ['clone', 'empty'],
        },
        repositoryUrl: { type: 'string', description: 'Git repository URL' },
        username: { type: 'string', description: 'Git username (HTTPS)' },
        token: { type: 'string', description: 'Git token (e.g. PAT)' },
        password: { type: 'string', description: 'Git password (alternative to token)' },
        privateKey: { type: 'string', description: 'SSH private key for git@ URLs' },
        commitAuthorName: { type: 'string', description: 'Default commit author name' },
        commitAuthorEmail: { type: 'string', description: 'Default commit author email' },
      },
    },
    cursorApiKey: {
      type: 'string',
      description: 'Optional Cursor API key for manager instances (CURSOR_API_KEY env var). Sensitive.',
    },
  },
};

@Module({
  imports: [
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
    DigitaloceanProvisioningService,
    HostnameReservationService,
    HetznerProvisioningService,
    ProviderRegistryService,
    ProviderServerTypesService,
    TaxRateConfigService,
    TaxCalculationService,
    BillingIssuerConfigService,
    BillingAdminService,
    BillingAuditLogService,
    BillingStatisticsQueryService,
    InvoiceAdminService,
    EInvoiceXmlService,
    EInvoiceEmbedService,
    InvoicePdfTemplateService,
    InvoicePdfHtmlRendererService,
    InvoicePdfService,
    InvoiceService,
    InvoiceIssuanceService,
    InvoiceCreationService,
    PaymentProcessorFactory,
    StripePaymentProcessor,
    PaymentOrchestrationService,
    {
      provide: PAYMENT_PROCESSOR_INIT,
      useFactory: (factory: PaymentProcessorFactory, stripe: StripePaymentProcessor) => {
        factory.registerProcessor(stripe);

        return true;
      },
      inject: [PaymentProcessorFactory, StripePaymentProcessor],
    },
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
  ],
  exports: [
    AvailabilityService,
    BackorderService,
    BackorderRetryJobHandler,
    BillingScheduleService,
    CancellationPolicyService,
    CloudflareDnsService,
    DigitaloceanProvisioningService,
    HostnameReservationService,
    HetznerProvisioningService,
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
    ProviderRegistryService,
  ],
})
export class BillingModule implements OnModuleInit {
  constructor(private readonly providerRegistry: ProviderRegistryService) {}

  onModuleInit(): void {
    this.providerRegistry.register({
      id: 'hetzner',
      displayName: 'Hetzner Cloud',
      configSchema: HETZNER_CONFIG_SCHEMA,
    });
    this.providerRegistry.register({
      id: 'digital-ocean',
      displayName: 'DigitalOcean',
      configSchema: DIGITALOCEAN_CONFIG_SCHEMA,
    });
  }
}
