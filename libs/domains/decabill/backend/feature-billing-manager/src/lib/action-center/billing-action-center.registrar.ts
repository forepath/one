import {
  ActionCenterRegistry,
  ActionCenterService,
  PlatformEmailDeliveryActionSource,
  PlatformUpdatesActionSource,
  PlatformWebhooksActionSource,
  toActionCenterSilenceWebhookPayload,
  UpdatesQueryService,
} from '@forepath/shared/backend';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';

import { BillingDeliveryActionSource } from './billing-delivery.action-source';
import { BillingDocumentsActionSource } from './billing-documents.action-source';
import { BillingOperationsActionSource } from './billing-operations.action-source';
import { BillingPartnersActionSource } from './billing-partners.action-source';
import { BillingSetupActionSource } from './billing-setup.action-source';

/**
 * Wires Decabill into the shared action center: registers the billing sources (plus the shared platform sources for
 * updates, webhooks and email delivery), turns every published billing event into a change signal (changes made by
 * queue workers reach connected consoles as fast as HTTP changes) and publishes changes of silences for everyone as webhook events.
 */
@Injectable()
export class BillingActionCenterRegistrar implements OnModuleInit, OnModuleDestroy {
  private readonly removeListeners: Array<() => void> = [];

  constructor(
    private readonly registry: ActionCenterRegistry,
    private readonly actionCenter: ActionCenterService,
    private readonly publisher: BillingNotificationPublisher,
    private readonly dataSource: DataSource,
    private readonly updatesQuery: UpdatesQueryService,
    private readonly documents: BillingDocumentsActionSource,
    private readonly partners: BillingPartnersActionSource,
    private readonly operations: BillingOperationsActionSource,
    private readonly setup: BillingSetupActionSource,
    private readonly delivery: BillingDeliveryActionSource,
  ) {}

  onModuleInit(): void {
    // The product module may be instantiated twice per process (app + queue module): wire only once.
    if (!this.actionCenter.claimWiring('decabill.registrar')) {
      return;
    }

    this.registry.register(
      this.setup,
      this.documents,
      this.partners,
      this.operations,
      this.delivery,
      new PlatformUpdatesActionSource(() => this.updatesQuery.getStatusSummary()),
      new PlatformWebhooksActionSource(this.dataSource),
      // SMTP settings are tenant settings on the admin-only settings page.
      new PlatformEmailDeliveryActionSource(this.dataSource, 'admin'),
    );
    this.removeListeners.push(
      this.publisher.addListener((type, scopeKey) => {
        if (!type.startsWith('action_center.')) {
          this.actionCenter.signalChange(scopeKey);
        }
      }),
      // Silence changes become webhook events (`action_center.silence.*`) of the request tenant.
      // Only silences for everyone: personal silences stay private (the API hides them from other users, too).
      this.actionCenter.onSilenceChange((change) => {
        if (change.silence.audience !== 'everyone') {
          return;
        }

        this.publisher.publish(
          change.change === 'created' ? 'action_center.silence.created' : 'action_center.silence.removed',
          toActionCenterSilenceWebhookPayload(change),
        );
      }),
    );
  }

  onModuleDestroy(): void {
    this.removeListeners.splice(0).forEach((remove) => remove());
  }
}
