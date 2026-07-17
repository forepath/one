import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { DynamicModule, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { WebhookHttpClient, WebhookSignatureService } from '@forepath/shared/backend/util-webhook';

import { NOTIFICATIONS_MODULE_OPTIONS } from './constants/notification.constants';
import { createWebhookEndpointsController } from './controllers/webhook-endpoints.controller';
import { WebhookDeliveryEntity } from './entities/webhook-delivery.entity';
import { WebhookEndpointEntity } from './entities/webhook-endpoint.entity';
import type { NotificationsModuleOptions } from './interfaces/notifications-module.options';
import { WebhookDeliveriesRepository } from './repositories/webhook-deliveries.repository';
import { WebhookEndpointsRepository } from './repositories/webhook-endpoints.repository';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { WebhookDeliveryRetentionService } from './services/webhook-delivery-retention.service';
import { WebhookDeliveryService } from './services/webhook-delivery.service';
import { WebhookEndpointService } from './services/webhook-endpoint.service';

@Module({})
export class NotificationsModule {
  static register(options: NotificationsModuleOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: NOTIFICATIONS_MODULE_OPTIONS,
      useValue: options,
    };

    return {
      module: NotificationsModule,
      imports: [
        TypeOrmModule.forFeature([WebhookEndpointEntity, WebhookDeliveryEntity]),
        BullModule.registerQueue({ name: options.queueName }),
      ],
      controllers: [createWebhookEndpointsController(options.controllerPath)],
      providers: [
        optionsProvider,
        WebhookEndpointsRepository,
        WebhookDeliveriesRepository,
        WebhookDeliveryRetentionService,
        WebhookEndpointService,
        WebhookDeliveryService,
        WebhookHttpClient,
        WebhookSignatureService,
        {
          provide: NotificationDispatcherService,
          useFactory: (
            endpointsRepository: WebhookEndpointsRepository,
            moduleOptions: NotificationsModuleOptions,
            queue: Queue,
          ) => new NotificationDispatcherService(endpointsRepository, moduleOptions, queue),
          inject: [WebhookEndpointsRepository, NOTIFICATIONS_MODULE_OPTIONS, getQueueToken(options.queueName)],
        },
      ],
      exports: [
        NotificationDispatcherService,
        WebhookEndpointService,
        WebhookDeliveryService,
        WebhookDeliveryRetentionService,
      ],
    };
  }
}
