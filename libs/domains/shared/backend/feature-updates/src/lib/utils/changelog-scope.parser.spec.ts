import { filterChangelogForProduct, parseChangelogMarkdown, scopeChangelogEntries } from './changelog-scope.parser';

describe('changelog-scope.parser', () => {
  const releaseBody = `
## [2.22.0]

### Features

* decabill instant cancellations ([#536](https://github.com/forepath/one/issues/536))
* decabill ssh key reveal with marker ([#534](https://github.com/forepath/one/issues/534))

### Bug Fixes

* generator input and entrypoint mapping ([#537](https://github.com/forepath/one/issues/537))
* login sections styling ([#538](https://github.com/forepath/one/issues/538))

### Code Refactoring

* change product keys ([#535](https://github.com/forepath/one/issues/535))
`;

  it('parses CHANGELOG-style bullet lines with categories', () => {
    const entries = parseChangelogMarkdown(releaseBody);

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('decabill instant cancellations'),
          scope: 'product',
          product: 'decabill',
          category: 'features',
        }),
        expect.objectContaining({
          text: expect.stringContaining('decabill ssh key reveal'),
          scope: 'product',
          product: 'decabill',
          category: 'features',
        }),
        expect.objectContaining({
          text: expect.stringContaining('generator input and entrypoint mapping'),
          scope: 'shared',
          category: 'bug fixes',
        }),
      ]),
    );
    expect(entries).toHaveLength(5);
  });

  it('classifies conventional commit scopes as product entries', () => {
    const entries = parseChangelogMarkdown('* feat(agenstra): agent heartbeat telemetry');

    expect(entries).toEqual([
      {
        text: 'feat(agenstra): agent heartbeat telemetry',
        scope: 'product',
        product: 'agenstra',
      },
    ]);
  });

  it('filters changelog entries for the requested product scope', () => {
    const entries = parseChangelogMarkdown(releaseBody);
    const scoped = filterChangelogForProduct(entries, 'decabill');

    expect(scoped.product).toHaveLength(2);
    expect(scoped.shared).toHaveLength(3);
    expect(scoped.product.every((entry) => entry.product === 'decabill')).toBe(true);
  });

  it('scopeChangelogEntries delegates to filterChangelogForProduct', () => {
    const entries = parseChangelogMarkdown('* decabill billing export\n* shared docs refresh');
    const scoped = scopeChangelogEntries(entries, 'decabill');

    expect(scoped.product).toHaveLength(1);
    expect(scoped.shared).toHaveLength(1);
  });

  it('scopes Loadweaver entries like the other products', () => {
    const entries = parseChangelogMarkdown(
      '* feat(loadweaver): update rollout\n* loadweaver console updates\n* feat(agenstra): x',
    );

    expect(entries.map((e) => e.product)).toEqual(['loadweaver', 'loadweaver', 'agenstra']);
    expect(scopeChangelogEntries(entries, 'loadweaver').product).toHaveLength(2);
    expect(filterChangelogForProduct(entries, 'agenstra').product).toHaveLength(1);
  });
});
