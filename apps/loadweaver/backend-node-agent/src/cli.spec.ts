import { parseLabels } from './cli';

describe('agent CLI', () => {
  it('parses labels', () => {
    expect(parseLabels(['site=fra1', 'loadweaver.com/role=ingress', 'empty='])).toEqual({
      site: 'fra1',
      'loadweaver.com/role': 'ingress',
      empty: '',
    });
  });

  it('rejects malformed labels', () => {
    expect(() => parseLabels(['novalue'])).toThrow('invalid label');
    expect(() => parseLabels(['bad key=x'])).toThrow('invalid label');
    expect(() => parseLabels(['k=v;rm'])).toThrow('invalid label');
  });
});
