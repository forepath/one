import { ClientEntity } from '@forepath/identity/backend';
import {
  ActionCenterRegistry,
  ActionCenterService,
  INSTANCE_SCOPE_KEY,
  PlatformEmailDeliveryActionSource,
  PlatformUpdatesActionSource,
  PlatformWebhooksActionSource,
  toActionCenterSilenceWebhookPayload,
  UpdatesQueryService,
} from '@forepath/shared/backend';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';

import { AgenstraWorkspacesActionSource } from './agenstra-workspaces.action-source';

/**
 * High-frequency events that never change a to-do (chat traffic, egress decisions, knowledge edits, ...). Ignoring
 * them keeps busy instances from recomputing the action center on every message.
 */
const IRRELEVANT_EVENT_PREFIXES = [
  'chat_message.',
  'chat_session.',
  'egress.blocked',
  'egress.observed',
  'egress.policy_applied',
  'message_filter.',
  'knowledge_node.',
  'attachment.',
  'environment_variable.',
  'ticket.comment.',
  'search.',
  'action_center.',
];

export function isActionCenterRelevantEvent(type: string): boolean {
  return !IRRELEVANT_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * Wires Agenstra into the shared action center: registers the workspace source (plus the shared platform sources for
 * updates, webhooks and email delivery), turns every published Agenstra event into a change signal (changes made by
 * queue workers reach connected consoles as fast as HTTP changes) and publishes changes of silences for everyone as webhook events.
 */
@Injectable()
export class AgenstraActionCenterRegistrar implements OnModuleInit, OnModuleDestroy {
  private readonly removeListeners: Array<() => void> = [];

  constructor(
    private readonly registry: ActionCenterRegistry,
    private readonly actionCenter: ActionCenterService,
    private readonly publisher: AgenstraNotificationPublisher,
    // Raw SQL runner for the shared platform sources (any repository of the controller database).
    @InjectRepository(ClientEntity) private readonly sql: Repository<ClientEntity>,
    private readonly updatesQuery: UpdatesQueryService,
    private readonly workspaces: AgenstraWorkspacesActionSource,
  ) {}

  onModuleInit(): void {
    // The product module may be instantiated twice per process (app + queue module): wire only once.
    if (!this.actionCenter.claimWiring('agenstra.registrar')) {
      return;
    }

    this.registry.register(
      this.workspaces,
      new PlatformUpdatesActionSource(() => this.updatesQuery.getStatusSummary()),
      new PlatformWebhooksActionSource(this.sql),
      // SMTP is a system setting (admin-only page).
      new PlatformEmailDeliveryActionSource(this.sql, 'admin'),
    );
    this.removeListeners.push(
      this.publisher.addListener((type) => {
        if (!isActionCenterRelevantEvent(type)) {
          return;
        }

        this.actionCenter.signalChange(INSTANCE_SCOPE_KEY);
      }),
      // Silence changes become webhook events (`action_center.silence.*`).
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
