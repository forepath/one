import { generateKeyPairSync } from 'node:crypto';

import { DIGEST_A, DIGEST_B } from './__fixtures__/fixtures';
import {
  defaultAppStoreConfig,
  isTrustAllowed,
  OFFICIAL_CATALOG_NAME,
  parseAppStoreConfig,
  parseGitCatalogRef,
} from './app-store-config';
import {
  effectiveTrust,
  findTakedown,
  latestVersion,
  listedApps,
  parseIndex,
  type CatalogIndex,
} from './catalog-index';
import { findAffectedInstalls } from './takedowns';

const KEY_ID = 'c'.repeat(64);
const PEM = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();

function rawIndex(): Record<string, unknown> {
  return {
    apiVersion: 'apps.loadweaver.com/v1',
    kind: 'CatalogIndex',
    catalog: { name: 'community', title: 'Community', trust: 'community' },
    publishers: { [KEY_ID]: { name: 'acme', publicKey: PEM, label: 'verified' } },
    apps: [
      {
        name: 'wiki',
        title: 'Wiki',
        summary: 'A wiki',
        publisher: 'acme',
        trust: 'verified',
        versions: [
          { version: '1.0.0', channel: 'stable', digest: DIGEST_A, published: '2026-10-01T00:00:00Z' },
          { version: '1.2.0', channel: 'stable', digest: DIGEST_B, published: '2026-10-20T00:00:00Z' },
          { version: '1.10.0-beta.1', channel: 'beta', digest: DIGEST_B, published: '2026-10-21T00:00:00Z' },
          { version: '1.1.0', channel: 'stable', digest: DIGEST_A, published: '2026-10-10T00:00:00Z' },
        ],
      },
      {
        name: 'gone',
        title: 'Gone',
        summary: '',
        publisher: 'acme',
        trust: 'community',
        versions: [{ version: '0.1.0', channel: 'stable', digest: DIGEST_A, published: '2026-10-01T00:00:00Z' }],
      },
    ],
    takedowns: [
      { app: 'wiki', versions: ['1.2.0'], reason: 'CVE-2026-0001', at: '2026-10-30T00:00:00Z' },
      { app: 'gone', versions: 'all', reason: 'malware', at: '2026-10-30T00:00:00Z' },
    ],
    generatedAt: '2026-10-31T00:00:00Z',
  };
}

function index(): CatalogIndex {
  const result = parseIndex(rawIndex());

  if (!result.ok) throw new Error(result.errors.join('\n'));

  return result.value;
}

describe('parseIndex', () => {
  it('parses an index', () => {
    expect(index().apps).toHaveLength(2);
  });

  it('drops unknown keys (forward compatible)', () => {
    const result = parseIndex({ ...rawIndex(), futureField: 1 });

    expect(result.ok && 'futureField' in result.value).toBe(false);
  });

  it('checks publishers, trust caps and duplicates', () => {
    const raw = rawIndex();
    const apps = raw['apps'] as Record<string, unknown>[];

    apps[0]['trust'] = 'official';
    apps[1]['publisher'] = 'nobody';
    apps.push({ ...apps[0], trust: 'verified' });
    (apps[0]['versions'] as unknown[]).push((apps[0]['versions'] as unknown[])[0]);

    const result = parseIndex(raw);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual(
      expect.arrayContaining([
        "apps[0].trust: trust official exceeds the publisher's label verified",
        'apps[1].publisher: unknown publisher nobody',
        'apps[2].name: duplicate app wiki',
        'apps[0].versions[4].version: duplicate version 1.0.0',
      ]),
    );
  });

  it('refuses malformed key ids, digests and timestamps', () => {
    const raw = rawIndex();

    raw['publishers'] = { short: { name: 'acme', publicKey: PEM, label: 'verified' } };
    raw['apps'] = [];
    expect(!parseIndex(raw).ok && (parseIndex(raw) as { errors: string[] }).errors).toEqual([
      'publishers.short: publishers are keyed by key id (SHA-256 hex of the SPKI DER)',
    ]);

    const other = rawIndex();

    other['generatedAt'] = 'yesterday';
    ((other['apps'] as Record<string, unknown>[])[0]['versions'] as Record<string, unknown>[])[0]['digest'] = 'md5:x';

    const result = parseIndex(other);
    const text = !result.ok ? result.errors.join('\n') : '';

    expect(text).toMatch(/generatedAt/);
    expect(text).toMatch(/apps\[0\]\.versions\[0\]\.digest: must be sha256/);
  });

  it('parses YAML text', () => {
    expect(parseIndex('apiVersion: apps.loadweaver.com/v1\nkind: Other\n').ok).toBe(false);
  });
});

describe('takedowns and listing', () => {
  it('finds takedowns per version and for whole apps', () => {
    expect(findTakedown(index(), 'wiki', '1.2.0')?.reason).toBe('CVE-2026-0001');
    expect(findTakedown(index(), 'wiki', '1.1.0')).toBeUndefined();
    expect(findTakedown(index(), 'wiki')).toBeUndefined();
    expect(findTakedown(index(), 'gone')?.reason).toBe('malware');
    expect(findTakedown(index(), 'gone', '0.1.0')?.reason).toBe('malware');
  });

  it('lists apps without taken-down versions, newest first', () => {
    const apps = listedApps(index());

    expect(apps.map((a) => a.name)).toEqual(['wiki']);
    expect(apps[0].versions.map((v) => v.version)).toEqual(['1.10.0-beta.1', '1.1.0', '1.0.0']);
  });

  it('finds the latest version per channel', () => {
    expect(latestVersion(index(), 'wiki')?.version).toBe('1.1.0');
    expect(latestVersion(index(), 'wiki', 'beta')?.version).toBe('1.10.0-beta.1');
    expect(latestVersion(index(), 'gone')).toBeUndefined();
  });

  it('returns the affected installs of the catalog only', () => {
    const installs = [
      { catalog: 'community', name: 'wiki', version: '1.2.0', deployment: 'a' },
      { catalog: 'community', name: 'wiki', version: '1.1.0', deployment: 'b' },
      { catalog: 'community', name: 'gone', version: '0.0.9', deployment: 'c' },
      { catalog: 'private', name: 'wiki', version: '1.2.0', deployment: 'd' },
    ];

    const affected = findAffectedInstalls(index(), installs);

    expect(affected.map((a) => [a.install.deployment, a.takedown.reason])).toEqual([
      ['a', 'CVE-2026-0001'],
      ['c', 'malware'],
    ]);
    expect(findAffectedInstalls(index(), installs, 'private').map((a) => a.install.deployment)).toEqual(['d']);
  });
});

describe('trust', () => {
  it('caps official to verified outside the official catalog', () => {
    expect(effectiveTrust({ trust: 'official' }, { official: true })).toBe('official');
    expect(effectiveTrust({ trust: 'official' }, {})).toBe('verified');
    expect(effectiveTrust({ trust: 'community' }, { official: true })).toBe('community');
  });
});

describe('parseAppStoreConfig', () => {
  it('applies defaults and normalizes publicKey', () => {
    const result = parseAppStoreConfig({
      catalogs: [
        { name: 'acme', type: 'git', url: 'https://git.example.com/acme/apps.git', ref: 'main', publicKey: PEM },
      ],
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value.allowedTrust).toEqual(['official', 'verified']);
    expect(result.value.catalogs[0]).toEqual({
      name: 'acme',
      type: 'git',
      url: 'https://git.example.com/acme/apps.git',
      ref: 'main',
      publicKeys: [PEM],
      enabled: false,
    });
  });

  it('allows fleet catalogs without keys', () => {
    expect(
      parseAppStoreConfig({
        catalogs: [{ name: 'fleet', type: 'fleet', url: 'https://fleet.example.com', enabled: true }],
      }).ok,
    ).toBe(true);
  });

  it('reports invalid sources', () => {
    const result = parseAppStoreConfig({
      catalogs: [
        { name: 'a', type: 'oci', url: 'https://registry.example.com/x', publicKeys: [PEM], ref: 'main' },
        { name: 'a', type: 'git', url: 'https://example.com/r.git' },
        { name: 'b', type: 'oci', url: 'oci://registry.example.com/apps', official: true, publicKeys: [PEM] },
        { name: 'c', type: 'oci', url: 'oci://registry.example.com/apps', official: true },
      ],
      allowedTrust: ['everyone'],
    });

    expect(!result.ok && result.errors).toEqual(
      expect.arrayContaining([
        'catalogs[0].url: oci catalogs are oci://<registry>/<repository>',
        'catalogs[0].ref: ref is only used by git catalogs',
        'catalogs[1].publicKeys: a catalog needs its public key(s) or official: true',
        'catalogs[2].publicKeys: the official catalog uses the shipped key',
        expect.stringMatching(/^allowedTrust\[0\]/),
      ]),
    );
  });

  it('refuses duplicate names and two official catalogs', () => {
    const result = parseAppStoreConfig({
      catalogs: [
        { name: 'a', type: 'oci', url: 'oci://r.example.com/a', official: true },
        { name: 'a', type: 'oci', url: 'oci://r.example.com/b', official: true },
      ],
    });

    expect(!result.ok && result.errors).toEqual([
      'catalogs[1].name: duplicate catalog a',
      'catalogs: only one catalog can be the official one',
    ]);
  });

  it('builds the default config with the official catalog disabled', () => {
    const config = defaultAppStoreConfig({ type: 'oci', url: 'oci://registry.forepath.io/loadweaver/apps' });

    expect(config.catalogs).toEqual([
      {
        name: OFFICIAL_CATALOG_NAME,
        type: 'oci',
        url: 'oci://registry.forepath.io/loadweaver/apps',
        official: true,
        enabled: false,
      },
    ]);
    expect(parseAppStoreConfig(config).ok).toBe(true);
    expect(isTrustAllowed('verified', config)).toBe(true);
    expect(isTrustAllowed('community', config)).toBe(false);
  });
});

describe('Git catalog refs', () => {
  it.each([
    ['main', { kind: 'name', name: 'main' }],
    ['release/4.x', { kind: 'name', name: 'release/4.x' }],
    ['v1.2.0', { kind: 'name', name: 'v1.2.0' }],
    ['refs/heads/main', { kind: 'branch', name: 'main' }],
    ['refs/tags/v1.2.0', { kind: 'tag', name: 'v1.2.0' }],
    ['a'.repeat(40), { kind: 'commit', commit: 'a'.repeat(40) }],
    ['0123456789abcdef'.repeat(4), { kind: 'commit', commit: '0123456789abcdef'.repeat(4) }],
  ])('%s', (ref, expected) => {
    expect(parseGitCatalogRef(ref)).toEqual(expected);
  });

  it.each([
    '-main',
    'a..b',
    'refs/remotes/origin/main',
    'refs/heads/',
    'x.lock',
    'with space',
    'a@{1}',
    '/main',
    'main/',
  ])('refuses %s', (ref) => {
    expect(parseGitCatalogRef(ref)).toBeNull();
  });

  it('validates ref in the app store config (branch, tag, commit)', () => {
    const catalog = (ref: string) => ({
      catalogs: [{ name: 'acme', type: 'git', url: 'https://git.example.com/acme/apps.git', ref, publicKey: PEM }],
    });

    expect(parseAppStoreConfig(catalog('refs/tags/v1.0.0')).ok).toBe(true);
    expect(parseAppStoreConfig(catalog('b'.repeat(40))).ok).toBe(true);
    expect(parseAppStoreConfig(catalog('a..b'))).toEqual({
      ok: false,
      errors: [
        'catalogs[0].ref: ref is a branch, a tag (refs/heads/… / refs/tags/… to be explicit) or a full commit SHA',
      ],
    });
  });
});

describe('index minLoadweaver', () => {
  it('keeps a version’s minLoadweaver and refuses invalid ones', () => {
    const raw = rawIndex();
    const apps = raw['apps'] as { versions: Record<string, unknown>[] }[];

    apps[0].versions[0]['minLoadweaver'] = '4.2.0';

    const parsed = parseIndex(raw);

    expect(parsed.ok && parsed.value.apps[0].versions[0].minLoadweaver).toBe('4.2.0');

    apps[0].versions[0]['minLoadweaver'] = '4.2';
    expect(parseIndex(raw).ok).toBe(false);
  });
});
