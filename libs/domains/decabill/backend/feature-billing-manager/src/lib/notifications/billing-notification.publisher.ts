import { IIdentityNotificationPublisher } from '@forepath/identity/backend';
import { getTenantIdOrDefault, NotificationDispatcherService } from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';

import type { InvoiceEntity } from '../entities/invoice.entity';
import type { AddonEntity } from '../entities/addon.entity';
import type { ServicePlanEntity } from '../entities/service-plan.entity';
import type { SubscriptionAddonEntity } from '../entities/subscription-addon.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import type { DatevExportEntity } from '../entities/datev-export.entity';
import type { ProjectMilestoneResponseDto } from '../projects/dto/project-milestone.dto';
import type { ProjectTicketCommentResponseDto, ProjectTicketResponseDto } from '../projects/dto/project-ticket.dto';
import type { ProjectTimeEntryResponseDto } from '../projects/dto/project-time-entry.dto';
import type { ProjectResponseDto } from '../projects/dto/project.dto';
import type { ProjectMilestoneEntity } from '../projects/entities/project-milestone.entity';
import type { ProjectTicketEntity } from '../projects/entities/project-ticket.entity';
import type { ProjectTimeEntryEntity } from '../projects/entities/project-time-entry.entity';
import type { ProjectEntity } from '../projects/entities/project.entity';

import { BILLING_NOTIFICATION_EVENTS, type BillingNotificationEventType } from './billing-notification.events';

export { BILLING_NOTIFICATION_EVENTS, type BillingNotificationEventType };

/** Webhook-safe provision failure text: no multiline blobs or overly long provider dumps. */
export function sanitizeProvisioningErrorMessage(message: string): string {
  const normalized = message.replace(/[\r\n\t]+/g, ' ').trim();

  if (!normalized) {
    return 'Provisioning failed';
  }

  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

export type SubscriptionPlanBillingFields = Pick<ServicePlanEntity, 'billInAdvance' | 'billingIntervalType'>;

export type SubscriptionWebhookEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancel_scheduled'
  | 'subscription.canceled'
  | 'subscription.resumed'
  | 'subscription.config_change_requested'
  | 'subscription.config_changed'
  | 'subscription.config_change_failed'
  | 'subscription.ssh_access_granted'
  | 'subscription.provisioned'
  | 'subscription.provision_failed';

/**
 * Config-change webhook context. Only identifiers and status live here: the requested payload can
 * carry addon credentials and must never leave the database.
 */
export type ConfigChangeNotificationContext = {
  configChangeId: string;
  appliedSteps?: string[];
  billingOutcome?: string | null;
  errorCode?: string | null;
};

export type MilestoneNotificationPayload = {
  id: string;
  projectId: string;
  name?: string | null;
  description?: string | null;
  targetDate?: string | null;
  sortOrder?: number | null;
  lockedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type TimeEntryNotificationPayload = {
  id: string;
  projectId: string;
  ticketId?: string | null;
  recordedByUserId?: string | null;
  durationMinutes?: number | null;
  description?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  invoiceId?: string | null;
  billedAt?: string | null;
  createdAt?: string | null;
};

export type TicketNotificationPayload = {
  id: string;
  projectId: string;
  parentId?: string | null;
  milestoneId?: string | null;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  locked?: boolean | null;
  createdByUserId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type TicketCommentNotificationPayload = {
  id: string;
  ticketId: string;
  projectId: string;
  userId?: string | null;
  body: string;
  createdAt: string;
};

@Injectable()
export class BillingNotificationPublisher implements IIdentityNotificationPublisher {
  constructor(private readonly dispatcher: NotificationDispatcherService) {}

  publish(type: BillingNotificationEventType, data: Record<string, unknown>, clientId?: string): void {
    this.dispatcher.publishFireAndForget({
      type,
      scopeKey: getTenantIdOrDefault(),
      clientId,
      data,
    });
  }

  publishUserCreated(data: Record<string, unknown>): void {
    this.publish('user.created', data);
  }

  publishUserUpdated(data: Record<string, unknown>): void {
    this.publish('user.updated', data);
  }

  publishUserDeleted(data: Record<string, unknown>): void {
    this.publish('user.deleted', data);
  }

  publishClientUserCreated(_data: Record<string, unknown>, _clientId: string): void {
    // Decabill does not use client-user membership webhooks.
  }

  publishClientUserDeleted(_data: Record<string, unknown>, _clientId: string): void {
    // Decabill does not use client-user membership webhooks.
  }

  publishInvoice(type: 'invoice.created' | 'invoice.issued' | 'invoice.voided', invoice: InvoiceEntity): void {
    this.publish(type, this.toInvoicePayload(invoice), invoice.userId);
  }

  publishPayment(
    type: 'payment.initiated' | 'payment.succeeded' | 'payment.failed',
    invoice: InvoiceEntity,
    context: Record<string, unknown> = {},
  ): void {
    this.publish(type, { ...this.toInvoicePayload(invoice), ...context }, invoice.userId);
  }

  publishSubscription(
    type: SubscriptionWebhookEventType,
    subscription: SubscriptionEntity,
    plan?: SubscriptionPlanBillingFields,
    extras?: { addons?: Array<{ id: string; key: string; name: string; periodPrice?: number }> },
  ): void {
    this.publish(
      type,
      {
        ...this.toSubscriptionPayload(subscription, plan),
        ...(extras?.addons && extras.addons.length > 0 ? { addons: extras.addons } : {}),
      },
      subscription.userId,
    );
  }

  /**
   * Metadata-only SSH access grant webhook. Never include private key material.
   */
  publishSshAccessGranted(params: {
    subscription: SubscriptionEntity;
    itemId: string;
    hostname?: string;
    grantedAt: Date;
  }): void {
    this.publish(
      'subscription.ssh_access_granted',
      {
        subscriptionId: params.subscription.id,
        subscriptionNumber: params.subscription.number ?? null,
        itemId: params.itemId,
        hostname: params.hostname ?? null,
        grantedAt: this.toIsoString(params.grantedAt),
      },
      params.subscription.userId,
    );
  }

  /**
   * Fired when a subscription item finishes cloud provisioning successfully.
   */
  publishSubscriptionProvisioned(params: {
    subscription: SubscriptionEntity;
    plan?: SubscriptionPlanBillingFields;
    itemId: string;
    hostname?: string | null;
    service?: string | null;
    providerReference?: string | null;
  }): void {
    this.publish(
      'subscription.provisioned',
      {
        ...this.toSubscriptionPayload(params.subscription, params.plan),
        itemId: params.itemId,
        hostname: params.hostname ?? null,
        service: params.service ?? null,
        providerReference: params.providerReference ?? null,
      },
      params.subscription.userId,
    );
  }

  /**
   * Fired when cloud provisioning fails for a subscription item.
   * Never include secrets from config snapshots. Error text is sanitized for webhooks.
   */
  publishSubscriptionProvisionFailed(params: {
    subscription: SubscriptionEntity;
    plan?: SubscriptionPlanBillingFields;
    itemId: string;
    errorMessage: string;
    providerReference?: string | null;
  }): void {
    this.publish(
      'subscription.provision_failed',
      {
        ...this.toSubscriptionPayload(params.subscription, params.plan),
        itemId: params.itemId,
        errorMessage: sanitizeProvisioningErrorMessage(params.errorMessage),
        providerReference: params.providerReference ?? null,
      },
      params.subscription.userId,
    );
  }

  publishAddon(
    type: 'addon.activated' | 'addon.deactivated' | 'addon.provision_failed' | 'addon.teardown_failed',
    params: {
      subscription: SubscriptionEntity;
      plan: Pick<ServicePlanEntity, 'id' | 'name' | 'billInAdvance' | 'billingIntervalType'>;
      addon: Pick<AddonEntity, 'id' | 'key' | 'name'>;
      subscriptionAddon: Pick<SubscriptionAddonEntity, 'id' | 'status' | 'activatedAt' | 'deactivatedAt'>;
      errorMessage?: string;
    },
  ): void {
    this.publish(
      type,
      {
        subscriptionId: params.subscription.id,
        subscriptionNumber: params.subscription.number ?? null,
        planId: params.plan.id,
        planName: params.plan.name,
        billInAdvance: params.plan.billInAdvance,
        billingIntervalType: params.plan.billingIntervalType,
        addonId: params.addon.id,
        addonKey: params.addon.key,
        addonName: params.addon.name,
        subscriptionAddonId: params.subscriptionAddon.id,
        status: params.subscriptionAddon.status,
        activatedAt: this.toIsoString(params.subscriptionAddon.activatedAt),
        deactivatedAt: this.toIsoString(params.subscriptionAddon.deactivatedAt),
        ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
      },
      params.subscription.userId,
    );
  }

  publishConfigChangeRequested(
    subscription: SubscriptionEntity,
    plan: SubscriptionPlanBillingFields,
    context: ConfigChangeNotificationContext,
  ): void {
    this.publishConfigChange('subscription.config_change_requested', subscription, plan, context);
  }

  publishConfigChanged(
    subscription: SubscriptionEntity,
    plan: SubscriptionPlanBillingFields,
    context: ConfigChangeNotificationContext,
  ): void {
    this.publishConfigChange('subscription.config_changed', subscription, plan, context);
  }

  publishConfigChangeFailed(
    subscription: SubscriptionEntity,
    plan: SubscriptionPlanBillingFields,
    context: ConfigChangeNotificationContext,
  ): void {
    this.publishConfigChange('subscription.config_change_failed', subscription, plan, context);
  }

  private publishConfigChange(
    type: 'subscription.config_change_requested' | 'subscription.config_changed' | 'subscription.config_change_failed',
    subscription: SubscriptionEntity,
    plan: SubscriptionPlanBillingFields,
    context: ConfigChangeNotificationContext,
  ): void {
    this.publish(
      type,
      {
        ...this.toSubscriptionPayload(subscription, plan),
        configChangeId: context.configChangeId,
        appliedSteps: context.appliedSteps ?? [],
        billingOutcome: context.billingOutcome ?? null,
        errorCode: context.errorCode ?? null,
      },
      subscription.userId,
    );
  }

  publishPeriodCharged(
    subscription: SubscriptionEntity,
    plan: SubscriptionPlanBillingFields,
    billUntil: Date,
    periodStart: Date,
    periodEnd: Date,
    meterCharges?: Array<Record<string, unknown>>,
  ): void {
    this.publish(
      'subscription.period_charged',
      {
        ...this.toSubscriptionPayload(subscription, plan),
        billUntil: billUntil.toISOString(),
        chargedPeriodStart: periodStart.toISOString(),
        chargedPeriodEnd: periodEnd.toISOString(),
        meterCharges: meterCharges ?? [],
      },
      subscription.userId,
    );
  }

  publishProject(
    type: 'project.created' | 'project.updated' | 'project.deleted',
    project: ProjectEntity | ProjectResponseDto,
  ): void {
    this.publish(type, this.toProjectPayload(project), project.userId);
  }

  publishMilestone(
    type: 'milestone.created' | 'milestone.updated' | 'milestone.deleted',
    projectUserId: string,
    milestone: ProjectMilestoneEntity | ProjectMilestoneResponseDto | MilestoneNotificationPayload,
  ): void {
    this.publish(type, this.toMilestonePayload(milestone), projectUserId);
  }

  publishTimeEntry(
    type: 'time_entry.created' | 'time_entry.updated' | 'time_entry.deleted',
    projectUserId: string,
    entry: ProjectTimeEntryEntity | ProjectTimeEntryResponseDto | TimeEntryNotificationPayload,
  ): void {
    this.publish(type, this.toTimeEntryPayload(entry), projectUserId);
  }

  publishTicket(
    type: 'ticket.created' | 'ticket.updated' | 'ticket.deleted',
    projectUserId: string,
    ticket: ProjectTicketEntity | ProjectTicketResponseDto | TicketNotificationPayload,
  ): void {
    this.publish(type, this.toTicketPayload(ticket), projectUserId);
  }

  publishTicketComment(
    projectUserId: string,
    projectId: string,
    comment: ProjectTicketCommentResponseDto | TicketCommentNotificationPayload,
  ): void {
    this.publish('ticket.comment.created', this.toTicketCommentPayload(projectId, comment), projectUserId);
  }

  publishDatevExport(
    type: 'datev_export.started' | 'datev_export.completed' | 'datev_export.failed',
    exportRecord: DatevExportEntity,
  ): void {
    this.publish(type, this.toDatevExportPayload(exportRecord));
  }

  publishServicePlanPriceRecalculated(
    servicePlan: Pick<ServicePlanEntity, 'id' | 'name'>,
    context: {
      runDate: string;
      oldPeriodPriceNet?: number | null;
      newPeriodPriceNet?: number | null;
      subscriptionsAffected?: number;
    },
  ): void {
    this.publish('service_plan.price_recalculated', {
      servicePlanId: servicePlan.id,
      servicePlanName: servicePlan.name,
      runDate: context.runDate,
      oldPeriodPriceNet: context.oldPeriodPriceNet ?? null,
      newPeriodPriceNet: context.newPeriodPriceNet ?? null,
      subscriptionsAffected: context.subscriptionsAffected ?? null,
    });
  }

  publishSubscriptionPriceChanged(
    subscription: SubscriptionEntity,
    plan: SubscriptionPlanBillingFields,
    context: {
      runDate: string;
      productName: string;
      oldNet: number;
      oldTax: number;
      oldTotal: number;
      newNet: number;
      newTax: number;
      newTotal: number;
    },
  ): void {
    this.publish(
      'subscription.price_changed',
      {
        ...this.toSubscriptionPayload(subscription, plan),
        runDate: context.runDate,
        productName: context.productName,
        oldNet: context.oldNet,
        oldTax: context.oldTax,
        oldTotal: context.oldTotal,
        newNet: context.newNet,
        newTax: context.newTax,
        newTotal: context.newTotal,
      },
      subscription.userId,
    );
  }

  private toInvoicePayload(invoice: InvoiceEntity): Record<string, unknown> {
    return {
      id: invoice.id,
      subscriptionId: invoice.subscriptionId ?? null,
      projectId: invoice.projectId ?? null,
      userId: invoice.userId,
      invoiceNumber: invoice.invoiceNumber ?? null,
      status: invoice.status,
      currency: invoice.currency,
      totalGross: Number(invoice.totalGross),
      balanceDue: Number(invoice.balanceDue),
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      voidedAt: invoice.voidedAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
    };
  }

  private toSubscriptionPayload(
    subscription: SubscriptionEntity,
    plan?: SubscriptionPlanBillingFields,
  ): Record<string, unknown> {
    return {
      id: subscription.id,
      number: subscription.number,
      planId: subscription.planId,
      userId: subscription.userId,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      nextBillingAt: subscription.nextBillingAt?.toISOString() ?? null,
      cancelRequestedAt: subscription.cancelRequestedAt?.toISOString() ?? null,
      cancelEffectiveAt: subscription.cancelEffectiveAt?.toISOString() ?? null,
      billInAdvance: plan?.billInAdvance === true,
      billingIntervalType: plan?.billingIntervalType ?? null,
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
    };
  }

  private toProjectPayload(project: ProjectEntity | ProjectResponseDto): Record<string, unknown> {
    return {
      id: project.id,
      userId: project.userId,
      name: project.name,
      description: project.description ?? null,
      status: project.status,
      hourlyRateNet: Number(project.hourlyRateNet),
      targetHours: project.targetHours != null ? Number(project.targetHours) : null,
      currency: project.currency,
      createdAt: this.toIsoString(project.createdAt),
      updatedAt: this.toIsoString(project.updatedAt),
    };
  }

  private toMilestonePayload(
    milestone: ProjectMilestoneEntity | ProjectMilestoneResponseDto | MilestoneNotificationPayload,
  ): Record<string, unknown> {
    return {
      id: milestone.id,
      projectId: milestone.projectId,
      name: 'name' in milestone ? (milestone.name ?? null) : null,
      description: 'description' in milestone ? (milestone.description ?? null) : null,
      targetDate: 'targetDate' in milestone ? this.toIsoString(milestone.targetDate) : null,
      sortOrder: 'sortOrder' in milestone ? (milestone.sortOrder ?? null) : null,
      lockedAt: 'lockedAt' in milestone ? this.toIsoString(milestone.lockedAt) : null,
      createdAt: this.toIsoString(milestone.createdAt),
      updatedAt: this.toIsoString(milestone.updatedAt),
    };
  }

  private toTimeEntryPayload(
    entry: ProjectTimeEntryEntity | ProjectTimeEntryResponseDto | TimeEntryNotificationPayload,
  ): Record<string, unknown> {
    return {
      id: entry.id,
      projectId: entry.projectId,
      ticketId: 'ticketId' in entry ? (entry.ticketId ?? null) : null,
      recordedByUserId: 'recordedByUserId' in entry ? (entry.recordedByUserId ?? null) : null,
      durationMinutes: 'durationMinutes' in entry ? (entry.durationMinutes ?? null) : null,
      description: 'description' in entry ? (entry.description ?? null) : null,
      startedAt: 'startedAt' in entry ? this.toIsoString(entry.startedAt) : null,
      endedAt: 'endedAt' in entry ? this.toIsoString(entry.endedAt) : null,
      invoiceId: 'invoiceId' in entry ? (entry.invoiceId ?? null) : null,
      billedAt: 'billedAt' in entry ? this.toIsoString(entry.billedAt) : null,
      createdAt: this.toIsoString(entry.createdAt),
    };
  }

  private toTicketPayload(
    ticket: ProjectTicketEntity | ProjectTicketResponseDto | TicketNotificationPayload,
  ): Record<string, unknown> {
    return {
      id: ticket.id,
      projectId: ticket.projectId,
      parentId: 'parentId' in ticket ? (ticket.parentId ?? null) : null,
      milestoneId: 'milestoneId' in ticket ? (ticket.milestoneId ?? null) : null,
      title: 'title' in ticket ? (ticket.title ?? null) : null,
      status: 'status' in ticket ? (ticket.status ?? null) : null,
      priority: 'priority' in ticket ? (ticket.priority ?? null) : null,
      locked: 'locked' in ticket ? (ticket.locked ?? null) : null,
      createdByUserId: 'createdByUserId' in ticket ? (ticket.createdByUserId ?? null) : null,
      createdAt: this.toIsoString(ticket.createdAt),
      updatedAt: this.toIsoString(ticket.updatedAt),
    };
  }

  private toTicketCommentPayload(
    projectId: string,
    comment: ProjectTicketCommentResponseDto | TicketCommentNotificationPayload,
  ): Record<string, unknown> {
    return {
      id: comment.id,
      ticketId: comment.ticketId,
      projectId: 'projectId' in comment ? comment.projectId : projectId,
      userId: 'userId' in comment ? (comment.userId ?? null) : null,
      body: comment.body,
      createdAt: this.toIsoString(comment.createdAt),
    };
  }

  private toDatevExportPayload(exportRecord: DatevExportEntity): Record<string, unknown> {
    return {
      id: exportRecord.id,
      scope: exportRecord.scope,
      tenantId: exportRecord.tenantId,
      periodYear: exportRecord.periodYear,
      periodMonth: exportRecord.periodMonth,
      status: exportRecord.status,
      fileName: exportRecord.fileName ?? null,
      bookingCount: exportRecord.bookingCount,
      invoiceCount: exportRecord.invoiceCount,
      debtorCount: exportRecord.debtorCount,
      includedTenantIds: exportRecord.includedTenantIds ?? null,
      triggeredBy: exportRecord.triggeredBy ?? null,
      errorMessage: exportRecord.errorMessage ?? null,
      startedAt: this.toIsoString(exportRecord.startedAt),
      completedAt: this.toIsoString(exportRecord.completedAt),
      createdAt: this.toIsoString(exportRecord.createdAt),
      updatedAt: this.toIsoString(exportRecord.updatedAt),
    };
  }

  private toIsoString(value: Date | string | null | undefined): string | null {
    if (value == null) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
