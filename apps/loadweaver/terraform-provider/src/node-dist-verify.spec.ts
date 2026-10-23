import { join } from 'node:path';

import {
  cachedExtractedBinary,
  checkGpgStatus,
  ensurePrivateCacheDir,
  fileMatches,
  NODE_RELEASE_KEY_FINGERPRINTS,
  NODE_RELEASE_KEYS_COMMIT,
  releaseKeyUrl,
  shasumFor,
  signatureMode,
} from '../scripts/node-dist-verify.cjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** In-memory fs: file contents are their "hash" (the injected hash function reads them back). */
function memoryFs(files: Record<string, string> = {}, stats: Record<string, { uid: number; mode: number }> = {}) {
  const store = new Map(Object.entries(files));
  const dirs = new Set(Object.keys(stats));
  const fs = {
    existsSync: jest.fn((p: string) => store.has(p) || dirs.has(p)),
    readFileSync: jest.fn((p: string) => {
      const v = store.get(p);

      if (v === undefined) throw new Error(`ENOENT ${p}`);

      return v;
    }),
    writeFileSync: jest.fn((p: string, data: string) => void store.set(p, data)),
    rmSync: jest.fn((p: string) => {
      for (const key of [...store.keys()]) if (key === p || key.startsWith(`${p}/`)) store.delete(key);

      dirs.delete(p);
    }),
    mkdirSync: jest.fn((p: string) => void dirs.add(p)),
    lstatSync: jest.fn((p: string) => ({ isDirectory: () => dirs.has(p), ...(stats[p] ?? { uid: 0, mode: 0o40700 }) })),
  };
  const hash = jest.fn((p: string) => fs.readFileSync(p).trim());

  return { fs, hash, store };
}

describe('Node.js distribution verification', () => {
  const cache = '/cache';
  const member = 'node-v24.14.1-linux-arm64/bin/node';
  const dir = join(cache, `extracted-${A}`);
  const binary = join(dir, member);

  it('pins the release keys at a commit', () => {
    expect(NODE_RELEASE_KEY_FINGERPRINTS.length).toBeGreaterThan(10);
    expect(NODE_RELEASE_KEY_FINGERPRINTS.every((f) => /^[0-9A-F]{40}$/.test(f))).toBe(true);
    expect(NODE_RELEASE_KEYS_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(releaseKeyUrl(NODE_RELEASE_KEY_FINGERPRINTS[0])).toBe(
      `https://raw.githubusercontent.com/nodejs/release-keys/${NODE_RELEASE_KEYS_COMMIT}/keys/${NODE_RELEASE_KEY_FINGERPRINTS[0]}.asc`,
    );
  });

  it('reads hashes from SHASUMS256.txt', () => {
    const sums = `${A}  node-v24.14.1-linux-x64.tar.xz\n${B}  win-x64/node.exe\nnot-a-hash  other.tar.gz\n`;

    expect(shasumFor(sums, 'win-x64/node.exe')).toBe(B);
    expect(shasumFor(sums, 'other.tar.gz')).toBeNull();
    expect(shasumFor(sums, 'missing')).toBeNull();
  });

  it('accepts only a valid signature by a pinned release key', () => {
    const fpr = NODE_RELEASE_KEY_FINGERPRINTS[0];
    const valid = `[GNUPG:] NEWSIG\n[GNUPG:] GOODSIG 1234 Someone\n[GNUPG:] VALIDSIG ${fpr} 2026-03-24 1774384731 0 4 0 1 8 00 ${fpr}\n`;

    expect(checkGpgStatus(valid)).toEqual({ ok: true, fingerprint: fpr });
    expect(checkGpgStatus(valid.replace(new RegExp(fpr, 'g'), 'F'.repeat(40)))).toMatchObject({ ok: false });
    expect(checkGpgStatus(`${valid}[GNUPG:] BADSIG 1234 Someone\n`)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('BADSIG'),
    });
    expect(checkGpgStatus('[GNUPG:] ERRSIG 1234 1 8 00 1774384731 9\n')).toMatchObject({ ok: false });
    expect(checkGpgStatus('')).toMatchObject({ ok: false });
    expect(checkGpgStatus(`${valid}${valid}`)).toMatchObject({ ok: false });
  });

  it('fails closed without gpg unless explicitly allowed', () => {
    expect(signatureMode({ hasGpg: true, allowUnsigned: false })).toEqual({ mode: 'verify' });
    expect(signatureMode({ hasGpg: true, allowUnsigned: true })).toEqual({ mode: 'verify' });
    expect(signatureMode({ hasGpg: false, allowUnsigned: true })).toEqual({ mode: 'skip' });
    expect(signatureMode({ hasGpg: false, allowUnsigned: false })).toMatchObject({
      mode: 'error',
      message: expect.stringContaining('--allow-unsigned-node-sums'),
    });
  });

  it('refuses a cache directory prepared by someone else', () => {
    const own = memoryFs({}, { '/c': { uid: 1000, mode: 0o40700 } });

    expect(() => ensurePrivateCacheDir({ fs: own.fs, dir: '/c', uid: 1000 })).not.toThrow();
    expect(() => ensurePrivateCacheDir({ fs: own.fs, dir: '/c', uid: 1001 })).toThrow('owned by uid 1000');

    const open = memoryFs({}, { '/c': { uid: 1000, mode: 0o40777 } });

    expect(() => ensurePrivateCacheDir({ fs: open.fs, dir: '/c', uid: 1000 })).toThrow('writable by group / others');

    const missing = memoryFs();

    ensurePrivateCacheDir({ fs: missing.fs, dir: '/new', uid: 1000 });
    expect(missing.fs.mkdirSync).toHaveBeenCalledWith('/new', { recursive: true, mode: 0o700 });
  });

  it('re-hashes cached archives', () => {
    const { fs, hash } = memoryFs({ '/cache/a.tar.xz': A });

    expect(fileMatches({ fs, hash, file: '/cache/a.tar.xz', expected: A })).toBe(true);
    expect(fileMatches({ fs, hash, file: '/cache/a.tar.xz', expected: B })).toBe(false);
    expect(fileMatches({ fs, hash, file: '/cache/missing', expected: A })).toBe(false);
  });

  it('extracts once and re-hashes the cached binary on every use', () => {
    const { fs, hash, store } = memoryFs();
    const extract = jest.fn((_archive: string, _dir: string, entry: string) => void store.set(join(_dir, entry), B));
    const run = () =>
      cachedExtractedBinary({ fs, hash, extract, cache, archive: '/cache/a.tar.xz', archiveHash: A, member });

    expect(run()).toBe(binary);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(store.get(`${binary}.sha256`)).toBe(`${B}\n`);

    expect(run()).toBe(binary);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(hash).toHaveBeenCalledWith(binary);

    // Tampered / corrupted cache: discarded and extracted again from the verified archive.
    store.set(binary, 'c'.repeat(64));
    expect(run()).toBe(binary);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(fs.rmSync).toHaveBeenCalledWith(dir, { recursive: true, force: true });
    expect(store.get(binary)).toBe(B);

    // Malformed record.
    store.set(`${binary}.sha256`, 'garbage');
    run();
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it('refuses archives without a verified hash or without the member', () => {
    const { fs, hash } = memoryFs();

    expect(() =>
      cachedExtractedBinary({ fs, hash, extract: jest.fn(), cache, archive: '/a', archiveHash: '../x', member }),
    ).toThrow('invalid archive hash');
    expect(() =>
      cachedExtractedBinary({ fs, hash, extract: jest.fn(), cache, archive: '/a', archiveHash: A, member }),
    ).toThrow(`${member} missing`);
  });
});
