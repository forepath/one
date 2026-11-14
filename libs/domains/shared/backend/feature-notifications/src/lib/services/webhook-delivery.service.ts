import { httpStatusClass, recordSharedCounter, recordSharedHistogram } from '@forepath/shared/backend/util-otel';
import {
  WebhookHttpClient,
  WebhookSignatureService,
  type WebhookAuthConfig,
} from '@forepath/shared/backend/util-webhook';
import { Injectable, Logger } from '@nestjs/common';

import {
  WEBHOOK_CONSECUTIVE_FAILURE_DISABLE_THRESHOLD,
  WEBHOOK_DELIVER_MAX_ATTEMPTS,
} from '../constants/notification.constants';
import type { WebhookDeliveryResponseDto } from '../dto/webhook-endpoint.dto';
import type {
  NotificationEventEnvelope,
  WebhookDeliverJobPayload,
  WebhookDeliverOptions,
} from '../interfaces/notification.interfaces';
import { WebhookDeliveriesRepository } from '../repositories/webhook-deliveries.repository';
import { WebhookEndpointsRepository } from '../repositories/webhook-endpoints.repository';

import { WebhookDeliveryRetentionService } from './webhook-delivery-retention.service';

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    private readonly endpointsRepository: WebhookEndpointsRepository,
    private readonly deliveriesRepository: WebhookDeliveriesRepository,
    private readonly httpClient: WebhookHttpClient,
    private readonly signatureService: WebhookSignatureService,
    private readonly deliveryRetentionService: WebhookDeliveryRetentionService,
  ) {}

  async deliver(
    payload: WebhookDeliverJobPayload,
    options: WebhookDeliverOptions = {},
  ): Promise<WebhookDeliveryResponseDto> {
    const throwOnFailure = options.throwOnFailure ?? true;
    const trackConsecutiveFailures = options.trackConsecutiveFailures ?? true;
    const maxAttempts = payload.maxAttempts ?? WEBHOOK_DELIVER_MAX_ATTEMPTS;
    const isFinalAttempt = payload.attempt >= maxAttempts;
    const endpoint = await this.endpointsRepository.findByIdAndScope(payload.endpointId, payload.scopeKey);

    if (!endpoint) {
      this.logger.debug(`Skipping webhook delivery; endpoint ${payload.endpointId} no longer exists`);
      this.recordWebhookDeliveryMetrics({ outcome: 'skipped', httpStatus: null, durationMs: 0 });

      return this.buildSkippedDeliveryResponse(payload);
    }

    if (!endpoint.enabled) {
      this.logger.debug(`Skipping webhook delivery; endpoint ${payload.endpointId} is disabled`);
      this.recordWebhookDeliveryMetrics({ outcome: 'skipped', httpStatus: null, durationMs: 0 });

      return this.buildSkippedDeliveryResponse(payload, { success: false, errorMessage: 'Endpoint disabled' });
    }

    const body = payload.envelope as unknown as Record<string, unknown>;
    const serializedBody = JSON.stringify(body);
    const signature = this.signatureService.sign(serializedBody, endpoint.signingSecret);
    const auth: WebhookAuthConfig = {
      authType: endpoint.authType,
      authValue: endpoint.authValue,
      authHeaderName: endpoint.authHeaderName,
    };
    const startedAt = Date.now();
    const result = await this.httpClient.deliver({
      url: endpoint.url,
      method: endpoint.httpMethod,
      auth,
      body,
      headers: {
        'Forepath-Signature': signature,
        'Forepath-Event-Id': payload.eventId,
      },
    });
    const durationMs = Date.now() - startedAt;

    this.recordWebhookDeliveryMetrics({
      outcome: result.success ? 'success' : 'failed',
      httpStatus: result.httpStatus,
      durationMs,
    });

    const endpointAfterDeliver = await this.endpointsRepository.findByIdAndScope(payload.endpointId, payload.scopeKey);

    if (!endpointAfterDeliver) {
      this.logger.debug(`Skipping delivery log persist; endpoint ${payload.endpointId} was deleted during delivery`);

      return this.buildSkippedDeliveryResponse(payload, result);
    }

    const delivery = await this.deliveriesRepository.create({
      endpointId: endpointAfterDeliver.id,
      eventId: payload.eventId,
      eventType: payload.eventType,
      payload: body,
      httpStatus: result.httpStatus,
      responseBody: result.responseBody,
      success: result.success,
      attempt: payload.attempt,
      errorMessage: result.errorMessage ?? null,
    });

    this.deliveryRetentionService.applyRetentionForEndpointFireAndForget(endpointAfterDeliver);

    if (trackConsecutiveFailures) {
      let endpointChanged = false;

      if (result.success) {
        endpointAfterDeliver.consecutiveFailures = 0;
        endpointAfterDeliver.disabledReason = null;
        endpointChanged = true;
      } else if (isFinalAttempt) {
        endpointAfterDeliver.consecutiveFailures += 1;

        if (endpointAfterDeliver.consecutiveFailures >= WEBHOOK_CONSECUTIVE_FAILURE_DISABLE_THRESHOLD) {
          endpointAfterDeliver.enabled = false;
          endpointAfterDeliver.disabledReason = `Disabled after ${WEBHOOK_CONSECUTIVE_FAILURE_DISABLE_THRESHOLD} consecutive delivery failures`;
          this.logger.warn(`Disabled webhook endpoint ${endpointAfterDeliver.id} after repeated failures`);
          recordSharedCounter('notifications.delivery.auto_disabled_total', { channel: 'webhook' });
        }

        endpointChanged = true;
      }

      if (endpointChanged) {
        await this.endpointsRepository.save(endpointAfterDeliver);
      }
    }

    const response = this.toResponse(delivery);

    if (!result.success && throwOnFailure) {
      throw new Error(result.errorMessage ?? 'Webhook delivery failed');
    }

    return response;
  }

  async sendTest(
    endpointId: string,
    scopeKey: string,
    sampleEnvelope: NotificationEventEnvelope,
  ): Promise<WebhookDeliveryResponseDto> {
    return await this.deliver(
      {
        endpointId,
        eventId: sampleEnvelope.id,
        eventType: sampleEnvelope.type,
        scopeKey,
        envelope: sampleEnvelope,
        attempt: 1,
        maxAttempts: 1,
      },
      { throwOnFailure: false, trackConsecutiveFailures: false },
    );
  }

  private recordWebhookDeliveryMetrics(params: {
    outcome: 'success' | 'failed' | 'skipped';
    httpStatus: number | null;
    durationMs: number;
  }): void {
    const attrs = {
      channel: 'webhook',
      outcome: params.outcome,
      http_status_class: httpStatusClass(params.httpStatus),
    };

    recordSharedCounter('notifications.delivery.attempts_total', attrs);
    recordSharedHistogram('notifications.delivery.duration_ms', params.durationMs, attrs);
  }

  private buildSkippedDeliveryResponse(
    payload: WebhookDeliverJobPayload,
    result?: {
      httpStatus?: number | null;
      responseBody?: string | null;
      success?: boolean;
      errorMessage?: string | null;
    },
  ): WebhookDeliveryResponseDto {
    return {
      id: payload.eventId,
      endpointId: payload.endpointId,
      eventId: payload.eventId,
      eventType: payload.eventType,
      payload: payload.envelope as unknown as Record<string, unknown>,
      httpStatus: result?.httpStatus ?? null,
      responseBody: result?.responseBody ?? null,
      success: result?.success ?? false,
      attempt: payload.attempt,
      errorMessage: result?.errorMessage ?? 'Endpoint unavailable',
      createdAt: new Date(),
    };
  }

  private toResponse(entity: Awaited<ReturnType<WebhookDeliveriesRepository['create']>>): WebhookDeliveryResponseDto {
    return {
      id: entity.id,
      endpointId: entity.endpointId,
      eventId: entity.eventId,
      eventType: entity.eventType,
      payload: entity.payload,
      httpStatus: entity.httpStatus,
      responseBody: entity.responseBody,
      success: entity.success,
      attempt: entity.attempt,
      errorMessage: entity.errorMessage ?? null,
      createdAt: entity.createdAt,
    };
  }
}
