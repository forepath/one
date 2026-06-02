import { drainLineBuffer } from './line-buffer.util';

describe('drainLineBuffer', () => {
  it('yields complete lines and returns remainder', () => {
    const iter = drainLineBuffer('line1\nline2', '\nline3');
    const lines: string[] = [];
    let step = iter.next();

    while (!step.done) {
      lines.push(step.value);
      step = iter.next();
    }

    expect(lines).toEqual(['line1', 'line2']);
  });
});
