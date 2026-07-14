import {
  AdminBillNowService,
  BackorderRetryJobHandler,
  BillingTenantService,
  type AdminBillNowCoordinatorPayload,
  DatevExportConfigService,
  DatevExportJobHandler,
  DatevExportScope,
  InvoiceOverdueJobHandler,
  OpenPositionInvoiceJobHandler,
  SubscriptionBillingJobHandler,
  SubscriptionExpirationJobHandler,
  SubscriptionItemUpdateJobHandler,
  SubscriptionProvisioningJobHandler,
  SubscriptionRenewalReminderJobHandler,
  SubscriptionWithdrawalJobHandler,
} from '@forepath/decabill/backend';
import {
  DEFAULT_TENANT,
  enqueueUnitJob,
  runWithTenantId,
  resolveWebhookDeliverJobPayload,
  WEBHOOK_DELIVER_JOB_NAME,
  WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
  WebhookDeliveryRetentionService,
  WebhookDeliveryService,
  type WebhookDeliverJobPayload,
} from '@forepath/shared/backend';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

import { BILLING_QUEUE_NAME, BillingJobName } from '../job-registry';
import {
  requireTenantIdForEnqueue,
  resolveBillingJobTenantId,
  type BillingJobTenantPayload,
} from '../resolve-billing-job-tenant-id';

type TenantScopedPayload = BillingJobTenantPayload;

@Processor(BILLING_QUEUE_NAME, { concurrency: parseInt(process.env.QUEUE_WORKER_CONCURRENCY ?? '5', 10) })
export class BillingJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingJobsProcessor.name);

  constructor(
    @InjectQueue(BILLING_QUEUE_NAME) private readonly billingQueue: Queue,
    private readonly billingTenantService: BillingTenantService,
    private readonly subscriptionBilling: SubscriptionBillingJobHandler,
    private readonly subscriptionExpiration: SubscriptionExpirationJobHandler,
    private readonly subscriptionWithdrawal: SubscriptionWithdrawalJobHandler,
    private readonly subscriptionProvisioning: SubscriptionProvisioningJobHandler,
    private readonly invoiceOverdue: InvoiceOverdueJobHandler,
    private readonly openPositionInvoice: OpenPositionInvoiceJobHandler,
    private readonly renewalReminder: SubscriptionRenewalReminderJobHandler,
    private readonly subscriptionItemUpdate: SubscriptionItemUpdateJobHandler,
    private readonly backorderRetry: BackorderRetryJobHandler,
    private readonly adminBillNow: AdminBillNowService,
    private readonly datevExportConfig: DatevExportConfigService,
    private readonly datevExportJobHandler: DatevExportJobHandler,
    private readonly webhookDeliveryService: WebhookDeliveryService,
    private readonly webhookDeliveryRetentionService: WebhookDeliveryRetentionService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case WEBHOOK_DELIVER_JOB_NAME:
        await this.runWebhookDeliver(job);
        break;
      case WEBHOOK_DELIVERY_RETENTION_COORDINATOR:
        await this.webhookDeliveryRetentionService.applyRetentionForAllEndpoints();
        break;
      case BillingJobName.SUBSCRIPTION_BILLING_COORDINATOR:
        await this.runSubscriptionBillingCoordinator();
        break;
      case BillingJobName.SUBSCRIPTION_EXPIRATION_COORDINATOR:
        await this.runSubscriptionExpirationCoordinator();
        break;
      case BillingJobName.SUBSCRIPTION_WITHDRAWAL_COORDINATOR:
        await this.runSubscriptionWithdrawalCoordinator();
        break;
      case BillingJobName.SUBSCRIPTION_PROVISIONING_COORDINATOR:
        await this.runSubscriptionProvisioningCoordinator();
        break;
      case BillingJobName.INVOICE_OVERDUE_COORDINATOR:
        await this.runInvoiceOverdueCoordinator();
        break;
      case BillingJobName.OPEN_POSITION_INVOICE_COORDINATOR:
        await this.runOpenPositionInvoiceCoordinator();
        break;
      case BillingJobName.RENEWAL_REMINDER_COORDINATOR:
        await this.runRenewalReminderCoordinator();
        break;
      case BillingJobName.SUBSCRIPTION_ITEM_UPDATE_COORDINATOR:
        await this.runSubscriptionItemUpdateCoordinator();
        break;
      case BillingJobName.BACKORDER_RETRY_COORDINATOR:
        await this.runBackorderRetryCoordinator();
        break;
      case BillingJobName.DATEV_EXPORT_COORDINATOR:
        await this.runDatevExportCoordinator();
        break;
      case BillingJobName.DATEV_EXPORT_UNIT:
        await this.runDatevExportUnit(
          job.data as {
            tenantId: string;
            scope: DatevExportScope;
            year: number;
            month: number;
            triggeredBy: string;
            force?: boolean;
          },
        );
        break;
      case BillingJobName.ADMIN_BILL_NOW_COORDINATOR:
        await this.runWithJobTenant(job, job.data as TenantScopedPayload, () =>
          this.runAdminBillNowCoordinator(job.data as AdminBillNowCoordinatorPayload),
        );
        break;
      default:
        await this.runWithJobTenant(job, job.data as TenantScopedPayload, async () => {
          switch (job.name) {
            case BillingJobName.SUBSCRIPTION_BILLING_UNIT:
              await this.subscriptionBilling.processSubscription(
                (job.data as { subscriptionId: string }).subscriptionId,
              );
              break;
            case BillingJobName.SUBSCRIPTION_EXPIRATION_UNIT:
              await this.subscriptionExpiration.processSubscriptionCancellation(
                (job.data as { subscriptionId: string }).subscriptionId,
              );
              break;
            case BillingJobName.SUBSCRIPTION_WITHDRAWAL_UNIT:
              await this.subscriptionWithdrawal.processSubscriptionWithdrawal(
                (job.data as { subscriptionId: string }).subscriptionId,
              );
              break;
            case BillingJobName.SUBSCRIPTION_PROVISIONING_UNIT:
              await this.subscriptionProvisioning.processItemProvisioning(
                (job.data as { subscriptionItemId: string }).subscriptionItemId,
              );
              break;
            case BillingJobName.INVOICE_OVERDUE_UNIT:
              await this.invoiceOverdue.markOverdueIfNeeded((job.data as { invoiceRefId: string }).invoiceRefId);
              break;
            case BillingJobName.OPEN_POSITION_INVOICE_UNIT:
              await this.runOpenPositionInvoiceUnit(
                job.data as {
                  userId: string;
                  triggeredBy?: string;
                  scope?: 'all' | 'user';
                  requestId?: string;
                },
              );
              break;
            case BillingJobName.RENEWAL_REMINDER_UNIT:
              await this.renewalReminder.processReminder(job.data as { subscriptionId: string; periodKey: string });
              break;
            case BillingJobName.SUBSCRIPTION_ITEM_UPDATE_UNIT:
              await this.subscriptionItemUpdate.updateItem(
                (job.data as { subscriptionItemId: string }).subscriptionItemId,
              );
              break;
            case BillingJobName.BACKORDER_RETRY_UNIT:
              await this.backorderRetry.retryBackorder((job.data as { backorderId: string }).backorderId);
              break;
            case BillingJobName.ADMIN_BILL_NOW_UNIT:
              await this.runOpenPositionInvoiceUnit(job.data as AdminBillNowCoordinatorPayload & { userId: string });
              break;
            default:
              this.logger.warn(`Unknown billing job name: ${job.name}`);
          }
        });
    }
  }

  private async runWebhookDeliver(job: Job<WebhookDeliverJobPayload>): Promise<void> {
    const payload = resolveWebhookDeliverJobPayload(job);
    await runWithTenantId(payload.scopeKey, () => this.webhookDeliveryService.deliver(payload));
  }

  private async runWithJobTenant<T>(job: Job, data: TenantScopedPayload, run: () => Promise<T>): Promise<T> {
    const tenantId = resolveBillingJobTenantId(data, { jobName: job.name, jobId: String(job.id) }, this.logger);

    return runWithTenantId(tenantId, run);
  }

  private async enqueueBillingUnitJob<T extends TenantScopedPayload & Record<string, unknown>>(options: {
    queue: Queue;
    jobName: string;
    payload: T;
    jobIdNamespace: string;
    jobIdParts: Array<string | number | undefined>;
  }): Promise<void> {
    const tenantId = requireTenantIdForEnqueue(options.jobName, options.payload);

    await enqueueUnitJob({
      ...options,
      payload: { ...options.payload, tenantId },
    });
  }

  private async forEachConfiguredTenant(run: (tenantId: string) => Promise<void>): Promise<void> {
    for (const tenantId of this.billingTenantService.getConfiguredTenants()) {
      await runWithTenantId(tenantId, () => run(tenantId));
    }
  }

  private async runSubscriptionBillingCoordinator(): Promise<void> {
    await this.forEachConfiguredTenant(async (tenantId) => {
      const ids = await this.subscriptionBilling.findDueSubscriptionIds();

      for (const subscriptionId of ids) {
        await this.enqueueBillingUnitJob({
          queue: this.billingQueue,
          jobName: BillingJobName.SUBSCRIPTION_BILLING_UNIT,
          payload: { subscriptionId, tenantId },
          jobIdNamespace: 'billing:subscription',
          jobIdParts: [tenantId, subscriptionId],
        });
      }
    });
  }

  private async runSubscriptionExpirationCoordinator(): Promise<void> {
    await this.forEachConfiguredTenant(async (tenantId) => {
      const ids = await this.subscriptionExpiration.findExpiredSubscriptionIds();

      for (const subscriptionId of ids) {
        await this.enqueueBillingUnitJob({
          queue: this.billingQueue,
          jobName: BillingJobName.SUBSCRIPTION_EXPIRATION_UNIT,
          payload: { subscriptionId, tenantId },
          jobIdNamespace: 'expiration:subscription',
          jobIdParts: [tenantId, subscriptionId],
        });
      }
    });
  }

  private async runSubscriptionWithdrawalCoordinator(): Promise<void> {
    await this.forEachConfiguredTenant(async (tenantId) => {
      const ids = await this.subscriptionWithdrawal.findPendingWithdrawalIds();

      for (const subscriptionId of ids) {
        await this.enqueueBillingUnitJob({
          queue: this.billingQueue,
          jobName: BillingJobName.SUBSCRIPTION_WITHDRAWAL_UNIT,
          payload: { subscriptionId, tenantId },
          jobIdNamespace: 'withdrawal:subscription',
          jobIdParts: [tenantId, subscriptionId],
        });
      }
    });
  }

  private async runSubscriptionProvisioningCoordinator(): Promise<void> {
    await this.forEachConfiguredTenant(async (tenantId) => {
      const ids = await this.subscriptionProvisioning.findPendingProvisioningItemIds();

      for (const subscriptionItemId of ids) {
        await this.enqueueBillingUnitJob({
          queue: this.billingQueue,
          jobName: BillingJobName.SUBSCRIPTION_PROVISIONING_UNIT,
          payload: { subscriptionItemId, tenantId },
          jobIdNamespace: 'provisioning:subscription-item',
          jobIdParts: [tenantId, subscriptionItemId],
        });
      }
    });
  }

  private async runInvoiceOverdueCoordinator(): Promise<void> {
    await this.forEachConfiguredTenant(async (tenantId) => {
      let offset = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const ids = await this.invoiceOverdue.findInvoiceIdsPage(offset);

        if (ids.length === 0) {
          break;
        }

        for (const invoiceRefId of ids) {
          await this.enqueueBillingUnitJob({
            queue: this.billingQueue,
            jobName: BillingJobName.INVOICE_OVERDUE_UNIT,
            payload: { invoiceRefId, tenantId },
            jobIdNamespace: 'invoice-overdue:ref',
            jobIdParts: [tenantId, invoiceRefId],
          });
        }

        offset += ids.length;

        if (ids.length < this.invoiceOverdue.batchSizeLimit) {
          break;
        }
      }
    });
  }

  private async runOpenPositionInvoiceCoordinator(): Promise<void> {
    await this.forEachConfiguredTenant(async (tenantId) => {
      const userIds = await this.openPositionInvoice.findUserIdsForTodayBillingDay();

      for (const userId of userIds) {
        await this.enqueueBillingUnitJob({
          queue: this.billingQueue,
          jobName: BillingJobName.OPEN_POSITION_INVOICE_UNIT,
          payload: { userId, tenantId },
          jobIdNamespace: 'open-position-invoice:user',
          jobIdParts: [tenantId, userId],
        });
      }
    });
  }

  private async runRenewalReminderCoordinator(): Promise<void> {
    if (!this.renewalReminder.isEmailEnabled()) {
      return;
    }

    await this.forEachConfiguredTenant(async (tenantId) => {
      const units = await this.renewalReminder.findUpcomingReminderUnits();

      for (const unit of units) {
        await this.enqueueBillingUnitJob({
          queue: this.billingQueue,
          jobName: BillingJobName.RENEWAL_REMINDER_UNIT,
          payload: { ...unit, tenantId },
          jobIdNamespace: 'renewal-reminder',
          jobIdParts: [tenantId, unit.periodKey],
        });
      }
    });
  }

  private async runSubscriptionItemUpdateCoordinator(): Promise<void> {
    await this.forEachConfiguredTenant(async (tenantId) => {
      const ids = await this.subscriptionItemUpdate.findProvisionedItemIds();

      for (const subscriptionItemId of ids) {
        await this.enqueueBillingUnitJob({
          queue: this.billingQueue,
          jobName: BillingJobName.SUBSCRIPTION_ITEM_UPDATE_UNIT,
          payload: { subscriptionItemId, tenantId },
          jobIdNamespace: 'subscription-item-update',
          jobIdParts: [tenantId, subscriptionItemId],
        });
      }
    });
  }

  private async runBackorderRetryCoordinator(): Promise<void> {
    await this.forEachConfiguredTenant(async (tenantId) => {
      const ids = await this.backorderRetry.findPendingBackorderIds();

      for (const backorderId of ids) {
        await this.enqueueBillingUnitJob({
          queue: this.billingQueue,
          jobName: BillingJobName.BACKORDER_RETRY_UNIT,
          payload: { backorderId, tenantId },
          jobIdNamespace: 'backorder-retry',
          jobIdParts: [tenantId, backorderId],
        });
      }
    });
  }

  private async runDatevExportCoordinator(): Promise<void> {
    if (!this.datevExportConfig.isEnabled()) {
      this.logger.debug('DATEV export disabled — skipping coordinator');

      return;
    }

    const { year, month } = this.datevExportJobHandler.resolvePreviousMonth();

    for (const tenantId of this.billingTenantService.getConfiguredTenants()) {
      const tenantConfig = this.datevExportConfig.resolveForTenant(tenantId);

      if (!tenantConfig) {
        this.logger.warn(`Skipping DATEV export for tenant ${tenantId} — configuration incomplete`);
        continue;
      }

      const skip = await this.datevExportJobHandler.shouldSkipExport(DatevExportScope.TENANT, tenantId, year, month);

      if (skip) {
        continue;
      }

      await this.billingQueue.add(
        BillingJobName.DATEV_EXPORT_UNIT,
        {
          tenantId,
          scope: DatevExportScope.TENANT,
          year,
          month,
          triggeredBy: 'scheduler',
        },
        {
          jobId: `datev-export.tenant.${tenantId}.${year}-${String(month).padStart(2, '0')}`,
        },
      );
    }

    if (this.datevExportConfig.isUnifiedExportEnabled()) {
      const skipUnified = await this.datevExportJobHandler.shouldSkipExport(
        DatevExportScope.UNIFIED,
        DEFAULT_TENANT,
        year,
        month,
      );

      if (!skipUnified) {
        await this.billingQueue.add(
          BillingJobName.DATEV_EXPORT_UNIT,
          {
            tenantId: DEFAULT_TENANT,
            scope: DatevExportScope.UNIFIED,
            year,
            month,
            triggeredBy: 'scheduler',
          },
          {
            jobId: `datev-export.unified.${year}-${String(month).padStart(2, '0')}`,
          },
        );
      }
    }
  }

  private async runDatevExportUnit(data: {
    tenantId: string;
    scope: DatevExportScope;
    year: number;
    month: number;
    triggeredBy: string;
    force?: boolean;
  }): Promise<void> {
    if (!this.datevExportConfig.isEnabled()) {
      this.logger.debug('DATEV export disabled — skipping unit job');

      return;
    }

    if (data.scope === DatevExportScope.TENANT) {
      await runWithTenantId(data.tenantId, () => this.datevExportJobHandler.runUnit(data));

      return;
    }

    await this.datevExportJobHandler.runUnit(data);
  }

  private async runAdminBillNowCoordinator(data: AdminBillNowCoordinatorPayload): Promise<void> {
    const tenantId = resolveBillingJobTenantId(
      data,
      { jobName: BillingJobName.ADMIN_BILL_NOW_COORDINATOR },
      this.logger,
    );
    const userIds = await this.adminBillNow.resolveTargetUserIds({ userId: data.userId });

    for (const userId of userIds) {
      await this.enqueueBillingUnitJob({
        queue: this.billingQueue,
        jobName: BillingJobName.ADMIN_BILL_NOW_UNIT,
        payload: {
          userId,
          tenantId,
          adminUserId: data.adminUserId,
          triggeredBy: data.adminUserId,
          scope: data.scope,
          requestId: data.requestId,
        },
        jobIdNamespace: 'admin-bill-now:user',
        jobIdParts: [tenantId, userId, data.requestId],
      });
    }
  }

  private async runOpenPositionInvoiceUnit(data: {
    userId: string;
    triggeredBy?: string;
    scope?: 'all' | 'user';
    requestId?: string;
  }): Promise<void> {
    await this.openPositionInvoice.processUserOpenPositions(data.userId, {
      triggeredBy: data.triggeredBy,
      scope: data.scope,
      requestId: data.requestId,
    });
  }
}
