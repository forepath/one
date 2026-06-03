import {
  BackorderRetryJobHandler,
  InvoiceOverdueJobHandler,
  OpenPositionInvoiceJobHandler,
  SubscriptionBillingJobHandler,
  SubscriptionExpirationJobHandler,
  SubscriptionItemUpdateJobHandler,
  SubscriptionRenewalReminderJobHandler,
} from '@forepath/framework/backend';
import { enqueueUnitJob } from '@forepath/shared/backend';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

import { BILLING_QUEUE_NAME, BillingJobName } from '../job-registry';

@Processor(BILLING_QUEUE_NAME, { concurrency: parseInt(process.env.QUEUE_WORKER_CONCURRENCY ?? '5', 10) })
export class BillingJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingJobsProcessor.name);

  constructor(
    @InjectQueue(BILLING_QUEUE_NAME) private readonly billingQueue: Queue,
    private readonly subscriptionBilling: SubscriptionBillingJobHandler,
    private readonly subscriptionExpiration: SubscriptionExpirationJobHandler,
    private readonly invoiceOverdue: InvoiceOverdueJobHandler,
    private readonly openPositionInvoice: OpenPositionInvoiceJobHandler,
    private readonly renewalReminder: SubscriptionRenewalReminderJobHandler,
    private readonly subscriptionItemUpdate: SubscriptionItemUpdateJobHandler,
    private readonly backorderRetry: BackorderRetryJobHandler,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case BillingJobName.SUBSCRIPTION_BILLING_COORDINATOR:
        await this.runSubscriptionBillingCoordinator();
        break;
      case BillingJobName.SUBSCRIPTION_BILLING_UNIT:
        await this.subscriptionBilling.processSubscription((job.data as { subscriptionId: string }).subscriptionId);
        break;
      case BillingJobName.SUBSCRIPTION_EXPIRATION_COORDINATOR:
        await this.runSubscriptionExpirationCoordinator();
        break;
      case BillingJobName.SUBSCRIPTION_EXPIRATION_UNIT:
        await this.subscriptionExpiration.processSubscriptionCancellation(
          (job.data as { subscriptionId: string }).subscriptionId,
        );
        break;
      case BillingJobName.INVOICE_OVERDUE_COORDINATOR:
        await this.runInvoiceOverdueCoordinator();
        break;
      case BillingJobName.INVOICE_OVERDUE_UNIT:
        await this.invoiceOverdue.markOverdueIfNeeded((job.data as { invoiceRefId: string }).invoiceRefId);
        break;
      case BillingJobName.OPEN_POSITION_INVOICE_COORDINATOR:
        await this.runOpenPositionInvoiceCoordinator();
        break;
      case BillingJobName.OPEN_POSITION_INVOICE_UNIT:
        await this.openPositionInvoice.processUserOpenPositions((job.data as { userId: string }).userId);
        break;
      case BillingJobName.RENEWAL_REMINDER_COORDINATOR:
        await this.runRenewalReminderCoordinator();
        break;
      case BillingJobName.RENEWAL_REMINDER_UNIT:
        await this.renewalReminder.processReminder(job.data as { subscriptionId: string; periodKey: string });
        break;
      case BillingJobName.SUBSCRIPTION_ITEM_UPDATE_COORDINATOR:
        await this.runSubscriptionItemUpdateCoordinator();
        break;
      case BillingJobName.SUBSCRIPTION_ITEM_UPDATE_UNIT:
        await this.subscriptionItemUpdate.updateItem((job.data as { subscriptionItemId: string }).subscriptionItemId);
        break;
      case BillingJobName.BACKORDER_RETRY_COORDINATOR:
        await this.runBackorderRetryCoordinator();
        break;
      case BillingJobName.BACKORDER_RETRY_UNIT:
        await this.backorderRetry.retryBackorder((job.data as { backorderId: string }).backorderId);
        break;
      default:
        this.logger.warn(`Unknown billing job name: ${job.name}`);
    }
  }

  private async runSubscriptionBillingCoordinator(): Promise<void> {
    const ids = await this.subscriptionBilling.findDueSubscriptionIds();

    for (const subscriptionId of ids) {
      await enqueueUnitJob({
        queue: this.billingQueue,
        jobName: BillingJobName.SUBSCRIPTION_BILLING_UNIT,
        payload: { subscriptionId },
        jobIdNamespace: 'billing:subscription',
        jobIdParts: [subscriptionId],
      });
    }
  }

  private async runSubscriptionExpirationCoordinator(): Promise<void> {
    const ids = await this.subscriptionExpiration.findExpiredSubscriptionIds();

    for (const subscriptionId of ids) {
      await enqueueUnitJob({
        queue: this.billingQueue,
        jobName: BillingJobName.SUBSCRIPTION_EXPIRATION_UNIT,
        payload: { subscriptionId },
        jobIdNamespace: 'expiration:subscription',
        jobIdParts: [subscriptionId],
      });
    }
  }

  private async runInvoiceOverdueCoordinator(): Promise<void> {
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ids = await this.invoiceOverdue.findInvoiceIdsPage(offset);

      if (ids.length === 0) {
        break;
      }

      for (const invoiceRefId of ids) {
        await enqueueUnitJob({
          queue: this.billingQueue,
          jobName: BillingJobName.INVOICE_OVERDUE_UNIT,
          payload: { invoiceRefId },
          jobIdNamespace: 'invoice-overdue:ref',
          jobIdParts: [invoiceRefId],
        });
      }

      offset += ids.length;

      if (ids.length < this.invoiceOverdue.batchSizeLimit) {
        break;
      }
    }
  }

  private async runOpenPositionInvoiceCoordinator(): Promise<void> {
    const userIds = await this.openPositionInvoice.findUserIdsForTodayBillingDay();

    for (const userId of userIds) {
      await enqueueUnitJob({
        queue: this.billingQueue,
        jobName: BillingJobName.OPEN_POSITION_INVOICE_UNIT,
        payload: { userId },
        jobIdNamespace: 'open-position-invoice:user',
        jobIdParts: [userId],
      });
    }
  }

  private async runRenewalReminderCoordinator(): Promise<void> {
    if (!this.renewalReminder.isEmailEnabled()) {
      return;
    }

    const units = await this.renewalReminder.findUpcomingReminderUnits();

    for (const unit of units) {
      await enqueueUnitJob({
        queue: this.billingQueue,
        jobName: BillingJobName.RENEWAL_REMINDER_UNIT,
        payload: unit,
        jobIdNamespace: 'renewal-reminder',
        jobIdParts: [unit.periodKey],
      });
    }
  }

  private async runSubscriptionItemUpdateCoordinator(): Promise<void> {
    const ids = await this.subscriptionItemUpdate.findProvisionedItemIds();

    for (const subscriptionItemId of ids) {
      await enqueueUnitJob({
        queue: this.billingQueue,
        jobName: BillingJobName.SUBSCRIPTION_ITEM_UPDATE_UNIT,
        payload: { subscriptionItemId },
        jobIdNamespace: 'subscription-item-update',
        jobIdParts: [subscriptionItemId],
      });
    }
  }

  private async runBackorderRetryCoordinator(): Promise<void> {
    const ids = await this.backorderRetry.findPendingBackorderIds();

    for (const backorderId of ids) {
      await enqueueUnitJob({
        queue: this.billingQueue,
        jobName: BillingJobName.BACKORDER_RETRY_UNIT,
        payload: { backorderId },
        jobIdNamespace: 'backorder-retry',
        jobIdParts: [backorderId],
      });
    }
  }
}
