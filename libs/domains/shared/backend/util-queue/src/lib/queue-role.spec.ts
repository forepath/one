import {
  getQueueRole,
  parseQueueRole,
  shouldEnableBullBoard,
  shouldRegisterRepeatableJobs,
  shouldRunApiHttp,
  shouldRunMigrations,
  shouldRunQueueWorkers,
} from './queue-role';

describe('queue-role', () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it('parseQueueRole defaults to all', () => {
    expect(parseQueueRole(undefined)).toBe('all');
  });

  it('parseQueueRole accepts api scheduler worker', () => {
    expect(parseQueueRole('api')).toBe('api');
    expect(parseQueueRole('scheduler')).toBe('scheduler');
    expect(parseQueueRole('worker')).toBe('worker');
  });

  it('parseQueueRole falls back to all for unknown', () => {
    expect(parseQueueRole('invalid')).toBe('all');
  });

  it('role capabilities', () => {
    expect(shouldRunApiHttp('api')).toBe(true);
    expect(shouldRunApiHttp('worker')).toBe(false);
    expect(shouldRegisterRepeatableJobs('scheduler')).toBe(true);
    expect(shouldRunQueueWorkers('worker')).toBe(true);
    expect(shouldRunMigrations('worker')).toBe(false);
    expect(shouldRunMigrations('api')).toBe(true);
  });

  it('getQueueRole reads QUEUE_ROLE', () => {
    process.env.QUEUE_ROLE = 'worker';
    expect(getQueueRole()).toBe('worker');
  });

  it('shouldEnableBullBoard respects env override', () => {
    process.env.QUEUE_BULL_BOARD_ENABLED = 'false';
    expect(shouldEnableBullBoard('all')).toBe(false);
    process.env.QUEUE_BULL_BOARD_ENABLED = 'true';
    expect(shouldEnableBullBoard('api')).toBe(true);
  });
});
