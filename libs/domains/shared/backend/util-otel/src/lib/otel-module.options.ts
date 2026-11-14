import type { Provider, Type } from '@nestjs/common';
import type { Meter } from '@opentelemetry/api';

export const OTEL_MODULE_OPTIONS = Symbol('OTEL_MODULE_OPTIONS');

export const OTEL_RUNTIME_CONFIG = 'OTEL_RUNTIME_CONFIG';

export interface OpenTelemetryModuleOptions {
  applicationId: string;
  serviceName?: string;
  /** BullMQ queue names for optional BullMqOtelMetricsCollector (register via extraProviders). */
  queueNames?: string[];
  /** Optional providers for queue apps (e.g. BullMqOtelMetricsCollector). Keep out of default graph for queue-less apps. */
  extraProviders?: Array<Provider | Type>;
  registerDomainMetrics?: (getMeter: (name: string) => Meter) => void | Promise<void>;
}
