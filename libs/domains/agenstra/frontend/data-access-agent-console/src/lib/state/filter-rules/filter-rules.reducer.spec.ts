import {
  clearFilterRulesError,
  createFilterRule,
  createFilterRuleSuccess,
  deleteFilterRule,
  deleteFilterRuleFailure,
  deleteFilterRuleSuccess,
  loadFilterRules,
  loadFilterRulesBatch,
  loadFilterRulesFailure,
  loadFilterRulesSuccess,
  updateFilterRuleFailure,
  updateFilterRuleSuccess,
} from './filter-rules.actions';
import { filterRulesReducer, initialFilterRulesState } from './filter-rules.reducer';
import type { CreateFilterRuleDto, FilterRuleResponseDto } from './filter-rules.types';

describe('filterRulesReducer', () => {
  const baseRule = (over: Partial<FilterRuleResponseDto> = {}): FilterRuleResponseDto => ({
    id: '11111111-1111-1111-1111-111111111111',
    pattern: 'foo',
    regexFlags: 'g',
    direction: 'incoming',
    filterType: 'none',
    priority: 0,
    enabled: true,
    isGlobal: true,
    workspaceIds: [],
    sync: { pending: 0, synced: 0, failed: 0 },
    workspaceSync: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  });

  it('returns initial state for unknown action', () => {
    expect(filterRulesReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(initialFilterRulesState);
  });

  it('handles load lifecycle', () => {
    const seeded = { ...initialFilterRulesState, rules: [baseRule({ id: 'seed' })] };
    let s = filterRulesReducer(seeded, loadFilterRules());

    expect(s.loading).toBe(true);
    expect(s.rules).toEqual([]);
    expect(s.error).toBeNull();
    const rules = [baseRule({ id: 'a', priority: 1 }), baseRule({ id: 'b', priority: 0 })];

    s = filterRulesReducer(s, loadFilterRulesSuccess({ rules }));
    expect(s.loading).toBe(false);
    expect(s.rules).toEqual(rules);
    s = filterRulesReducer(s, loadFilterRulesFailure({ error: 'x' }));
    expect(s.loading).toBe(false);
    expect(s.error).toBe('x');
  });

  it('loadFilterRulesBatch stores accumulated rules while loading', () => {
    const acc = [baseRule({ id: '1' }), baseRule({ id: '2' })];
    const s = filterRulesReducer(initialFilterRulesState, loadFilterRulesBatch({ offset: 10, accumulatedRules: acc }));

    expect(s.rules).toEqual(acc);
    expect(s.loading).toBe(true);
  });

  it('inserts created rule sorted by priority then createdAt', () => {
    const existing = baseRule({ id: 'a', priority: 5, createdAt: '2024-01-02T00:00:00Z' });
    const dto: CreateFilterRuleDto = {
      pattern: 'p',
      direction: 'incoming',
      filterType: 'none',
      isGlobal: true,
    };
    let s = filterRulesReducer({ ...initialFilterRulesState, rules: [existing] }, createFilterRule({ dto }));

    expect(s.saving).toBe(true);
    const inserted = baseRule({ id: 'b', priority: 1, createdAt: '2024-01-03T00:00:00Z' });

    s = filterRulesReducer(s, createFilterRuleSuccess({ rule: inserted }));
    expect(s.saving).toBe(false);
    expect(s.rules.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('replaces rule on update success', () => {
    const r1 = baseRule({ id: 'a', pattern: 'old' });
    let s = filterRulesReducer(
      { ...initialFilterRulesState, rules: [r1] },
      updateFilterRuleSuccess({ rule: { ...r1, pattern: 'new' } }),
    );

    expect(s.rules[0].pattern).toBe('new');
    s = filterRulesReducer({ ...s, saving: true }, updateFilterRuleFailure({ error: 'e' }));
    expect(s.saving).toBe(false);
    expect(s.error).toBe('e');
  });

  it('removes rule on delete success', () => {
    const r1 = baseRule({ id: 'a' });
    let s = filterRulesReducer({ ...initialFilterRulesState, rules: [r1] }, deleteFilterRule({ id: 'a' }));

    expect(s.deleting).toBe(true);
    s = filterRulesReducer(s, deleteFilterRuleSuccess({ id: 'a' }));
    expect(s.deleting).toBe(false);
    expect(s.rules).toEqual([]);
    s = filterRulesReducer({ ...s, deleting: true }, deleteFilterRuleFailure({ error: 'd' }));
    expect(s.deleting).toBe(false);
    expect(s.error).toBe('d');
  });

  it('clears error', () => {
    const s = filterRulesReducer({ ...initialFilterRulesState, error: 'x' }, clearFilterRulesError());

    expect(s.error).toBeNull();
  });
});
