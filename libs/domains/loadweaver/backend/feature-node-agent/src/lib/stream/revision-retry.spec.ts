import { RETRY_INITIAL_MS, RETRY_MAX_MS, RevisionRetry } from './revision-retry';

describe('RevisionRetry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('doubles the delay up to the cap, with jitter of 75–100 % (live test 3.43)', () => {
    const full = new RevisionRetry(() => 0.999_999);
    const delays = Array.from({ length: 7 }, () => full.schedule(() => undefined));

    expect(delays).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(new RevisionRetry(() => 0).schedule(() => undefined)).toBe(RETRY_INITIAL_MS * 0.75);
    expect(Math.max(...delays)).toBeLessThanOrEqual(RETRY_MAX_MS);
  });

  it('keeps one attempt pending, counts started attempts and starts over on reset', () => {
    const retry = new RevisionRetry(() => 0.999_999);
    const first = jest.fn();
    const second = jest.fn();

    retry.schedule(first);
    retry.schedule(second);
    jest.advanceTimersByTime(60_000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(retry.attempts).toBe(1);
    expect(retry.pending).toBe(false);

    retry.schedule(first);
    retry.reset();
    jest.advanceTimersByTime(RETRY_MAX_MS);

    expect(first).not.toHaveBeenCalled();
    expect(retry.attempts).toBe(0);
    expect(retry.schedule(first)).toBe(RETRY_INITIAL_MS);
  });
});
