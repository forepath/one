import {
  clampContributorJobIntervalMs,
  CONTRIBUTOR_JOB_MAX_INTERVAL_MS,
  CONTRIBUTOR_JOB_MIN_INTERVAL_MS,
  sanitizeContributorJobDefinition,
  type ContributorJobDefinition,
} from './contributor-job.types';

describe('contributor-job.types', () => {
  const run = jest.fn().mockResolvedValue(undefined);
  const valid = (overrides: Partial<ContributorJobDefinition> = {}): ContributorJobDefinition => ({
    key: 'collect-stats',
    intervalMs: 60_000,
    run,
    ...overrides,
  });

  it('clamps interval to 15s–24h and truncates fractions', () => {
    expect(clampContributorJobIntervalMs(1)).toBe(CONTRIBUTOR_JOB_MIN_INTERVAL_MS);
    expect(clampContributorJobIntervalMs(14_999)).toBe(CONTRIBUTOR_JOB_MIN_INTERVAL_MS);
    expect(clampContributorJobIntervalMs(15_000.9)).toBe(15_000);
    expect(clampContributorJobIntervalMs(86_400_001)).toBe(CONTRIBUTOR_JOB_MAX_INTERVAL_MS);
    expect(clampContributorJobIntervalMs(Number.NaN)).toBe(CONTRIBUTOR_JOB_MIN_INTERVAL_MS);
  });

  it('sanitizes a valid job definition', () => {
    const sanitized = sanitizeContributorJobDefinition(valid({ intervalMs: 1_000 }));

    expect(sanitized.key).toBe('collect-stats');
    expect(sanitized.intervalMs).toBe(CONTRIBUTOR_JOB_MIN_INTERVAL_MS);
    expect(sanitized.run).toBe(run);
  });

  it('rejects invalid keys', () => {
    expect(() => sanitizeContributorJobDefinition(valid({ key: 'CollectStats' }))).toThrow(
      'Invalid contributor job key',
    );
    expect(() => sanitizeContributorJobDefinition(valid({ key: '' }))).toThrow('Invalid contributor job key');
    expect(() => sanitizeContributorJobDefinition(valid({ key: '1-start' }))).toThrow('Invalid contributor job key');
  });

  it('rejects reserved keys', () => {
    expect(() => sanitizeContributorJobDefinition(valid({ key: 'coordinator' }))).toThrow(
      'Reserved contributor job key',
    );
    expect(() => sanitizeContributorJobDefinition(valid({ key: 'unit' }))).toThrow('Reserved contributor job key');
  });

  it('rejects a missing run handler', () => {
    expect(() =>
      sanitizeContributorJobDefinition({ key: 'collect-stats', intervalMs: 60_000, run: undefined as never }),
    ).toThrow('Contributor job run handler is required');
  });
});
