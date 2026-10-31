import {
  isOtelEffectivelyEnabled,
  readOtelAuthConfig,
  readOtelMetricsPath,
  resolveOtelRuntimeConfig,
} from './otel-runtime.config';

describe('resolveOtelRuntimeConfig', () => {
  it('disables when OTEL_ENABLED is not exactly true', () => {
    const config = resolveOtelRuntimeConfig(
      {
        OTEL_ENABLED: '1',
        OTEL_USERNAME: 'otel',
        OTEL_PASSWORD: 'secret',
      },
      'billing-manager',
    );

    expect(config.enabled).toBe(false);
    expect(config.disableReason).toContain('OTEL_ENABLED');
    expect(config.serviceName).toBe('billing-manager');
  });

  it('disables when credentials are incomplete', () => {
    const config = resolveOtelRuntimeConfig(
      {
        OTEL_ENABLED: 'true',
        OTEL_USERNAME: 'otel',
        OTEL_PASSWORD: '   ',
      },
      'billing-manager',
    );

    expect(config.enabled).toBe(false);
    expect(config.disableReason).toContain('OTEL_USERNAME and OTEL_PASSWORD');
  });

  it('enables with normalized metrics path and auth', () => {
    const config = resolveOtelRuntimeConfig(
      {
        OTEL_ENABLED: 'true',
        OTEL_USERNAME: 'otel',
        OTEL_PASSWORD: 'secret',
        OTEL_METRICS_PATH: 'otel/metrics',
        OTEL_SERVICE_NAME: 'decabill-billing-manager',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318',
      },
      'fallback',
    );

    expect(config).toEqual({
      enabled: true,
      username: 'otel',
      password: 'secret',
      metricsPath: '/otel/metrics',
      serviceName: 'decabill-billing-manager',
      otlpEndpoint: 'http://otel-collector:4318',
    });
    expect(isOtelEffectivelyEnabled(config)).toBe(true);
  });

  it('reads an optional OTLP metrics endpoint', () => {
    const config = resolveOtelRuntimeConfig({
      OTEL_ENABLED: 'true',
      OTEL_USERNAME: 'otel',
      OTEL_PASSWORD: 'secret',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: ' http://otel-collector:4318/v1/metrics ',
    });

    expect(config.otlpMetricsEndpoint).toBe('http://otel-collector:4318/v1/metrics');
    expect(resolveOtelRuntimeConfig({}).otlpMetricsEndpoint).toBeUndefined();
  });

  it('readOtelMetricsPath defaults to /otel/metrics', () => {
    expect(readOtelMetricsPath({})).toBe('/otel/metrics');
  });

  it('readOtelAuthConfig trims values', () => {
    expect(
      readOtelAuthConfig({
        OTEL_USERNAME: ' otel ',
        OTEL_PASSWORD: ' secret ',
      }),
    ).toEqual({
      username: 'otel',
      password: 'secret',
    });
  });
});
