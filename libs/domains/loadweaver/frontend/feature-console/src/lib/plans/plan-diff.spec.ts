import { diffLines, toYaml } from './plan-diff';

describe('plan diff', () => {
  it('writes resources as block YAML, quoting what would be read differently', () => {
    expect(
      toYaml({
        kind: 'Deployment',
        metadata: { name: 'web', labels: {} },
        spec: { replicas: 2, enabled: 'true', ports: ['80:80', { port: 443, tls: true }], note: '' },
      }),
    ).toBe(
      [
        'kind: Deployment',
        'metadata:',
        '  name: web',
        '  labels: {}',
        'spec:',
        '  replicas: 2',
        '  enabled: "true"',
        '  ports:',
        '    - 80:80',
        '    - port: 443',
        '      tls: true',
        '  note: ""',
      ].join('\n'),
    );
    expect(toYaml(null)).toBe('');
  });

  it('diffs lines, keeping the common ones', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'x' },
      { type: 'same', text: 'c' },
    ]);
    expect(diffLines('', 'new')).toEqual([{ type: 'added', text: 'new' }]);
    expect(diffLines('old', '')).toEqual([{ type: 'removed', text: 'old' }]);
  });
});
