import { countsFromRates, FAST_BURN, hostPattern, latencyCounts, objectiveStatus, worstObjective } from './slo.utils';

describe('SLO math', () => {
  it('computes SLI, budget use and burn rate', () => {
    const s = objectiveStatus(99.9, { good: 999_500, total: 1_000_000 }, { good: 9_990, total: 10_000 });

    expect(s.sli).toBeCloseTo(99.95);
    expect(s.consumed).toBeCloseTo(0.5);
    expect(s.burnRate1h).toBeCloseTo(1);
    expect(s.state).toBe('ok');
  });

  it('flags fast burn and exhaustion, and no data', () => {
    expect(objectiveStatus(99.9, { good: 999_900, total: 1_000_000 }, { good: 980, total: 1_000 }).state).toBe(
      'burning',
    );
    const exhausted = objectiveStatus(99, { good: 980, total: 1_000 }, { good: 0, total: 0 });

    expect(exhausted).toMatchObject({ state: 'exhausted', burnRate1h: null });
    expect(exhausted.consumed).toBeCloseTo(2);
    expect(objectiveStatus(99, { good: 0, total: 0 }, { good: 0, total: 0 }).state).toBe('no-data');
    expect(FAST_BURN).toBe(14.4);
  });

  it('turns ingress rates into counts and latency minutes into good / total', () => {
    // Sums of the 10 s samples' rates.
    expect(countsFromRates({ requests: 15, errors: 1 }, 10)).toEqual({ good: 140, total: 150 });
    expect(latencyCounts([{ latencyMs: 100 }, { latencyMs: 400 }, { latencyMs: 300 }], 300)).toEqual({
      good: 2,
      total: 3,
    });
  });

  it('picks the worst objective and matches host patterns', () => {
    expect(worstObjective(['ok', 'burning'])).toBe('burning');
    expect(worstObjective(['exhausted', 'burning'])).toBe('burning');
    expect(worstObjective(['no-data'])).toBe('no-data');
    expect(hostPattern('Shop.example.com')).toEqual({ like: false, value: 'shop.example.com' });
    expect(hostPattern('*.my_shop.com')).toEqual({ like: true, value: '%.my\\_shop.com' });
  });
});
