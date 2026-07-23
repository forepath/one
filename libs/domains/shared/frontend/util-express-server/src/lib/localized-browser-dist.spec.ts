import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveLocalizedBrowserDistFolder, stripLocalePrefixFromPath } from './localized-browser-dist';
import { resolveLocaleFromRequest, resolveLocalizedStaticFilePath } from './create-delegating-server';

describe('resolveLocalizedBrowserDistFolder', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'localized-browser-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('prefers browser/<locale> when the server folder name is a locale', () => {
    const serverLocaleDir = join(root, 'server', 'en');
    const localizedBrowser = join(root, 'server', 'browser', 'en');

    mkdirSync(serverLocaleDir, { recursive: true });
    mkdirSync(localizedBrowser, { recursive: true });

    expect(resolveLocalizedBrowserDistFolder(serverLocaleDir)).toBe(localizedBrowser);
  });

  it('falls back to ../browser when no locale folder exists', () => {
    const serverDir = join(root, 'server');
    const browserDir = join(root, 'browser');

    mkdirSync(serverDir, { recursive: true });
    mkdirSync(browserDir, { recursive: true });

    expect(resolveLocalizedBrowserDistFolder(serverDir)).toBe(browserDir);
  });
});

describe('stripLocalePrefixFromPath', () => {
  it('strips a leading locale segment', () => {
    expect(stripLocalePrefixFromPath('/en', 'en')).toBe('/');
    expect(stripLocalePrefixFromPath('/en/pricing', 'en')).toBe('/pricing');
    expect(stripLocalePrefixFromPath('/pricing', 'en')).toBe('/pricing');
  });
});

describe('resolveLocalizedStaticFilePath', () => {
  let browserLocaleRoot: string;

  beforeEach(() => {
    browserLocaleRoot = mkdtempSync(join(tmpdir(), 'static-locale-'));
  });

  afterEach(() => {
    rmSync(browserLocaleRoot, { recursive: true, force: true });
  });

  it('resolves / to index.html', () => {
    writeFileSync(join(browserLocaleRoot, 'index.html'), '<html></html>');

    expect(resolveLocalizedStaticFilePath(browserLocaleRoot, '/')).toBe(join(browserLocaleRoot, 'index.html'));
  });

  it('resolves extensionless prerender folders', () => {
    const pricingDir = join(browserLocaleRoot, 'pricing');

    mkdirSync(pricingDir, { recursive: true });
    writeFileSync(join(pricingDir, 'index.html'), '<html>pricing</html>');

    expect(resolveLocalizedStaticFilePath(browserLocaleRoot, '/pricing')).toBe(join(pricingDir, 'index.html'));
  });

  it('resolves asset files with extensions', () => {
    writeFileSync(join(browserLocaleRoot, 'styles.css'), 'body{}');

    expect(resolveLocalizedStaticFilePath(browserLocaleRoot, '/styles.css')).toBe(
      join(browserLocaleRoot, 'styles.css'),
    );
  });

  it('returns null for /api paths', () => {
    expect(resolveLocalizedStaticFilePath(browserLocaleRoot, '/api/health')).toBeNull();
  });
});

describe('resolveLocaleFromRequest', () => {
  it('prefers locale from the path over Accept-Language', () => {
    const locale = resolveLocaleFromRequest(
      {
        url: '/de/pricing',
        headers: { host: 'localhost', 'accept-language': 'en-US,en;q=0.9' },
      } as never,
      ['en', 'de'],
      'en',
    );

    expect(locale).toBe('de');
  });

  it('uses Accept-Language when path has no locale', () => {
    const locale = resolveLocaleFromRequest(
      {
        url: '/pricing',
        headers: { host: 'localhost', 'accept-language': 'de-DE,de;q=0.9' },
      } as never,
      ['en', 'de'],
      'en',
    );

    expect(locale).toBe('de');
  });
});
