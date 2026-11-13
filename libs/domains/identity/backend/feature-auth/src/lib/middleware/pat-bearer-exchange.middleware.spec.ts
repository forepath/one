import { HttpException, HttpStatus, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { AuthService } from '../services/auth.service';

import {
  PatBearerExchangeMiddleware,
  RAW_PAT_EXCHANGE_CACHE_TTL_MS,
  RAW_PAT_EXCHANGE_MAX_FAILURES,
} from './pat-bearer-exchange.middleware';

const ROUTE = /^\/api\/clients\/[^/]+\/agents\/[^/]+\/openai\/v1(?:\/|$)/i;
const OPENAI_URL = '/api/clients/c1/agents/a1/openai/v1/chat/completions';
const VALID_PAT = 'fp_pat_abcdefghijklmnopqrstuvwxyz0123456789';

function request(overrides: Partial<Request> & { authorization?: string } = {}): Request {
  const { authorization, ...rest } = overrides;

  return {
    originalUrl: OPENAI_URL,
    url: OPENAI_URL,
    ip: '203.0.113.7',
    headers: authorization === undefined ? {} : { authorization },
    ...rest,
  } as unknown as Request;
}

async function run(middleware: PatBearerExchangeMiddleware, req: Request): Promise<unknown> {
  let nextArg: unknown = 'not-called';

  await middleware.use(req, {} as Response, (arg?: unknown) => {
    nextArg = arg;
  });

  return nextArg;
}

describe('PatBearerExchangeMiddleware', () => {
  let exchangePat: jest.Mock;
  let middleware: PatBearerExchangeMiddleware;

  beforeEach(() => {
    jest.useFakeTimers({ now: Date.parse('2026-11-13T10:00:00Z') });
    exchangePat = jest.fn(async (token: string) => {
      if (token !== VALID_PAT) {
        throw new UnauthorizedException('Invalid token');
      }

      return { access_token: `jwt-${exchangePat.mock.calls.length}`, user: {}, scopes: ['agent_chats:write'] };
    });
    middleware = new PatBearerExchangeMiddleware({ exchangePat } as unknown as AuthService, [ROUTE]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('exchanges a raw PAT on a configured path for the PAT JWT', async () => {
    const req = request({ authorization: `Bearer ${VALID_PAT}` });

    expect(await run(middleware, req)).toBeUndefined();
    expect(exchangePat).toHaveBeenCalledWith(VALID_PAT);
    expect(req.headers.authorization).toBe('Bearer jwt-1');
  });

  it('matches configured paths case-insensitively and ignores the query string', async () => {
    const url = '/API/Clients/c1/agents/a1/OpenAI/v1/models?limit=1';
    const req = request({ authorization: `Bearer ${VALID_PAT}`, originalUrl: url, url });

    await run(middleware, req);

    expect(req.headers.authorization).toBe('Bearer jwt-1');
  });

  it.each([
    ['another route', '/api/clients/c1/agents/a1/chats'],
    ['a look-alike prefix', '/api/clients/c1/agents/a1/openai/v10/models'],
    ['the path only in the query string', '/api/clients?x=/api/clients/c1/agents/a1/openai/v1/models'],
  ])('leaves raw PATs untouched on %s', async (_label, url) => {
    const req = request({ authorization: `Bearer ${VALID_PAT}`, originalUrl: url, url });

    await run(middleware, req);

    expect(exchangePat).not.toHaveBeenCalled();
    expect(req.headers.authorization).toBe(`Bearer ${VALID_PAT}`);
  });

  it('does nothing without configured paths', async () => {
    const disabled = new PatBearerExchangeMiddleware({ exchangePat } as unknown as AuthService, []);
    const req = request({ authorization: `Bearer ${VALID_PAT}` });

    await run(disabled, req);

    expect(exchangePat).not.toHaveBeenCalled();
    expect(req.headers.authorization).toBe(`Bearer ${VALID_PAT}`);
  });

  it.each([
    ['no header', undefined],
    ['a JWT bearer', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig'],
    ['the ApiKey scheme', `ApiKey ${VALID_PAT}`],
    ['a lowercase scheme', `bearer ${VALID_PAT}`],
    ['extra header parts', `Bearer ${VALID_PAT} extra`],
    ['a truncated PAT', 'Bearer fp_pat_short'],
  ])('ignores %s', async (_label, authorization) => {
    const req = request({ authorization });

    expect(await run(middleware, req)).toBeUndefined();
    expect(exchangePat).not.toHaveBeenCalled();
    expect(req.headers.authorization).toBe(authorization);
  });

  it('leaves an invalid PAT untouched so the guards reject it with 401', async () => {
    const invalid = 'fp_pat_zzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    const req = request({ authorization: `Bearer ${invalid}` });

    expect(await run(middleware, req)).toBeUndefined();
    expect(req.headers.authorization).toBe(`Bearer ${invalid}`);
  });

  it('reuses the exchange within the cache window and re-exchanges afterwards', async () => {
    const first = request({ authorization: `Bearer ${VALID_PAT}` });
    const second = request({ authorization: `Bearer ${VALID_PAT}` });

    await run(middleware, first);
    await run(middleware, second);

    expect(exchangePat).toHaveBeenCalledTimes(1);
    expect(second.headers.authorization).toBe('Bearer jwt-1');

    jest.advanceTimersByTime(RAW_PAT_EXCHANGE_CACHE_TTL_MS + 1);
    const third = request({ authorization: `Bearer ${VALID_PAT}` });

    await run(middleware, third);

    expect(exchangePat).toHaveBeenCalledTimes(2);
    expect(third.headers.authorization).toBe('Bearer jwt-2');
  });

  it('shares one exchange between concurrent requests', async () => {
    const requests = [1, 2, 3].map(() => request({ authorization: `Bearer ${VALID_PAT}` }));

    await Promise.all(requests.map((req) => run(middleware, req)));

    expect(exchangePat).toHaveBeenCalledTimes(1);
    requests.forEach((req) => expect(req.headers.authorization).toBe('Bearer jwt-1'));
  });

  it('does not cache failed exchanges', async () => {
    const invalid = 'fp_pat_zzzzzzzzzzzzzzzzzzzzzzzzzzzz';

    await run(middleware, request({ authorization: `Bearer ${invalid}` }));
    await run(middleware, request({ authorization: `Bearer ${invalid}` }));

    expect(exchangePat).toHaveBeenCalledTimes(2);
  });

  it('rejects further raw PAT attempts from an address after too many failures (no bcrypt work)', async () => {
    const invalid = 'fp_pat_zzzzzzzzzzzzzzzzzzzzzzzzzzzz';

    for (let i = 0; i < RAW_PAT_EXCHANGE_MAX_FAILURES; i++) {
      await run(middleware, request({ authorization: `Bearer ${invalid}` }));
    }

    exchangePat.mockClear();
    const blocked = await run(middleware, request({ authorization: `Bearer ${VALID_PAT}` }));

    expect(blocked).toBeInstanceOf(HttpException);
    expect((blocked as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(exchangePat).not.toHaveBeenCalled();

    // Other addresses are unaffected.
    const other = request({ authorization: `Bearer ${VALID_PAT}`, ip: '198.51.100.1' });

    expect(await run(middleware, other)).toBeUndefined();
    expect(other.headers.authorization).toBe('Bearer jwt-1');

    // The window expires.
    jest.advanceTimersByTime(60_001);
    exchangePat.mockClear();
    const later = request({ authorization: `Bearer ${VALID_PAT}` });

    expect(await run(middleware, later)).toBeUndefined();
    expect(exchangePat).toHaveBeenCalledTimes(1);
  });

  it('still serves cached exchanges to a blocked address', async () => {
    await run(middleware, request({ authorization: `Bearer ${VALID_PAT}` }));

    for (let i = 0; i < RAW_PAT_EXCHANGE_MAX_FAILURES; i++) {
      await run(middleware, request({ authorization: 'Bearer fp_pat_zzzzzzzzzzzzzzzzzzzzzzzzzzzz' }));
    }

    const req = request({ authorization: `Bearer ${VALID_PAT}` });

    expect(await run(middleware, req)).toBeUndefined();
    expect(req.headers.authorization).toBe('Bearer jwt-1');
  });

  it('passes unexpected exchange errors on without rewriting the header', async () => {
    exchangePat.mockRejectedValueOnce(new InternalServerErrorException('db down'));
    const req = request({ authorization: `Bearer ${VALID_PAT}` });

    expect(await run(middleware, req)).toBeInstanceOf(InternalServerErrorException);
    expect(req.headers.authorization).toBe(`Bearer ${VALID_PAT}`);
  });
});
