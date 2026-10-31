import { fieldChange, fieldValueText, specLineDiff } from './spec-diff';

describe('spec diff (Draft vs live)', () => {
  it('classifies field changes', () => {
    expect(fieldChange('a', 'a')).toBeNull();
    expect(fieldChange(undefined, '')).toBeNull();
    expect(fieldChange(undefined, 3)).toBe('added');
    expect(fieldChange(true, undefined)).toBe('removed');
    expect(fieldChange(2, 3)).toBe('changed');
    expect(fieldChange({ a: 1 }, { a: 1 })).toBeNull();
    expect(fieldValueText(false)).toBe('false');
    expect(fieldValueText(undefined)).toBe('');
  });

  it('diffs lines: changed hunks on both sides, pure additions / removals on one side', () => {
    const live = ['kind: X', 'spec:', '  a: 1', '  b: 2', '  c: 3'].join('\n');
    const draft = ['kind: X', 'spec:', '  a: 9', '  b: 2', '  c: 3', '  d: 4', '  e: 5'].join('\n');

    expect(specLineDiff(live, draft)).toEqual({
      live: [{ line: 3, kind: 'changed' }],
      draft: [
        { line: 3, kind: 'changed' },
        { line: 6, endLine: 7, kind: 'added' },
      ],
    });
    expect(specLineDiff(draft, live).live).toEqual([
      { line: 3, kind: 'changed' },
      { line: 6, endLine: 7, kind: 'removed' },
    ]);
    expect(specLineDiff(live, live)).toEqual({ live: [], draft: [] });
  });
});
