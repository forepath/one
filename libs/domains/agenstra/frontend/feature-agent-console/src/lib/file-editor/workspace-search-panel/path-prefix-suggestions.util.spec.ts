import { buildPathPrefixSuggestions } from './path-prefix-suggestions.util';

describe('buildPathPrefixSuggestions', () => {
  const hits = ['src/app/components/foo.ts', 'src/app/services/bar.ts', 'libs/shared/util/helpers.ts'];

  it('returns empty for blank query', () => {
    expect(buildPathPrefixSuggestions(hits, '  ', [])).toEqual([]);
  });

  it('suggests matching directory prefixes only', () => {
    expect(buildPathPrefixSuggestions(hits, 'comp', [])).toEqual(['src/app/components']);
  });

  it('excludes the exact draft and already selected paths', () => {
    expect(buildPathPrefixSuggestions(hits, 'src/app', ['src/app'])).toEqual([
      'src/app/services',
      'src/app/components',
    ]);
  });

  it('prefers prefix matches and shorter paths', () => {
    expect(buildPathPrefixSuggestions(hits, 'src', []).slice(0, 3)).toEqual([
      'src/app',
      'src/app/services',
      'src/app/components',
    ]);
  });

  it('does not suggest file paths', () => {
    expect(buildPathPrefixSuggestions(hits, 'foo', [])).toEqual([]);
    expect(buildPathPrefixSuggestions(hits, 'bar.ts', [])).toEqual([]);
  });
});
