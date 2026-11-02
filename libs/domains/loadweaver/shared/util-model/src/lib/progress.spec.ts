import { worseHealth } from './health';
import { computeProgress } from './progress';

describe('progress and health helpers', () => {
  const steps = [
    { step: 'a', weight: 10 },
    { step: 'b', weight: 30 },
    { step: 'c', weight: 60 },
  ];

  it('computes weighted progress capped at 99', () => {
    expect(computeProgress(steps, 0, 0)).toBe(0);
    expect(computeProgress(steps, 1, 0.5)).toBe(25);
    expect(computeProgress(steps, 2, 1)).toBe(99);
    expect(computeProgress(steps, 1, 7)).toBe(40);
    expect(computeProgress([], 0, 1)).toBe(0);
  });

  it('picks the worse health state', () => {
    expect(worseHealth('healthy', 'degraded')).toBe('degraded');
    expect(worseHealth('failed', 'at-risk')).toBe('failed');
    expect(worseHealth('unknown', 'healthy')).toBe('unknown');
  });
});
