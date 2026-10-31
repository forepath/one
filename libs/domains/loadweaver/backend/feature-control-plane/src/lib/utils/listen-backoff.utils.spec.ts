import { ListenBackoff } from './listen-backoff.utils';

function logger() {
  return { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
}

describe('ListenBackoff', () => {
  it('doubles the delay up to the maximum', () => {
    const backoff = new ListenBackoff('LISTEN', logger(), 2_000, 30_000);

    expect([1, 2, 3, 4, 5, 6].map(() => backoff.failed())).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(backoff.attempts).toBe(6);
  });

  it('logs the loss once, retries at debug level and the recovery once', () => {
    const log = logger();
    const backoff = new ListenBackoff('Relay LISTEN', log);

    backoff.failed(new Error('Connection terminated unexpectedly'));
    backoff.failed(new Error('Connection terminated unexpectedly'));
    backoff.failed('timeout');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Relay LISTEN lost: Connection terminated unexpectedly; reconnecting with back-off',
    );
    expect(log.debug).toHaveBeenCalledTimes(2);

    backoff.succeeded();
    backoff.succeeded();
    expect(log.log).toHaveBeenCalledTimes(1);
    expect(log.log).toHaveBeenCalledWith('Relay LISTEN restored after 3 failed attempt(s)');
    expect(backoff.attempts).toBe(0);
  });

  it('starts over after a recovery', () => {
    const log = logger();
    const backoff = new ListenBackoff('LISTEN', log, 1_000, 10_000);

    backoff.failed();
    backoff.failed();
    backoff.succeeded();
    expect(backoff.failed()).toBe(1_000);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenLastCalledWith('LISTEN lost; reconnecting with back-off');
  });
});
