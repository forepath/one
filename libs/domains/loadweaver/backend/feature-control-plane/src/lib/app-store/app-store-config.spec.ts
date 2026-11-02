import { generateSigningKeyPair, type CatalogSource } from '@forepath/loadweaver/shared/util-app-catalog';

import {
  catalogKeys,
  catalogSourceHash,
  DEFAULT_OFFICIAL_CATALOG_URL,
  displayCatalogUrl,
  effectiveAppStoreConfig,
  fleetCatalogName,
  fleetManagedCatalogWarnings,
  officialCatalogFromEnv,
} from './app-store-config';

const key = generateSigningKeyPair('ecdsa-p256').publicKeyPem;
const other = generateSigningKeyPair('ed25519').publicKeyPem;
const official = { type: 'oci' as const, url: DEFAULT_OFFICIAL_CATALOG_URL };

describe('official catalog from the environment (P1)', () => {
  it('defaults to the ForePath OCI catalog without a key', () => {
    expect(officialCatalogFromEnv({})).toEqual({ type: 'oci', url: DEFAULT_OFFICIAL_CATALOG_URL, publicKeys: [] });
  });

  it('takes a Git URL with ref and PEM keys (escaped newlines too); drops non-keys', () => {
    const env = {
      LOADWEAVER_APP_CATALOG_OFFICIAL_URL: 'https://github.com/forepath/loadweaver-apps.git',
      LOADWEAVER_APP_CATALOG_OFFICIAL_REF: 'release',
      LOADWEAVER_APP_CATALOG_OFFICIAL_KEY: `${key.replace(/\n/g, '\\n')}\n-----BEGIN PUBLIC KEY-----\nbm9wZQ==\n-----END PUBLIC KEY-----`,
    };

    expect(officialCatalogFromEnv(env)).toEqual({
      type: 'git',
      url: 'https://github.com/forepath/loadweaver-apps.git',
      ref: 'release',
      publicKeys: [key],
    });
  });
});

describe('effective app store config (P1)', () => {
  it('is the official catalog, disabled, when Cluster.spec.appStore is absent or invalid', () => {
    const expected = {
      catalogs: [{ name: 'official', type: 'oci', url: DEFAULT_OFFICIAL_CATALOG_URL, official: true, enabled: false }],
      allowedTrust: ['official', 'verified'],
    };

    expect(effectiveAppStoreConfig(undefined, official)).toEqual(expected);
    expect(effectiveAppStoreConfig({ catalogs: 'nope' }, official)).toEqual(expected);
  });

  it('adds the official catalog (disabled) next to configured ones unless it is configured', () => {
    const acme = { name: 'acme', type: 'git', url: 'https://g.example.com/a.git', publicKeys: [key], enabled: true };
    const config = effectiveAppStoreConfig({ catalogs: [acme], allowedTrust: ['community'] }, official);

    expect(config.catalogs.map((c) => [c.name, c.enabled])).toEqual([
      ['official', false],
      ['acme', true],
    ]);
    expect(config.allowedTrust).toEqual(['community']);

    const own = effectiveAppStoreConfig(
      {
        catalogs: [{ name: 'official', type: 'oci', url: 'oci://registry.lw/lw/apps', official: true, enabled: true }],
      },
      official,
    );

    expect(own.catalogs).toEqual([
      { name: 'official', type: 'oci', url: 'oci://registry.lw/lw/apps', official: true, enabled: true },
    ]);
  });
});

describe('fixed catalog entries of trusted fleets (2026-11-01)', () => {
  const acme = {
    issuer: 'https://fleet.acme.example',
    name: 'Acme fleet',
    catalog: { url: 'https://fleet.acme.example', publicKeys: [key] },
  };
  const beta = {
    issuer: 'urn:beta',
    name: 'Beta Fleet!',
    catalog: { url: 'https://beta.example.com/lw', publicKeys: [other] },
  };
  const bare = { issuer: 'gamma', name: 'Gamma', catalog: null };
  const fixed = (config: ReturnType<typeof effectiveAppStoreConfig>) =>
    config.catalogs.filter((c) => c.fleet).map((c) => [c.name, c.type, c.url, c.enabled, c.fleet?.issuer]);

  it('adds nothing without trusted fleets or without a registered catalog', () => {
    expect(effectiveAppStoreConfig(undefined, official, []).catalogs.map((c) => c.name)).toEqual(['official']);
    expect(effectiveAppStoreConfig(undefined, official, [bare]).catalogs.map((c) => c.name)).toEqual(['official']);
  });

  it('adds one enabled type: fleet entry per trusted fleet with a catalog (also without a stored appStore)', () => {
    expect(fixed(effectiveAppStoreConfig(undefined, official, [acme]))).toEqual([
      ['acme-fleet', 'fleet', 'https://fleet.acme.example', true, 'https://fleet.acme.example'],
    ]);

    const two = effectiveAppStoreConfig({ catalogs: [], allowedTrust: ['official'] }, official, [beta, bare, acme]);

    // Issuer order, so the derived names don't depend on the database's row order.
    expect(fixed(two)).toEqual([
      ['acme-fleet', 'fleet', 'https://fleet.acme.example', true, 'https://fleet.acme.example'],
      ['beta-fleet', 'fleet', 'https://beta.example.com/lw', true, 'urn:beta'],
    ]);
    expect(two.catalogs[0]).toMatchObject({ name: 'official', enabled: false });
    expect(two.catalogs.find((c) => c.name === 'beta-fleet')?.publicKeys).toBeUndefined();
    // The policy is untouched: the entry only guarantees the catalog is there.
    expect(two.allowedTrust).toEqual(['official']);
  });

  it('pins a stored type: fleet entry for the same URL instead of adding one (stays enabled, keeps its name)', () => {
    const stored = { name: 'fleet', type: 'fleet', url: 'https://fleet.acme.example/', enabled: false };
    const config = effectiveAppStoreConfig({ catalogs: [stored] }, official, [acme]);

    expect(config.catalogs.map((c) => c.name)).toEqual(['official', 'fleet']);
    expect(config.catalogs[1]).toMatchObject({ name: 'fleet', enabled: true, fleet: { issuer: acme.issuer } });

    // Another type at that URL is not the fleet's catalog.
    const git = { name: 'mirror', type: 'git', url: 'https://fleet.acme.example', publicKeys: [key], enabled: false };

    expect(fixed(effectiveAppStoreConfig({ catalogs: [git] }, official, [acme])).map((c) => c[0])).toEqual([
      'acme-fleet',
    ]);
  });

  it('is back after a write removed it, and gone once the fleet is no longer trusted', () => {
    expect(fixed(effectiveAppStoreConfig({ catalogs: [] }, official, [acme]))).toHaveLength(1);
    expect(fixed(effectiveAppStoreConfig({ catalogs: [] }, official, []))).toHaveLength(0);

    // A stored entry stays what the admin wrote once the fleet is gone (not fixed, its own enabled flag).
    const stored = { name: 'fleet', type: 'fleet', url: 'https://fleet.acme.example', enabled: false };

    expect(effectiveAppStoreConfig({ catalogs: [stored] }, official, []).catalogs[1]).toEqual(stored);
  });

  it('names the entry after the fleet, else its issuer, unique among the catalogs', () => {
    expect(fleetCatalogName({ issuer: 'x', name: 'Acme fleet' }, new Set())).toBe('acme-fleet');
    expect(fleetCatalogName({ issuer: 'https://fleet.example.com', name: '—' }, new Set())).toBe(
      'https-fleet-example-com',
    );
    expect(fleetCatalogName({ issuer: '...', name: '!!' }, new Set())).toBe('fleet');
    expect(fleetCatalogName({ issuer: 'x', name: 'Acme' }, new Set(['acme', 'acme-2']))).toBe('acme-3');
    expect(fleetCatalogName({ issuer: 'x', name: 'a'.repeat(80) }, new Set(['a'.repeat(63)]))).toBe(
      `${'a'.repeat(61)}-2`,
    );

    const clash = effectiveAppStoreConfig(
      { catalogs: [{ name: 'acme-fleet', type: 'git', url: 'https://g.example.com/r.git', publicKeys: [key] }] },
      official,
      [acme],
    );

    expect(fixed(clash).map((c) => c[0])).toEqual(['acme-fleet-2']);
  });
});

describe('pinned names and plan warnings of fixed fleet entries (2026-11-01)', () => {
  const pinned = (name: string, catalogName?: string) => ({
    issuer: 'fleet-1',
    name,
    catalog: { url: 'https://fleet.acme.example', publicKeys: [key], ...(catalogName ? { name: catalogName } : {}) },
  });
  const names = (config: ReturnType<typeof effectiveAppStoreConfig>) =>
    config.catalogs.filter((c) => c.fleet).map((c) => c.name);

  it('uses the name pinned with the registration; renaming the fleet changes nothing', () => {
    expect(names(effectiveAppStoreConfig({ catalogs: [] }, official, [pinned('Acme fleet', 'fleet')]))).toEqual([
      'fleet',
    ]);
    expect(names(effectiveAppStoreConfig({ catalogs: [] }, official, [pinned('Renamed', 'fleet')]))).toEqual(['fleet']);
    // Registrations without a pinned name (stored before): derived as before.
    expect(names(effectiveAppStoreConfig({ catalogs: [] }, official, [pinned('Acme fleet')]))).toEqual(['acme-fleet']);
    // Taken by a stored catalog: the same suffix on every read.
    const taken = { catalogs: [{ name: 'fleet', type: 'git', url: 'https://g.example.com/r.git', publicKeys: [key] }] };

    expect(names(effectiveAppStoreConfig(taken, official, [pinned('Acme fleet', 'fleet')]))).toEqual(['fleet-2']);
    expect(names(effectiveAppStoreConfig(taken, official, [pinned('Acme fleet', 'fleet')]))).toEqual(['fleet-2']);
  });

  it('warns when a change removes or disables a stored entry of a trusted fleet’s catalog', () => {
    const fleets = [pinned('Acme fleet', 'fleet')];
    const entry = { name: 'fleet', type: 'fleet', url: 'https://fleet.acme.example/', enabled: true };
    const other = { name: 'acme', type: 'git', url: 'https://g.example.com/r.git', publicKeys: [key], enabled: true };
    const message =
      'fleet is managed by fleet Acme fleet; disabling or removing it has no effect (it stays enabled while the cluster trusts the fleet)';

    expect(fleetManagedCatalogWarnings({ catalogs: [entry] }, { catalogs: [] }, fleets)).toEqual([
      { level: 'warning', path: 'appStore.catalogs', message },
    ]);
    expect(fleetManagedCatalogWarnings({ catalogs: [entry] }, undefined, fleets)).toHaveLength(1);
    expect(
      fleetManagedCatalogWarnings({ catalogs: [entry] }, { catalogs: [{ ...entry, enabled: false }] }, fleets),
    ).toHaveLength(1);
    expect(fleetManagedCatalogWarnings(undefined, { catalogs: [{ ...entry, enabled: false }] }, fleets)).toHaveLength(
      1,
    );

    // Already off before, other catalogs only, no trusted fleet / no catalog, unparseable: nothing.
    const off = { catalogs: [{ ...entry, enabled: false }] };

    expect(fleetManagedCatalogWarnings(off, { ...off, allowedTrust: ['official'] }, fleets)).toEqual([]);
    expect(fleetManagedCatalogWarnings({ catalogs: [entry, other] }, { catalogs: [entry] }, fleets)).toEqual([]);
    expect(fleetManagedCatalogWarnings({ catalogs: [entry] }, { catalogs: [] }, [])).toEqual([]);
    expect(
      fleetManagedCatalogWarnings({ catalogs: [entry] }, { catalogs: [] }, [{ ...fleets[0], catalog: null }]),
    ).toEqual([]);
    expect(fleetManagedCatalogWarnings({ catalogs: [entry] }, { catalogs: 'nope' }, fleets)).toEqual([]);
  });
});

describe('catalog keys (P1)', () => {
  const source = (extra: Partial<CatalogSource>): CatalogSource =>
    ({ name: 'x', type: 'git', url: 'https://g.example.com/r.git', enabled: true, ...extra }) as CatalogSource;
  const fleets = [{ catalog: { url: 'https://fleet.example.com', publicKeys: [other] } }, { catalog: null }];

  it('uses the shipped key for the official catalog (none configured = untrusted)', () => {
    expect(catalogKeys(source({ official: true }), { publicKeys: [key] }, [])).toMatchObject({
      keys: [key],
      origin: 'official',
    });
    expect(catalogKeys(source({ official: true }), { publicKeys: [] }, [])).toMatchObject({ keys: [], origin: 'none' });
  });

  it('uses configured keys, else the trusted fleet registered for a fleet catalog URL', () => {
    expect(catalogKeys(source({ publicKeys: [key] }), { publicKeys: [] }, fleets)).toMatchObject({
      origin: 'configured',
    });
    expect(
      catalogKeys(source({ type: 'fleet', url: 'https://fleet.example.com/' }), { publicKeys: [] }, fleets),
    ).toEqual({ keys: [other], origin: 'fleet', trustedFleet: true });
    expect(catalogKeys(source({ type: 'fleet', url: 'https://evil.example.com' }), { publicKeys: [] }, fleets)).toEqual(
      { keys: [], origin: 'none', trustedFleet: false },
    );
  });

  it('binds the cache to type, URL, ref and keys', () => {
    const a = catalogSourceHash({ type: 'git', url: 'https://g/r', ref: 'main' }, [key]);

    expect(catalogSourceHash({ type: 'git', url: 'https://g/r', ref: 'main' }, [key])).toBe(a);
    expect(catalogSourceHash({ type: 'git', url: 'https://g/r', ref: 'dev' }, [key])).not.toBe(a);
    expect(catalogSourceHash({ type: 'git', url: 'https://g/r', ref: 'main' }, [other])).not.toBe(a);
  });

  it('shows URLs without credentials', () => {
    expect(displayCatalogUrl('https://user:tok@g.example.com/r.git?x=1#dir')).toBe('https://g.example.com/r.git');
    expect(displayCatalogUrl('oci://ghcr.io/a/b')).toBe('oci://ghcr.io/a/b');
  });
});
