import { DynamicModule, Module, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ACTION_CENTER_MODULE_OPTIONS } from './constants/action-center.constants';
import { ActionCenterSilenceEntity } from './entities/action-center-silence.entity';
import { ActionCenterMutationInterceptor } from './interceptors/action-center-mutation.interceptor';
import type { ActionCenterModuleOptions } from './interfaces/action-center-module.options';
import { ActionCenterRealtimeService } from './services/action-center-realtime.service';
import { ActionCenterRegistry } from './services/action-center-registry.service';
import { ActionCenterRevisionStore } from './services/action-center-revision.store';
import { ActionCenterSilencesService } from './services/action-center-silences.service';
import { ActionCenterService } from './services/action-center.service';

/**
 * Shared action center engine. Products import the registered module once, register their sources with
 * {@link ActionCenterRegistry}, and declare their REST controller (calling `ActionCenterService.getView` / `silence` /
 * `unsilence`) and an `ActionCenterGatewayBase` subclass in their own module, where their auth services live.
 */
@Module({})
export class ActionCenterModule {
  static register(options: ActionCenterModuleOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: ACTION_CENTER_MODULE_OPTIONS, useValue: options },
      ActionCenterRegistry,
      ActionCenterSilencesService,
      ActionCenterRevisionStore,
      ActionCenterService,
      ActionCenterRealtimeService,
    ];

    if (options.trackHttpMutations !== false) {
      providers.push({ provide: APP_INTERCEPTOR, useClass: ActionCenterMutationInterceptor });
    }

    return {
      module: ActionCenterModule,
      imports: [TypeOrmModule.forFeature([ActionCenterSilenceEntity])],
      providers,
      exports: [
        ACTION_CENTER_MODULE_OPTIONS,
        ActionCenterRegistry,
        ActionCenterSilencesService,
        ActionCenterService,
        ActionCenterRealtimeService,
      ],
    };
  }
}
