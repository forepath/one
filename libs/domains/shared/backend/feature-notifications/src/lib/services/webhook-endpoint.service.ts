import { randomBytes } from 'crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertWebhookAuthCompatible,
  assertWebhookEndpointDeliveryPolicy,
  validateWebhookUrlWithDnsOrThrow,
} from '@forepath/shared/backend/util-webhook';

import { NOTIFICATIONS_MODULE_OPTIONS } from '../constants/notification.constants';
import type {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
  WebhookEndpointResponseDto,
} from '../dto/webhook-endpoint.dto';
import { WebhookAuthType, WebhookEndpointEntity } from '../entities/webhook-endpoint.entity';
import type { NotificationsModuleOptions } from '../interfaces/notifications-module.options';
import { WebhookEndpointsRepository } from '../repositories/webhook-endpoints.repository';
import { WebhookDeliveriesRepository } from '../repositories/webhook-deliveries.repository';
import { WebhookDeliveryRetentionService } from './webhook-delivery-retention.service';

@Injectable()
export class WebhookEndpointService {
  constructor(
    private readonly endpointsRepository: WebhookEndpointsRepository,
    private readonly deliveriesRepository: WebhookDeliveriesRepository,
    private readonly deliveryRetentionService: WebhookDeliveryRetentionService,
    @Inject(NOTIFICATIONS_MODULE_OPTIONS) private readonly options: NotificationsModuleOptions,
  ) {}

  listEventTypes(): Array<{ type: string; description: string }> {
    return this.options.eventCatalog.map((type) => ({ type, description: type }));
  }

  async list(limit: number, offset: number): Promise<WebhookEndpointResponseDto[]> {
    const scopeKey = this.options.resolveScopeKey();
    const rows = await this.endpointsRepository.findAllByScope(scopeKey, limit, offset);

    return rows.map((row) => this.toResponse(row));
  }

  async get(id: string): Promise<WebhookEndpointResponseDto> {
    const entity = await this.requireInScope(id);

    return this.toResponse(entity);
  }

  async create(dto: CreateWebhookEndpointDto): Promise<WebhookEndpointResponseDto> {
    this.validateSubscribedEvents(dto.subscribedEvents);
    await this.assertWebhookUrl(dto.url);
    assertWebhookAuthCompatible(dto.httpMethod, {
      authType: dto.authType,
      authValue: dto.authValue,
      authHeaderName: dto.authHeaderName,
    });
    assertWebhookEndpointDeliveryPolicy({
      httpMethod: dto.httpMethod,
      auth: {
        authType: dto.authType,
        authValue: dto.authValue,
        authHeaderName: dto.authHeaderName,
      },
      subscribedEvents: dto.subscribedEvents,
    });

    const scopeKey = this.options.resolveScopeKey();
    const signingSecret = randomBytes(32).toString('hex');
    const entity = await this.endpointsRepository.create({
      scopeKey,
      clientId: dto.clientId ?? null,
      name: dto.name.trim(),
      url: dto.url.trim(),
      httpMethod: dto.httpMethod,
      subscribedEvents: [...dto.subscribedEvents],
      enabled: dto.enabled ?? true,
      authType: dto.authType,
      authHeaderName: dto.authType === WebhookAuthType.CUSTOM_HEADER ? dto.authHeaderName?.trim() : null,
      authValue: dto.authType === WebhookAuthType.NONE ? null : dto.authValue?.trim(),
      signingSecret,
      consecutiveFailures: 0,
      disabledReason: null,
      deliveryLogRetentionDays: dto.deliveryLogRetentionDays ?? null,
      deliveryLogMaxEntries: dto.deliveryLogMaxEntries ?? null,
    });

    return this.toResponse(entity, signingSecret);
  }

  async update(id: string, dto: UpdateWebhookEndpointDto): Promise<WebhookEndpointResponseDto> {
    const entity = await this.requireInScope(id);

    if (dto.subscribedEvents) {
      this.validateSubscribedEvents(dto.subscribedEvents);
      entity.subscribedEvents = [...dto.subscribedEvents];
    }

    if (dto.name !== undefined) {
      entity.name = dto.name.trim();
    }

    if (dto.url !== undefined) {
      await this.assertWebhookUrl(dto.url);
      entity.url = dto.url.trim();
    }

    if (dto.httpMethod !== undefined) {
      entity.httpMethod = dto.httpMethod;
    }

    if (dto.enabled !== undefined) {
      entity.enabled = dto.enabled;

      if (dto.enabled) {
        entity.consecutiveFailures = 0;
        entity.disabledReason = null;
      }
    }

    if (dto.clientId !== undefined) {
      entity.clientId = dto.clientId;
    }

    if (dto.deliveryLogRetentionDays !== undefined) {
      entity.deliveryLogRetentionDays = dto.deliveryLogRetentionDays;
    }

    if (dto.deliveryLogMaxEntries !== undefined) {
      entity.deliveryLogMaxEntries = dto.deliveryLogMaxEntries;
    }

    if (dto.authType !== undefined) {
      entity.authType = dto.authType;
      entity.authHeaderName =
        dto.authType === WebhookAuthType.CUSTOM_HEADER ? (dto.authHeaderName?.trim() ?? null) : null;
      entity.authValue = dto.authType === WebhookAuthType.NONE ? null : (dto.authValue?.trim() ?? entity.authValue);
    } else if (dto.authHeaderName !== undefined) {
      entity.authHeaderName = dto.authHeaderName.trim();
    } else if (dto.authValue !== undefined) {
      entity.authValue = dto.authValue.trim();
    }

    assertWebhookAuthCompatible(entity.httpMethod, {
      authType: entity.authType,
      authValue: entity.authValue,
      authHeaderName: entity.authHeaderName,
    });
    assertWebhookEndpointDeliveryPolicy({
      httpMethod: entity.httpMethod,
      auth: {
        authType: entity.authType,
        authValue: entity.authValue,
        authHeaderName: entity.authHeaderName,
      },
      subscribedEvents: entity.subscribedEvents,
    });

    const saved = await this.endpointsRepository.save(entity);

    if (dto.deliveryLogRetentionDays !== undefined || dto.deliveryLogMaxEntries !== undefined) {
      this.deliveryRetentionService.applyRetentionForEndpointFireAndForget(saved);
    }

    return this.toResponse(saved);
  }

  async delete(id: string): Promise<void> {
    const entity = await this.requireInScope(id);

    await this.deliveriesRepository.deleteAllByEndpointId(entity.id);
    await this.endpointsRepository.delete(entity);
  }

  async requireEnabledInScope(id: string): Promise<WebhookEndpointEntity> {
    const entity = await this.requireInScope(id);

    if (!entity.enabled) {
      throw new BadRequestException('Webhook endpoint is disabled');
    }

    return entity;
  }

  private async requireInScope(id: string): Promise<WebhookEndpointEntity> {
    const scopeKey = this.options.resolveScopeKey();
    const entity = await this.endpointsRepository.findByIdAndScope(id, scopeKey);

    if (!entity) {
      throw new NotFoundException('Webhook endpoint not found');
    }

    return entity;
  }

  private validateSubscribedEvents(events: string[]): void {
    const allowed = new Set(this.options.eventCatalog);
    const invalid = events.filter((event) => !allowed.has(event));

    if (invalid.length > 0) {
      throw new BadRequestException(`Unsupported event types: ${invalid.join(', ')}`);
    }
  }

  private async assertWebhookUrl(url: string): Promise<void> {
    try {
      await validateWebhookUrlWithDnsOrThrow(url.trim());
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid webhook URL');
    }
  }

  private toResponse(entity: WebhookEndpointEntity, signingSecret?: string): WebhookEndpointResponseDto {
    return {
      id: entity.id,
      scopeKey: entity.scopeKey,
      clientId: entity.clientId ?? null,
      name: entity.name,
      url: entity.url,
      httpMethod: entity.httpMethod,
      subscribedEvents: entity.subscribedEvents,
      enabled: entity.enabled,
      authType: entity.authType,
      authHeaderName: entity.authHeaderName ?? null,
      hasAuthValue: !!entity.authValue,
      consecutiveFailures: entity.consecutiveFailures,
      disabledReason: entity.disabledReason ?? null,
      deliveryLogRetentionDays: entity.deliveryLogRetentionDays ?? null,
      deliveryLogMaxEntries: entity.deliveryLogMaxEntries ?? null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      signingSecret,
    };
  }
}
