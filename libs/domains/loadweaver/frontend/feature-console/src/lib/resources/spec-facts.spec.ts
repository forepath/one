import { specFacts, specValueText } from './spec-facts';

const entries = (n: number) => `${n} entries`;

describe('spec facts (LW-12b: Summary = readable settings, not YAML)', () => {
  it('turns top-level spec settings into labelled one-line facts', () => {
    const facts = specFacts('WorkloadGroup', { selector: {}, intraGroup: 'allow', exposed: false }, entries);

    expect(facts.map((f) => [f.label, f.value])).toEqual([
      ['Selector', 'Not set'],
      ['Traffic inside the group', expect.any(String)],
      ['Exposed', 'No'],
    ]);
    expect(facts[1].value).not.toBe('');
  });

  it('keeps flat lists / maps inline and counts nested ones', () => {
    expect(specValueText(['a', 'b'], entries)).toBe('a, b');
    expect(specValueText({ tier: 'db' }, entries)).toBe('tier=db');
    expect(specValueText([{ port: 80 }, { port: 443 }], entries)).toBe('2 entries');
    expect(specValueText(true, entries)).toBe('Yes');
    expect(specValueText('x'.repeat(200), entries)).toHaveLength(120);
    expect(specFacts('Policy', null, entries)).toEqual([]);
  });
});
