import { metrics } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import { isOtelEffectivelyEnabled, type OtelRuntimeConfig } from './otel-runtime.config';

let nodeSdk: NodeSDK | undefined;
let prometheusExporter: PrometheusExporter | undefined;
let sdkStarted = false;

function buildOtlpAuthHeaders(config: OtelRuntimeConfig): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
  };
}

function buildAutoInstrumentations(metricsPath: string) {
  return getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-http': {
      ignoreIncomingRequestHook: (request) => {
        const url = request.url ?? '';

        return url.includes('/health') || url.startsWith(metricsPath);
      },
    },
  });
}

function setOtelEnabledGauge(): void {
  const meter = metrics.getMeter('forepath.otel');

  meter
    .createObservableGauge('otel_enabled', {
      description: 'Whether OpenTelemetry is enabled (1 when started)',
    })
    .addCallback((observer) => {
      observer.observe(1);
    });
}

export function startOtelSdk(config: OtelRuntimeConfig): void {
  if (!isOtelEffectivelyEnabled(config) || sdkStarted) {
    return;
  }

  prometheusExporter = new PrometheusExporter({ preventServerStart: true });

  const sdkOptions: ConstructorParameters<typeof NodeSDK>[0] = {
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
    }),
    metricReaders: [
      prometheusExporter,
      // Optional push of the same metrics to an OTLP collector.
      ...(config.otlpMetricsEndpoint
        ? [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter({
                url: config.otlpMetricsEndpoint,
                headers: buildOtlpAuthHeaders(config),
              }),
              exportIntervalMillis: 60_000,
            }),
          ]
        : []),
    ],
    instrumentations: [buildAutoInstrumentations(config.metricsPath)],
  };

  if (config.otlpEndpoint) {
    const headers = buildOtlpAuthHeaders(config);

    sdkOptions.traceExporter = new OTLPTraceExporter({
      url: config.otlpEndpoint,
      headers,
    });
    sdkOptions.logRecordProcessors = [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: config.otlpEndpoint,
          headers,
        }),
      }),
    ];
  }

  nodeSdk = new NodeSDK(sdkOptions);
  nodeSdk.start();
  sdkStarted = true;
  setOtelEnabledGauge();
}

export async function shutdownOtelSdk(): Promise<void> {
  if (!nodeSdk) {
    return;
  }

  await nodeSdk.shutdown();
  nodeSdk = undefined;
  prometheusExporter = undefined;
  sdkStarted = false;
}

export function getPrometheusExporter(): PrometheusExporter | undefined {
  return prometheusExporter;
}

export function getMeter(name: string) {
  return metrics.getMeter(name);
}
