import type { NextFunction, Request, Response } from 'express';

import { BasicToBearerMiddleware, type PatExchanger } from './basic-to-bearer.middleware';

const basic = (secret: string) => `Basic ${Buffer.from(`admin@example.com:${secret}`).toString('base64')}`;

async function run(authorization: string | undefined, exchanger?: PatExchanger | Error) {
  const moduleRef = {
    get: jest.fn(() => {
      if (exchanger instanceof Error) throw exchanger;

      return exchanger;
    }),
  };
  const middleware = new BasicToBearerMiddleware(moduleRef as never);
  const req = { headers: authorization ? { authorization } : {} } as Request;
  const next = jest.fn() as NextFunction;

  await middleware.use(req, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);

  return req.headers.authorization;
}

describe('BasicToBearerMiddleware (registry token realm)', () => {
  it('turns an API key password into a Bearer token', async () => {
    expect(await run(basic('static-api-key'))).toBe('Bearer static-api-key');
  });

  it('exchanges a personal access token for its machine JWT (G5: a raw PAT was refused)', async () => {
    const exchanger = { exchangePat: jest.fn(async () => ({ access_token: 'jwt-for-pat' })) };

    expect(await run(basic('fp_pat_abcdefgh123'), exchanger)).toBe('Bearer jwt-for-pat');
    expect(exchanger.exchangePat).toHaveBeenCalledWith('fp_pat_abcdefgh123');
  });

  it('keeps a PAT that does not exchange (the guards refuse it) and works without the auth stack', async () => {
    const refusing = { exchangePat: jest.fn(async () => Promise.reject(new Error('Invalid token'))) };

    expect(await run(basic('fp_pat_revoked'), refusing)).toBe('Bearer fp_pat_revoked');
    expect(await run(basic('fp_pat_nostack'), new Error('no AuthService'))).toBe('Bearer fp_pat_nostack');
  });

  it('drops an empty password and leaves other schemes alone', async () => {
    expect(await run(basic(''))).toBeUndefined();
    expect(await run('Bearer jwt')).toBe('Bearer jwt');
    expect(await run(undefined)).toBeUndefined();
  });
});
