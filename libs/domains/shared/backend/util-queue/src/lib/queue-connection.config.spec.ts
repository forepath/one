import {
  isBullBoardAuthConfigured,
  readBullBoardAuthConfig,
  readBullBoardPath,
  readQueueWorkerConcurrency,
  readRedisConnectionConfig,
  toBullMqConnection,
} from './queue-connection.config';

describe('queue-connection.config', () => {
  it('readRedisConnectionConfig uses defaults', () => {
    expect(readRedisConnectionConfig({})).toEqual({
      host: 'localhost',
      port: 6379,
      db: 0,
      keyPrefix: 'agenstra',
    });
  });

  it('readRedisConnectionConfig reads custom values', () => {
    expect(
      readRedisConnectionConfig({
        REDIS_HOST: 'redis',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'secret',
        REDIS_DB: '2',
        REDIS_KEY_PREFIX: 'billing',
      }),
    ).toEqual({
      host: 'redis',
      port: 6380,
      password: 'secret',
      db: 2,
      keyPrefix: 'billing',
    });
  });

  it('toBullMqConnection maps config', () => {
    expect(toBullMqConnection({ host: 'h', port: 1, db: 0, keyPrefix: 'p', password: 'x' })).toEqual({
      host: 'h',
      port: 1,
      db: 0,
      password: 'x',
    });
  });

  it('readQueueWorkerConcurrency', () => {
    expect(readQueueWorkerConcurrency({ QUEUE_WORKER_CONCURRENCY: '10' })).toBe(10);
    expect(readQueueWorkerConcurrency({ QUEUE_WORKER_CONCURRENCY: '0' })).toBe(5);
  });

  it('readBullBoardPath normalizes', () => {
    expect(readBullBoardPath({})).toBe('/admin/queues');
    expect(readBullBoardPath({ QUEUE_BULL_BOARD_PATH: 'queues' })).toBe('/queues');
  });

  it('readBullBoardAuthConfig reads credentials', () => {
    expect(readBullBoardAuthConfig({})).toEqual({ username: 'admin', password: '' });
    expect(
      readBullBoardAuthConfig({
        QUEUE_BULL_BOARD_USERNAME: 'ops',
        QUEUE_BULL_BOARD_PASSWORD: 'bullmq',
      }),
    ).toEqual({ username: 'ops', password: 'bullmq' });
    expect(isBullBoardAuthConfigured({ username: 'admin', password: 'bullmq' })).toBe(true);
    expect(isBullBoardAuthConfigured({ username: 'admin', password: '' })).toBe(false);
  });
});
