import {
  type FetchRuntimeConfigEnv,
  applyRuntimeConfigResponseCacheHeaders,
  fetchRuntimeConfigFromEnv,
} from '@forepath/shared/frontend/util-runtime-config-server';

export type RuntimeConfigRouteEnv = FetchRuntimeConfigEnv;

export type RuntimeConfigRouteLogger = Pick<Console, 'error'>;

type ExpressLikeResponse = {
  setHeader(name: string, value: string | number | readonly string[]): void;
  json(value: unknown): unknown;
  status(code: number): ExpressLikeResponse;
};

type ExpressLikeApp = {
  get(path: string, handler: (req: unknown, res: ExpressLikeResponse) => unknown): void;
};

export function registerRuntimeConfigEndpoint(
  app: ExpressLikeApp,
  env: RuntimeConfigRouteEnv = process.env as unknown as RuntimeConfigRouteEnv,
  logger: RuntimeConfigRouteLogger = console,
): void {
  app.get('/config', async (_req, res) => {
    const result = await fetchRuntimeConfigFromEnv(env);

    if (result.kind === 'no_config') {
      applyRuntimeConfigResponseCacheHeaders(res, 'success', env);

      return res.json({});
    }

    if (result.kind === 'error') {
      logger.error(result.log);
      applyRuntimeConfigResponseCacheHeaders(res, 'error', env);

      return res.status(result.statusCode).json({});
    }

    applyRuntimeConfigResponseCacheHeaders(res, 'success', env);

    return res.json(result.value);
  });
}
