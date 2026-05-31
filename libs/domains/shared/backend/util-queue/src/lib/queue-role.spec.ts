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

  it('parseQueueRole falls back to api for unknown values outside production', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(parseQueueRole('invalid', { NODE_ENV: 'development' })).toBe('api');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid QUEUE_ROLE'));

    warnSpy.mockRestore();
  });

  it('parseQueueRole throws for unknown values in production', () => {
    expect(() => parseQueueRole('invalid', { NODE_ENV: 'production' })).toThrow('Invalid QUEUE_ROLE');
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

  it('shouldEnableBullBoard is limited to api and all roles', () => {
    delete process.env.QUEUE_BULL_BOARD_ENABLED;

    expect(shouldEnableBullBoard('api')).toBe(false);
    expect(shouldEnableBullBoard('scheduler')).toBe(false);
    expect(shouldEnableBullBoard('worker')).toBe(false);
    expect(shouldEnableBullBoard('all')).toBe(true);
  });

  it('shouldEnableBullBoard respects env override on api/all only', () => {
    process.env.QUEUE_BULL_BOARD_ENABLED = 'false';
    expect(shouldEnableBullBoard('all')).toBe(false);
    expect(shouldEnableBullBoard('api')).toBe(false);

    process.env.QUEUE_BULL_BOARD_ENABLED = 'true';
    expect(shouldEnableBullBoard('api')).toBe(true);
    expect(shouldEnableBullBoard('scheduler')).toBe(false);
    expect(shouldEnableBullBoard('worker')).toBe(false);
  });
});
