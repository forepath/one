import { DynamicModule, Module } from '@nestjs/common';
import { OpenTelemetryModule as NestOtelModule } from 'nestjs-otel';

import { OtelDomainMetricsBootstrap, OtelSdkBootstrap } from './otel-domain-metrics.bootstrap';
import { OtelMetricsHttpRegistrar } from './otel-metrics-http.registrar';
import { OTEL_MODULE_OPTIONS, OTEL_RUNTIME_CONFIG, type OpenTelemetryModuleOptions } from './otel-module.options';
import { resolveOtelRuntimeConfig } from './otel-runtime.config';

@Module({})
export class OpenTelemetryModule {
  static register(options: OpenTelemetryModuleOptions): DynamicModule {
    const config = resolveOtelRuntimeConfig(process.env, options.serviceName ?? options.applicationId);

    if (!config.enabled) {
      return {
        module: OpenTelemetryModule,
        providers: [],
        exports: [],
      };
    }

    return {
      module: OpenTelemetryModule,
      imports: [
        NestOtelModule.forRoot({
          metrics: {
            hostMetrics: true,
          },
        }),
      ],
      providers: [
        { provide: OTEL_MODULE_OPTIONS, useValue: options },
        { provide: OTEL_RUNTIME_CONFIG, useValue: config },
        OtelSdkBootstrap,
        OtelMetricsHttpRegistrar,
        OtelDomainMetricsBootstrap,
        ...(options.extraProviders ?? []),
      ],
      exports: [],
    };
  }
}
