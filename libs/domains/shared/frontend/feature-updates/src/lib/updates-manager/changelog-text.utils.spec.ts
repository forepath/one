import {
  changelogBreaking,
  changelogCategory,
  parseChangelogEntry,
  parseChangelogMarkdownLinks,
  splitSharedChangelog,
} from './changelog-text.utils';

describe('parseChangelogMarkdownLinks', () => {
  it('returns plain text when there are no links', () => {
    expect(parseChangelogMarkdownLinks('fix generator input')).toEqual([
      { kind: 'text', value: 'fix generator input' },
    ]);
  });

  it('parses issue and commit markdown links', () => {
    const text =
      'generator input and entrypoint mapping ([#537](https://github.com/forepath/one/issues/537)) ([1ae4d85](https://github.com/forepath/one/commit/1ae4d85cfdaaf3352eccd6ba075e7f0cdeaaef42))';

    expect(parseChangelogMarkdownLinks(text)).toEqual([
      { kind: 'text', value: 'generator input and entrypoint mapping (' },
      {
        kind: 'link',
        label: '#537',
        href: 'https://github.com/forepath/one/issues/537',
      },
      { kind: 'text', value: ') (' },
      {
        kind: 'link',
        label: '1ae4d85',
        href: 'https://github.com/forepath/one/commit/1ae4d85cfdaaf3352eccd6ba075e7f0cdeaaef42',
      },
      { kind: 'text', value: ')' },
    ]);
  });

  it('leaves non-http schemes as plain text', () => {
    expect(parseChangelogMarkdownLinks('[x](javascript:alert(1))')).toEqual([
      { kind: 'text', value: '[x](javascript:alert(1))' },
    ]);
  });

  it('handles empty input', () => {
    expect(parseChangelogMarkdownLinks('')).toEqual([]);
  });
});

describe('parseChangelogEntry', () => {
  it('turns a bold release-tool scope into a tag', () => {
    expect(
      parseChangelogEntry('**shared:** failing ci pipelines ([abc1234](https://github.com/x/y/commit/abc1234))'),
    ).toEqual({
      scope: 'shared',
      type: null,
      breaking: false,
      text: 'failing ci pipelines ([abc1234](https://github.com/x/y/commit/abc1234))',
    });
    expect(parseChangelogEntry('* **loadweaver**: secrets page').scope).toBe('loadweaver');
  });

  it('reads raw conventional-commit lines and files a generic entry under its type', () => {
    const view = parseChangelogEntry('fix(shared): failing ci pipelines');

    expect(view).toEqual({ scope: 'shared', type: 'fix', breaking: false, text: 'failing ci pipelines' });
    expect(changelogCategory('Changes', view)).toBe('fix');
    expect(changelogCategory('Features', view)).toBe('Features');
    // Breaking is a separate marker: the type stays the type (user, 2026-10-29).
    expect(changelogCategory(undefined, parseChangelogEntry('feat!: new api'))).toBe('feat');
    expect(changelogBreaking(undefined, parseChangelogEntry('feat!: new api'))).toBe(true);
    expect(changelogCategory('⚠ breaking changes', parseChangelogEntry('fix(shared): failing ci'))).toBe('fix');
    expect(changelogBreaking('⚠ breaking changes', parseChangelogEntry('fix(shared): failing ci'))).toBe(true);
    expect(changelogCategory('⚠ breaking changes', parseChangelogEntry('**shared:** config changed'))).toBeUndefined();
    expect(changelogBreaking('chores', parseChangelogEntry('**shared:** readme'))).toBe(false);
    expect(parseChangelogEntry('feat: plain').scope).toBeNull();
  });

  it('reads a leading product name as the scope (older notes)', () => {
    expect(parseChangelogEntry('decabill instant cancellations ([#536](https://x))')).toEqual({
      scope: 'decabill',
      type: null,
      breaking: false,
      text: 'instant cancellations ([#536](https://x))',
    });
  });

  it('leaves other text alone (only ** markers go)', () => {
    expect(parseChangelogEntry('Update **dependencies** to latest')).toEqual({
      scope: null,
      type: null,
      breaking: false,
      text: 'Update dependencies to latest',
    });
    expect(parseChangelogEntry('Note: something').type).toBeNull();
  });
});

describe('splitSharedChangelog', () => {
  it('keeps shared and unscoped entries, moves the current product, drops other products', () => {
    const shared = [
      { text: '**shared:** readme' },
      { text: 'unified page styling' },
      { text: '**deps:** bump' },
      { text: '**agenstra:** isolation' },
      { text: 'fix(forepath): landing' },
      { text: '**loadweaver:** secrets page' },
      { text: 'forepath landingpage hardware rental ([#447](https://x))' },
      { text: 'decabill instant cancellations' },
    ];
    const split = splitSharedChangelog(shared, 'loadweaver');

    expect(split.shared.map((e) => e.text)).toEqual(['**shared:** readme', 'unified page styling', '**deps:** bump']);
    expect(split.product.map((e) => e.text)).toEqual(['**loadweaver:** secrets page']);
  });
});
