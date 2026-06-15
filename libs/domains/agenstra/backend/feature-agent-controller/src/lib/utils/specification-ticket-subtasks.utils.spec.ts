import { buildSpecificationSubtaskSeeds } from './specification-ticket-subtasks.utils';

describe('buildSpecificationSubtaskSeeds', () => {
  it('returns four subtasks with expected titles', () => {
    const seeds = buildSpecificationSubtaskSeeds('My feature', 'Some detail');

    expect(seeds).toHaveLength(4);
    expect(seeds.map((s) => s.title)).toEqual([
      'Proposal',
      'Specifications',
      'Technical design',
      'Implementation plan',
    ]);
  });

  it('embeds parent title in each body', () => {
    const seeds = buildSpecificationSubtaskSeeds('Epic A', null);

    for (const s of seeds) {
      expect(s.content).toContain('Epic A');
    }
  });

  it('includes OpenSpec-like structure markers', () => {
    const seeds = buildSpecificationSubtaskSeeds('T', 'c');

    expect(seeds[0].content).toMatch(/## Why/);
    expect(seeds[0].content).toMatch(/## Capabilities/);
    expect(seeds[1].content).toMatch(/### Requirement:/);
    expect(seeds[1].content).toMatch(/#### Scenario:/);
    expect(seeds[1].content).toMatch(/ADDED Requirements/);
    expect(seeds[2].content).toMatch(/## Decisions/);
    expect(seeds[3].content).toMatch(/- \[ \] 1\.1/);
    expect(seeds[3].content).toMatch(/## 1\./);
  });

  it('truncates long parent content in proposal', () => {
    const long = 'x'.repeat(2000);
    const seeds = buildSpecificationSubtaskSeeds('T', long);

    expect(seeds[0].content.length).toBeLessThan(long.length + 500);
    expect(seeds[0].content).toMatch(/…/);
  });

  it('uses placeholder when parent content empty', () => {
    const seeds = buildSpecificationSubtaskSeeds('T', '   ');

    expect(seeds[0].content).toMatch(/No description on the parent/);
  });
});
