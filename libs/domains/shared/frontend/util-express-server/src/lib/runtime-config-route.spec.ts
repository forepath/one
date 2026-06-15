import {
  applyRuntimeConfigResponseCacheHeaders,
  fetchRuntimeConfigFromEnv,
} from '@forepath/shared/frontend/util-runtime-config-server';

import { registerRuntimeConfigEndpoint } from './runtime-config-route';

jest.mock('@forepath/shared/frontend/util-runtime-config-server', () => ({
  applyRuntimeConfigResponseCacheHeaders: jest.fn(),
  fetchRuntimeConfigFromEnv: jest.fn(),
}));

const mockedFetchRuntimeConfigFromEnv = fetchRuntimeConfigFromEnv as jest.Mock;
const mockedApplyRuntimeConfigResponseCacheHeaders = applyRuntimeConfigResponseCacheHeaders as jest.Mock;

describe('registerRuntimeConfigEndpoint', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('registers GET /config and returns {} when CONFIG is unset', async () => {
    mockedFetchRuntimeConfigFromEnv.mockResolvedValue({ kind: 'no_config' });

    let handler: ((req: unknown, res: any) => unknown) | undefined;
    const app = {
      get(path: string, fn: (req: unknown, res: any) => unknown) {
        expect(path).toBe('/config');
        handler = fn;
      },
    };
    const env = { NODE_ENV: 'production' };

    registerRuntimeConfigEndpoint(app, env);
    expect(handler).toBeDefined();

    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await handler!({}, res);

    expect(mockedApplyRuntimeConfigResponseCacheHeaders).toHaveBeenCalledWith(res, 'success', env);
    expect(res.json).toHaveBeenCalledWith({});
    expect(res.status).not.toHaveBeenCalled();
  });

  it('logs and returns {} with status when fetch returns error', async () => {
    mockedFetchRuntimeConfigFromEnv.mockResolvedValue({ kind: 'error', statusCode: 502, log: 'boom' });

    let handler: ((req: unknown, res: any) => unknown) | undefined;
    const app = {
      get(_path: string, fn: (req: unknown, res: any) => unknown) {
        handler = fn;
      },
    };
    const logger = { error: jest.fn() };
    const env = { NODE_ENV: 'development' };

    registerRuntimeConfigEndpoint(app, env, logger);

    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await handler!({}, res);

    expect(logger.error).toHaveBeenCalledWith('boom');
    expect(mockedApplyRuntimeConfigResponseCacheHeaders).toHaveBeenCalledWith(res, 'error', env);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({});
  });

  it('returns proxied JSON when fetch returns ok', async () => {
    mockedFetchRuntimeConfigFromEnv.mockResolvedValue({ kind: 'ok', value: { a: 1 } });

    let handler: ((req: unknown, res: any) => unknown) | undefined;
    const app = {
      get(_path: string, fn: (req: unknown, res: any) => unknown) {
        handler = fn;
      },
    };
    const env = { NODE_ENV: 'production' };

    registerRuntimeConfigEndpoint(app, env);

    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await handler!({}, res);

    expect(mockedApplyRuntimeConfigResponseCacheHeaders).toHaveBeenCalledWith(res, 'success', env);
    expect(res.json).toHaveBeenCalledWith({ a: 1 });
  });
});
