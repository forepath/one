import { Logger as NestLogger } from '@nestjs/common';

import { CorrelationAwareTypeOrmLogger } from './typeorm-logger';

describe('CorrelationAwareTypeOrmLogger', () => {
  let debugSpy: jest.SpiedFunction<NestLogger['debug']>;
  let logSpy: jest.SpiedFunction<NestLogger['log']>;
  let warnSpy: jest.SpiedFunction<NestLogger['warn']>;
  let errorSpy: jest.SpiedFunction<NestLogger['error']>;
  const prevEnv: Record<string, string | undefined> = {};

  function stashEnv(key: string): void {
    if (!(key in prevEnv)) {
      prevEnv[key] = process.env[key];
    }
  }

  beforeEach(() => {
    debugSpy = jest.spyOn(NestLogger.prototype, 'debug').mockImplementation(() => undefined);
    logSpy = jest.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(NestLogger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(NestLogger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    debugSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    for (const key of Object.keys(prevEnv)) {
      const value = prevEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
      delete prevEnv[key];
    }
  });

  it('sanitizes query parameters before logging', () => {
    const logger = new CorrelationAwareTypeOrmLogger();

    logger.logQuery('select 1', [{ password: 'secret', ok: 'yes' }] as unknown[]);

    // logQuery is disabled by default to keep dev output readable
    expect(debugSpy).toHaveBeenCalledTimes(0);
  });

  it('logs query errors with sanitized error payload', () => {
    const logger = new CorrelationAwareTypeOrmLogger();
    const err = new Error('boom');
    (err as unknown as { token?: string }).token = 'secret-token';

    logger.logQueryError(err, 'select 2', [{ authorization: 'Bearer abc.def.ghi' }] as unknown[]);

    // First call: structured error payload
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      msg: 'typeorm_query_error',
      query: 'select 2',
    });
    // Ensure token isn't leaked
    const firstPayload = errorSpy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(JSON.stringify(firstPayload)).not.toContain('secret-token');
  });

  it('routes warn/info/log appropriately', () => {
    const logger = new CorrelationAwareTypeOrmLogger();

    logger.log('warn', { access_token: 'x' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatchObject({
      msg: 'typeorm_log',
      level: 'warn',
      message: { access_token: '[REDACTED]' },
    });

    logger.log('info', { ok: true });
    expect(logSpy).toHaveBeenCalledTimes(1);

    logger.log('log', { step: 1 });
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls[1][0]).toMatchObject({
      msg: 'typeorm_log',
      level: 'log',
    });
  });

  it('logs queries when TYPEORM_LOG_QUERIES is true (truncate + optional parameters)', () => {
    stashEnv('TYPEORM_LOG_QUERIES');
    stashEnv('TYPEORM_LOG_PARAMETERS');
    stashEnv('TYPEORM_LOG_QUERY_MAXLEN');
    process.env['TYPEORM_LOG_QUERIES'] = 'true';
    process.env['TYPEORM_LOG_PARAMETERS'] = 'true';
    process.env['TYPEORM_LOG_QUERY_MAXLEN'] = '12';

    const logger = new CorrelationAwareTypeOrmLogger();
    logger.logQuery('', [{ password: 's' }] as unknown[]);
    logger.logQuery('select-very-long-query-text', undefined);

    expect(debugSpy).toHaveBeenCalledTimes(2);
    expect(debugSpy.mock.calls[0][0]).toMatchObject({
      msg: 'typeorm_query',
      query: '',
      parameters: [{ password: '[REDACTED]' }],
    });
    expect((debugSpy.mock.calls[1][0] as { query: string }).query).toBe('select-very-…');
  });

  it('logs slow queries and schema/migration messages', () => {
    const logger = new CorrelationAwareTypeOrmLogger();

    logger.logQuerySlow(99, 'slow-q', [{ api_key: 'k' }] as unknown[]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'typeorm_query_slow',
        time: 99,
        query: 'slow-q',
      }),
    );

    logger.logSchemaBuild('schema ok');
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ msg: 'typeorm_schema_build', message: 'schema ok' }));

    logger.logMigration('mig ok');
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ msg: 'typeorm_migration', message: 'mig ok' }));
  });

  it('logQueryError accepts string errors without stack second argument', () => {
    const logger = new CorrelationAwareTypeOrmLogger();

    logger.logQueryError('plain failure', 'select 3');

    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      msg: 'typeorm_query_error',
      query: 'select 3',
      error: 'plain failure',
    });
    expect(errorSpy.mock.calls[0][1]).toBeUndefined();
  });
});
