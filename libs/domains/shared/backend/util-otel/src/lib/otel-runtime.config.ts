export interface OtelAuthCredentials {
  username: string;
  password: string;
}

export interface OtelRuntimeConfig {
  enabled: boolean;
  disableReason?: string;
  username: string;
  password: string;
  /** Normalized path starting with `/`. */
  metricsPath: string;
  serviceName: string;
  otlpEndpoint?: string;
  /** OTLP HTTP endpoint for metrics (`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, e.g. `https://collector/v1/metrics`). */
  otlpMetricsEndpoint?: string;
}

export function readOtelMetricsPath(env: NodeJS.ProcessEnv = process.env): string {
  const path = env['OTEL_METRICS_PATH']?.trim() || '/otel/metrics';

  return path.startsWith('/') ? path : `/${path}`;
}

export function readOtelAuthConfig(env: NodeJS.ProcessEnv = process.env): OtelAuthCredentials {
  return {
    username: env['OTEL_USERNAME']?.trim() ?? '',
    password: env['OTEL_PASSWORD']?.trim() ?? '',
  };
}

export function resolveOtelRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  serviceNameFallback?: string,
): OtelRuntimeConfig {
  const auth = readOtelAuthConfig(env);
  const metricsPath = readOtelMetricsPath(env);
  const serviceName = env['OTEL_SERVICE_NAME']?.trim() || serviceNameFallback?.trim() || 'unknown-service';
  const otlpEndpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim() || undefined;
  const otlpMetricsEndpoint = env['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT']?.trim() || undefined;

  if (env['OTEL_ENABLED'] !== 'true') {
    return {
      enabled: false,
      disableReason: 'OTEL_ENABLED is not exactly "true"',
      username: auth.username,
      password: auth.password,
      metricsPath,
      serviceName,
      otlpEndpoint,
      otlpMetricsEndpoint,
    };
  }

  if (!auth.username || !auth.password) {
    return {
      enabled: false,
      disableReason: 'OTEL_USERNAME and OTEL_PASSWORD must both be non-empty after trim',
      username: auth.username,
      password: auth.password,
      metricsPath,
      serviceName,
      otlpEndpoint,
      otlpMetricsEndpoint,
    };
  }

  return {
    enabled: true,
    username: auth.username,
    password: auth.password,
    metricsPath,
    serviceName,
    otlpEndpoint,
    otlpMetricsEndpoint,
  };
}

export function isOtelEffectivelyEnabled(config?: OtelRuntimeConfig): boolean {
  return config?.enabled === true;
}
