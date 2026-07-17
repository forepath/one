import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { NOTIFICATIONS_MODULE_OPTIONS } from '../constants/notification.constants';
import {
  CreateWebhookEndpointDto,
  PaginatedWebhookDeliveriesResponseDto,
  UpdateWebhookEndpointDto,
  WebhookDeliveryResponseDto,
  WebhookEndpointResponseDto,
  WebhookEventTypeResponseDto,
} from '../dto/webhook-endpoint.dto';
import type { NotificationsModuleOptions } from '../interfaces/notifications-module.options';
import { WebhookDeliveriesRepository } from '../repositories/webhook-deliveries.repository';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { WebhookDeliveryService } from '../services/webhook-delivery.service';
import { WebhookEndpointService } from '../services/webhook-endpoint.service';

export class WebhookEndpointsController {
  constructor(
    private readonly webhookEndpointService: WebhookEndpointService,
    private readonly webhookDeliveryService: WebhookDeliveryService,
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly webhookDeliveriesRepository: WebhookDeliveriesRepository,
    @Inject(NOTIFICATIONS_MODULE_OPTIONS) private readonly options: NotificationsModuleOptions,
  ) {}

  private assertAdmin(req: Request): void {
    this.options.assertAdmin(req);
  }

  @Get('event-types')
  listEventTypes(@Req() req: Request): WebhookEventTypeResponseDto[] {
    this.assertAdmin(req);

    return this.webhookEndpointService.listEventTypes();
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<WebhookEndpointResponseDto[]> {
    this.assertAdmin(req);

    return await this.webhookEndpointService.list(limit ?? 10, offset ?? 0);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: Request, @Body() dto: CreateWebhookEndpointDto): Promise<WebhookEndpointResponseDto> {
    this.assertAdmin(req);

    return await this.webhookEndpointService.create(dto);
  }

  @Get(':id')
  async get(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<WebhookEndpointResponseDto> {
    this.assertAdmin(req);

    return await this.webhookEndpointService.get(id);
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpointResponseDto> {
    this.assertAdmin(req);

    return await this.webhookEndpointService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Req() req: Request, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    this.assertAdmin(req);

    await this.webhookEndpointService.delete(id);
  }

  @Post(':id/test')
  async test(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<WebhookDeliveryResponseDto> {
    this.assertAdmin(req);

    const endpoint = await this.webhookEndpointService.requireEnabledInScope(id);
    const sampleType = endpoint.subscribedEvents[0] ?? 'test.event';
    const envelope = this.notificationDispatcherService.buildEnvelope({
      type: sampleType,
      scopeKey: endpoint.scopeKey,
      clientId: endpoint.clientId ?? undefined,
      data: { message: 'Test webhook delivery from Forepath' },
    });

    return await this.webhookDeliveryService.sendTest(endpoint.id, endpoint.scopeKey, envelope);
  }

  @Get(':id/deliveries')
  async listDeliveries(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedWebhookDeliveriesResponseDto> {
    this.assertAdmin(req);

    await this.webhookEndpointService.get(id);
    const result = await this.webhookDeliveriesRepository.findByEndpointId(id, limit ?? 10, offset ?? 0);

    return {
      items: result.items.map((item) => ({
        id: item.id,
        endpointId: item.endpointId,
        eventId: item.eventId,
        eventType: item.eventType,
        payload: item.payload,
        httpStatus: item.httpStatus,
        responseBody: item.responseBody,
        success: item.success,
        attempt: item.attempt,
        errorMessage: item.errorMessage ?? null,
        createdAt: item.createdAt,
      })),
      total: result.total,
    };
  }
}

export function createWebhookEndpointsController(controllerPath: string): typeof WebhookEndpointsController {
  @Controller(controllerPath)
  class ConfiguredWebhookEndpointsController extends WebhookEndpointsController {}

  Object.defineProperty(ConfiguredWebhookEndpointsController, 'name', {
    value: `WebhookEndpointsController_${controllerPath.replace(/\W+/g, '_')}`,
  });

  return ConfiguredWebhookEndpointsController;
}
