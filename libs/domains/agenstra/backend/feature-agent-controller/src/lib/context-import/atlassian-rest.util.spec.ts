import {
  buildBasicAuthHeader,
  confluenceContentSearchUrlsEquivalent,
  confluenceRestApiRoot,
  contentHashForImport,
  normalizeAtlassianBaseUrl,
  resolveConfluencePaginationUrl,
} from './atlassian-rest.util';

describe('atlassian-rest.util', () => {
  describe('normalizeAtlassianBaseUrl', () => {
    it('trims trailing slashes', () => {
      expect(normalizeAtlassianBaseUrl('https://example.atlassian.net///')).toBe('https://example.atlassian.net');
    });

    it('strips path on Atlassian Cloud hostnames so API paths are not doubled', () => {
      expect(normalizeAtlassianBaseUrl('https://example.atlassian.net/wiki')).toBe('https://example.atlassian.net');
      expect(normalizeAtlassianBaseUrl('https://example.atlassian.net/wiki/spaces/FOO')).toBe(
        'https://example.atlassian.net',
      );
    });

    it('rejects non-http protocols', () => {
      expect(() => normalizeAtlassianBaseUrl('ftp://x')).toThrow(/http/);
    });
  });

  describe('resolveConfluencePaginationUrl', () => {
    it('joins /rest/api next links to the Confluence webapp root on Cloud', () => {
      expect(
        resolveConfluencePaginationUrl(
          'https://example.atlassian.net',
          'https://example.atlassian.net/wiki',
          '/rest/api/content/search?cursor=x',
        ),
      ).toBe('https://example.atlassian.net/wiki/rest/api/content/search?cursor=x');
    });

    it('joins /wiki/rest next links to the site origin on Cloud', () => {
      expect(
        resolveConfluencePaginationUrl(
          'https://example.atlassian.net',
          'https://example.atlassian.net/wiki',
          '/wiki/rest/api/content/search?cursor=y',
        ),
      ).toBe('https://example.atlassian.net/wiki/rest/api/content/search?cursor=y');
    });
  });

  describe('confluenceContentSearchUrlsEquivalent', () => {
    it('treats same path and reordered query keys as equivalent', () => {
      const a = 'https://example.atlassian.net/wiki/rest/api/content/search?limit=10&cql=type%3Dpage';
      const b = 'https://example.atlassian.net/wiki/rest/api/content/search?cql=type%3Dpage&limit=10';

      expect(confluenceContentSearchUrlsEquivalent(a, b)).toBe(true);
    });
  });

  describe('confluenceRestApiRoot', () => {
    it('adds /wiki on Atlassian Cloud', () => {
      expect(confluenceRestApiRoot('https://example.atlassian.net')).toBe('https://example.atlassian.net/wiki');
    });

    it('preserves Confluence Server base URL', () => {
      expect(confluenceRestApiRoot('https://confluence.corp.example/internal')).toBe(
        'https://confluence.corp.example/internal',
      );
    });
  });

  describe('buildBasicAuthHeader', () => {
    it('returns a Basic header', () => {
      const h = buildBasicAuthHeader('a@b.com', 'tok');

      expect(h.startsWith('Basic ')).toBe(true);
      expect(h.length).toBeGreaterThan(10);
    });
  });

  describe('contentHashForImport', () => {
    it('is stable for the same inputs', () => {
      expect(contentHashForImport('t', 'b')).toBe(contentHashForImport('t', 'b'));
    });

    it('changes when body changes', () => {
      expect(contentHashForImport('t', 'a')).not.toBe(contentHashForImport('t', 'b'));
    });
  });
});
