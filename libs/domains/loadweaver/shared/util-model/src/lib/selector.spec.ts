import { describeSelector, matchesSelector, selectMatching, selectorSchema } from './selector';

describe('selector', () => {
  const n1 = { name: 'n1', labels: { site: 'fra1', role: 'ingress' } };
  const n2 = { name: 'n2', labels: { site: 'ams1' } };
  const n3 = { name: 'n3' };

  it('matches everything when empty', () => {
    expect(selectMatching({}, [n1, n2, n3])).toEqual([n1, n2, n3]);
  });

  it('combines names, labels and expressions with AND', () => {
    expect(matchesSelector({ matchLabels: { site: 'fra1' } }, n1)).toBe(true);
    expect(matchesSelector({ matchLabels: { site: 'fra1' } }, n2)).toBe(false);
    expect(matchesSelector({ names: ['n1'], matchLabels: { site: 'ams1' } }, n1)).toBe(false);
    expect(selectMatching({ names: ['n2', 'n3'] }, [n1, n2, n3])).toEqual([n2, n3]);
  });

  it('evaluates all operators', () => {
    expect(
      selectMatching({ matchExpressions: [{ key: 'site', operator: 'In', values: ['fra1', 'ams1'] }] }, [n1, n2, n3]),
    ).toEqual([n1, n2]);
    expect(
      selectMatching({ matchExpressions: [{ key: 'site', operator: 'NotIn', values: ['fra1'] }] }, [n1, n2, n3]),
    ).toEqual([n2, n3]);
    expect(selectMatching({ matchExpressions: [{ key: 'role', operator: 'Exists' }] }, [n1, n2, n3])).toEqual([n1]);
    expect(selectMatching({ matchExpressions: [{ key: 'role', operator: 'DoesNotExist' }] }, [n1, n2, n3])).toEqual([
      n2,
      n3,
    ]);
  });

  it('validates operator values', () => {
    expect(selectorSchema.safeParse({ matchExpressions: [{ key: 'a', operator: 'In' }] }).success).toBe(false);
    expect(
      selectorSchema.safeParse({ matchExpressions: [{ key: 'a', operator: 'Exists', values: ['x'] }] }).success,
    ).toBe(false);
    expect(selectorSchema.safeParse({ matchLabels: { 'bad key!': 'x' } }).success).toBe(false);
  });

  it('describes selectors for plans', () => {
    expect(describeSelector({})).toBe('*');
    expect(
      describeSelector({
        names: ['a'],
        matchLabels: { site: 'fra1' },
        matchExpressions: [
          { key: 'r', operator: 'In', values: ['x', 'y'] },
          { key: 's', operator: 'NotIn', values: ['z'] },
          { key: 'e', operator: 'Exists' },
          { key: 'd', operator: 'DoesNotExist' },
        ],
      }),
    ).toBe('name in (a),site=fra1,r in (x,y),s notin (z),e,!d');
  });
});
