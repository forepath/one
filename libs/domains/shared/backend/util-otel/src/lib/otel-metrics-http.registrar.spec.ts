const getPrometheusExporter = jest.fn();

jest.mock('./otel-sdk', () => ({
  getPrometheusExporter,
}));

jest.mock('./otel-basic-auth.middleware', () => ({
  createOtelBasicAuthMiddleware: jest.fn(() => jest.fn()),
}));

import { createOtelBasicAuthMiddleware } from './otel-basic-auth.middleware';
import { OtelMetricsHttpRegistrar } from './otel-metrics-http.registrar';

describe('OtelMetricsHttpRegistrar', () => {
  const metricsHandler = jest.fn();
  const exporter = {
    getMetricsRequestHandler: metricsHandler,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getPrometheusExporter.mockReturnValue(exporter);
  });

  it('registers the metrics route on the HTTP adapter when available', () => {
    const get = jest.fn();
    const httpAdapterHost = {
      httpAdapter: {
        getInstance: jest.fn(() => ({ get })),
      },
    };
    const config = {
      metricsPath: '/otel/metrics',
      username: 'user',
      password: 'pass',
    };
    const registrar = new OtelMetricsHttpRegistrar(httpAdapterHost as never, config as never);

    registrar.onModuleInit();

    expect(createOtelBasicAuthMiddleware).toHaveBeenCalledWith({
      username: 'user',
      password: 'pass',
    });
    expect(get).toHaveBeenCalledWith('/otel/metrics', expect.any(Function), expect.any(Function));
  });

  it('skips registration when there is no HTTP adapter (worker/scheduler context)', () => {
    const registrar = new OtelMetricsHttpRegistrar(undefined, {
      metricsPath: '/otel/metrics',
      username: 'user',
      password: 'pass',
    } as never);

    expect(() => registrar.onModuleInit()).not.toThrow();
    expect(createOtelBasicAuthMiddleware).not.toHaveBeenCalled();
  });

  it('skips registration when HttpAdapterHost has a null adapter', () => {
    const registrar = new OtelMetricsHttpRegistrar(
      { httpAdapter: null } as never,
      {
        metricsPath: '/otel/metrics',
        username: 'user',
        password: 'pass',
      } as never,
    );

    expect(() => registrar.onModuleInit()).not.toThrow();
    expect(createOtelBasicAuthMiddleware).not.toHaveBeenCalled();
  });
});
