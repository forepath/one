import { egressUrlPatternIssues, translateEgressUrlPattern } from './egress-url-patterns';
import { policySpecSchema } from './resources/policy';

const re2 = (pattern: string) => {
  const result = translateEgressUrlPattern(pattern);

  if (!('re2' in result)) throw new Error(`untranslatable: ${(result as { error: string }).error}`);

  return result.re2;
};
const body = (pattern: string) => re2(pattern).slice('(?i)(?s:.*)(?:'.length, -')(?s:.*)'.length);

describe('egress URL patterns → RE2', () => {
  it.each([
    ['example\\.com/private', 'example\\.com\\/private'],
    ['^http://evil\\.', '^http\\:\\/\\/evil\\.'],
    ['a.b', 'a[^\\n\\r\\x{2028}\\x{2029}]b'],
    ['/download/.*\\.exe$', '\\/download\\/[^\\n\\r\\x{2028}\\x{2029}]*\\.exe$'],
    ['(foo|bar)+x{2,3}', '(foo|bar)+x{2,3}'],
    ['(?:ab)?c', '(?:ab)?c'],
    ['[a-z0-9_-]+', '[a-z0-9\\_\\-]+'],
    ['[^/]*', '[^\\/]*'],
    ['[[:digit:]]+', '[[:digit:]]+'],
    ['\\d+\\w', '\\d+\\w'],
    ['\\x41\\u00e9', '\\x{41}\\x{e9}'],
    ['\\a\\z', 'az'],
    ['a{', 'a\\{'],
    ['x{,3}', 'x\\{\\,3\\}'],
    ['a*?b', 'a*?b'],
    ['[^]', '(?s:.)'],
  ])('%s', (pattern, expected) => {
    expect(body(pattern)).toBe(expected);
  });

  it('wraps the pattern for a full match, case-insensitive', () => {
    expect(re2('evil')).toBe('(?i)(?s:.*)(?:evil)(?s:.*)');
  });

  it('spells out JavaScript whitespace', () => {
    expect(body('\\s')).toContain('\\x{a0}');
    expect(body('[\\s]')).toContain('\\x{3000}');
  });

  it.each([
    ['(a)\\1', 'backreferences'],
    ['(?=a)b', 'lookarounds'],
    ['(?<n>a)', 'lookarounds'],
    ['[]a', 'empty character class'],
    ['a{1001}', 'repetition above 1000'],
    ['([a-z]{100}){20}', 'too complex'],
    ['a b', 'whitespace'],
    ['(', 'not a valid regular expression'],
    ['', 'empty'],
    ['x'.repeat(513), 'exceeds'],
  ])('refuses %s', (pattern, reason) => {
    const result = translateEgressUrlPattern(pattern);

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain(reason);
  });

  it('lists the issues of a pattern list', () => {
    expect(egressUrlPatternIssues(['ok', '(a)\\1'])).toEqual(['denyUrlPatterns[1]: backreferences are not supported']);
  });
});

describe('Policy egress settings', () => {
  const from = [{ selector: { matchLabels: { 'loadweaver.com/deployment': 'env-1' } } }];

  it('accepts a settings-only policy (no destinations or rules)', () => {
    const spec = policySpecSchema.parse({
      from,
      egressMode: 'enforce',
      denyUrlPatterns: ['/admin'],
      blockIpLiterals: true,
    });

    expect(spec).toMatchObject({ to: [], rules: [], egressMode: 'enforce' });
  });

  it('still needs destinations and rules without settings', () => {
    expect(policySpecSchema.safeParse({ from }).success).toBe(false);
  });

  it('refuses untranslatable URL patterns as plan errors', () => {
    const parsed = policySpecSchema.safeParse({ from, egressMode: 'enforce', denyUrlPatterns: ['(a)\\1'] });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({ path: ['denyUrlPatterns', 0] });
  });

  it('applies settings only to own workloads and with action allow', () => {
    expect(
      policySpecSchema.safeParse({ from: [{ group: 'web', project: 'other' }], egressMode: 'offline' }).success,
    ).toBe(false);
    expect(policySpecSchema.safeParse({ from: [{ builtin: 'cluster' }], egressMode: 'offline' }).success).toBe(false);
    expect(policySpecSchema.safeParse({ from, action: 'deny', egressMode: 'offline' }).success).toBe(false);
  });

  it('allows deny by address on web ports only', () => {
    const deny = (rules: unknown) =>
      policySpecSchema.safeParse({ from, action: 'deny', to: [{ cidr: '203.0.113.0/24' }], rules }).success;

    expect(deny([{ protocol: 'tcp', ports: [80, 443] }])).toBe(true);
    expect(deny([{ protocol: 'tcp', ports: [22] }])).toBe(false);
    expect(deny([{ protocol: 'tcp' }])).toBe(false);
    expect(deny([{ protocol: 'udp', ports: [443] }])).toBe(false);
  });
});
