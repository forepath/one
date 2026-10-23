import type { Slo, SloObjective } from '@forepath/loadweaver/frontend/data-access-console';

import {
  budgetTone,
  budgetUsedPercent,
  burnsFast,
  formatBurnRate,
  formatPercent,
  sloKey,
  sortSlos,
} from './slo-format';

function objective(overrides: Partial<SloObjective> = {}): SloObjective {
  return { target: 99.9, sli: 99.97, budget: 0.1, consumed: 0.3, burnRate1h: 0.2, state: 'ok', ...overrides };
}

function slo(service: string, state: Slo['state']): Slo {
  return {
    project: 'shop',
    deployment: 'web',
    service,
    hosts: [],
    window: '30d',
    monthlyUptime: null,
    state,
  };
}

describe('slo format', () => {
  it('turns the consumed budget into a bounded ring with a tone', () => {
    expect(budgetUsedPercent(objective())).toBe(30);
    expect(budgetUsedPercent(objective({ consumed: 2.5 }))).toBe(100);
    expect(budgetTone(objective())).toBe('success');
    expect(budgetTone(objective({ consumed: 0.8 }))).toBe('warning');
    expect(budgetTone(objective({ consumed: 1 }))).toBe('danger');
    expect(budgetTone(objective({ state: 'burning', consumed: 0.1 }))).toBe('danger');
    expect(budgetTone(objective({ state: 'no-data' }))).toBe('info');
  });

  it('formats percentages and burn rates', () => {
    expect(formatPercent(99.97123)).toBe('99.971 %');
    expect(formatPercent(99.9)).toBe('99.9 %');
    expect(formatPercent(null)).toBe('–');
    expect(formatBurnRate(0.234)).toBe('0.2×');
    expect(formatBurnRate(14.4)).toBe('14×');
    expect(formatBurnRate(null)).toBe('–');
    expect(burnsFast(objective({ burnRate1h: 14.4 }))).toBe(true);
    expect(burnsFast(objective({ burnRate1h: null }))).toBe(false);
  });

  it('sorts the most urgent first', () => {
    expect(
      sortSlos([slo('b', 'ok'), slo('a', 'no-data'), slo('c', 'exhausted'), slo('d', 'burning'), slo('a', 'ok')]).map(
        sloKey,
      ),
    ).toEqual(['shop/web/d', 'shop/web/c', 'shop/web/a', 'shop/web/b', 'shop/web/a']);
  });
});
