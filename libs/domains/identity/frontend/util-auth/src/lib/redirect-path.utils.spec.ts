import { sanitizeAppRedirectPath } from './redirect-path.utils';

describe('sanitizeAppRedirectPath', () => {
  it.each(['/', '/clients', '/clients/1?tab=agents#top', '/authorize?app_id=1&state=x'])(
    'keeps app path %s',
    (path) => {
      expect(sanitizeAppRedirectPath(path)).toBe(path);
    },
  );

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/a\\b',
    'clients',
    'javascript:alert(1)',
    '/a\nb',
    '',
    undefined,
    null,
    42,
    `/${'a'.repeat(2048)}`,
  ])('rejects %p', (value) => {
    expect(sanitizeAppRedirectPath(value, '/fallback')).toBe('/fallback');
  });
});
