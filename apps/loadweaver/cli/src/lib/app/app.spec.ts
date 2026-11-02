import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateSigningKeyPair, verifyBlob } from '@forepath/loadweaver/shared/util-app-catalog';

import { main } from '../../main';

import { writeCatalog } from './__fixtures__/catalog-fixture';
import { bumpPackage } from './bump';
import { loadPublicKeys, loadSigningKey, readPublicKey } from './keys';

describe('lw app (CLI)', () => {
  let dir: string;
  let lines: string[];
  const run = (...args: string[]) => main(['app', ...args], (l) => lines.push(l));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-app-cli-'));
    lines = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env['LW_APP_SIGNING_KEY'];
    delete process.env['LW_APP_SIGNING_KEY_PASSPHRASE'];
  });

  it('prints its usage', async () => {
    await run();
    expect(lines[0]).toContain('loadweaver app init');
  });

  it('prints its usage for --help / -h (also after a subcommand)', async () => {
    await run('--help');
    await run('publish', 'oci', '-h');
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.includes('loadweaver app init'))).toBe(true);
  });

  it('init → validate → lint → package → keygen → sign → verify', async () => {
    const pkg = join(dir, 'hello', '0.1.0');

    await run('init', 'hello', '-o', pkg);
    await run(
      'validate',
      pkg,
      '--set',
      'domain=hello.example.org',
      '--render',
      join(dir, 'rendered.yaml'),
      '--deployment',
      join(dir, 'deployment.yaml'),
      '--project',
      'sandbox',
    );

    const deployment = await readFile(join(dir, 'deployment.yaml'), 'utf8');

    expect(deployment).toContain('kind: Deployment');
    expect(deployment).toContain('project: sandbox');
    expect(deployment).toContain('compose: |');
    expect(await readFile(join(dir, 'rendered.yaml'), 'utf8')).toMatch(/host: '?hello\.example\.org/);
    await run('lint', pkg);
    expect(lines.join('\n')).toContain('lint passed');

    const archive = join(dir, 'hello.tar.gz');

    await run('package', pkg, '-o', archive);
    expect(lines.at(-1)).toMatch(/hello 0\.1\.0 sha256:[0-9a-f]{64}/);

    await run('keygen', '-o', join(dir, 'keys', 'me'));
    expect((await stat(join(dir, 'keys', 'me.key'))).mode & 0o777).toBe(0o600);
    expect(lines.join('\n')).not.toContain('PRIVATE KEY');
    await expect(run('keygen', '-o', join(dir, 'keys', 'me'))).rejects.toThrow('already exists');

    await run('sign', archive, '--key', join(dir, 'keys', 'me.key'), '--oci', 'oci://ghcr.io/acme/apps');
    expect(await readFile(`${archive}.oci.sig`, 'utf8')).toMatch(/^[A-Za-z0-9+/=]+\n$/);

    await run('verify', archive, '--key', join(dir, 'keys'));
    expect(lines.at(-1)).toContain('hello 0.1.0');

    await writeFile(join(pkg, 'package.sig'), await readFile(`${archive}.sig`));
    await run('verify', pkg, '--key', join(dir, 'keys', 'me.pub'));
    expect(lines.at(-1)).toContain('signed by');

    await writeFile(join(pkg, 'README.md'), '# changed\n');
    await expect(run('verify', pkg, '--key', join(dir, 'keys', 'me.pub'))).rejects.toThrow('does not match');
  });

  it('fails lint and validate with a non-zero result', async () => {
    const pkg = join(dir, 'bad');

    await run('init', 'bad', '-o', pkg);
    await writeFile(join(pkg, 'compose.yaml'), 'services:\n  web:\n    image: nginx:latest\n    privileged: true\n');
    await expect(run('lint', pkg)).rejects.toThrow('2 lint error(s)');
    await expect(run('validate', pkg)).rejects.toThrow('validation error(s)');
    expect(lines.join('\n')).toContain('not pinned by digest');
  });

  it('builds a Git catalog and verifies it; tampering is detected', async () => {
    const fx = await writeCatalog(join(dir, 'catalog'), { trust: 'official', publisherUsesCatalogKey: true });

    await writeFile(join(dir, 'catalog.key'), fx.catalogKey.privateKeyPem, { mode: 0o600 });

    const out = join(dir, 'out');

    await run(
      'index',
      'build',
      join(dir, 'catalog'),
      '--key',
      join(dir, 'catalog.key'),
      '-o',
      out,
      '--now',
      '2026-10-31T00:00:00Z',
    );
    expect(await readFile(join(out, 'index.yaml'), 'utf8')).toContain('generatedAt: 2026-10-31T00:00:00Z');
    await stat(join(out, 'demo', '1.0.0.tar.gz.sig'));

    await run('verify', out, '--key', join(dir, 'catalog', 'keys'));
    expect(lines.at(-1)).toContain('1 package(s) verified');
    await run('verify', join(out, 'index.yaml'), '--key', join(dir, 'catalog', 'keys', 'catalog.pub'));
    expect(lines.at(-1)).toContain('test-catalog index signed');

    await writeFile(join(out, 'demo', '1.0.0.tar.gz'), Buffer.from('tampered'));
    await expect(run('verify', out, '--key', join(dir, 'catalog', 'keys'))).rejects.toThrow('does not match the index');

    await run('verify', join(dir, 'catalog'));
    expect(lines.at(-2)).toContain('unsigned');
    await expect(run('verify', join(dir, 'catalog'), '--require-signatures')).rejects.toThrow('package.sig is missing');
  });

  it('dry-runs an OCI publish without touching the network', async () => {
    const fx = await writeCatalog(join(dir, 'catalog'), { trust: 'official', publisherUsesCatalogKey: true });
    const fetchSpy = jest.spyOn(global, 'fetch');

    process.env['LW_APP_SIGNING_KEY'] = fx.catalogKey.privateKeyPem;
    await run('publish', 'oci', join(dir, 'catalog'), '--repo', 'oci://ghcr.io/acme/apps', '--dry-run');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('ghcr.io/acme/apps');
    expect(lines.join('\n')).toContain('acme/apps:index');
    expect(lines.join('\n')).not.toContain('PRIVATE');
    fetchSpy.mockRestore();
    await expect(run('publish', 'oci', join(dir, 'catalog'), '--dry-run')).rejects.toThrow('--repo');
  });

  it('bumps a package to a new release, re-pinning only the release images', async () => {
    const pkg = join(dir, 'app', '1.0.0');
    const old = `sha256:${'1'.repeat(64)}`;
    const next = `sha256:${'2'.repeat(64)}`;

    await run('init', 'app', '-o', pkg, '--version', '1.0.0');
    await writeFile(
      join(pkg, 'compose.yaml'),
      `services:\n  web:\n    image: ghcr.io/acme/app:1.0.0@${old}\n    environment:\n      WORKER: ghcr.io/acme/worker:1.0.0@${old}\n  db:\n    image: postgres:16@${old}\n`,
    );
    await writeFile(join(pkg, 'README.md'), 'Release **1.0.0**.\n');

    const resolved: string[] = [];
    const result = await bumpPackage(pkg, '1.1.0', join(dir, 'app', '1.1.0'), async (image) => {
      resolved.push(image);

      return next;
    });

    expect(resolved).toEqual(['ghcr.io/acme/app:1.1.0', 'ghcr.io/acme/worker:1.1.0']);
    expect(result.replaced).toHaveLength(2);

    const compose = await readFile(join(dir, 'app', '1.1.0', 'compose.yaml'), 'utf8');

    expect(compose).toContain(`ghcr.io/acme/app:1.1.0@${next}`);
    expect(compose).toContain(`ghcr.io/acme/worker:1.1.0@${next}`);
    expect(compose).toContain(`postgres:16@${old}`);
    expect(await readFile(join(dir, 'app', '1.1.0', 'manifest.yaml'), 'utf8')).toContain('version: 1.1.0');
    expect(await readFile(join(dir, 'app', '1.1.0', 'README.md'), 'utf8')).toBe('Release **1.1.0**.\n');
    expect(await readFile(join(dir, 'app', '1.1.0', 'release.yaml'), 'utf8')).toMatch(/channel: stable/);
    await expect(bumpPackage(pkg, '1.1.0', join(dir, 'app', '1.1.0'), async () => next)).rejects.toThrow('exists');
    await expect(run('bump', pkg)).rejects.toThrow('--version');
  });
});

describe('lw app keys', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-app-keys-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads keys from a file, env:VAR and LW_APP_SIGNING_KEY', async () => {
    const pair = generateSigningKeyPair();

    await writeFile(join(dir, 'k.pem'), pair.privateKeyPem);
    expect((await loadSigningKey({ key: join(dir, 'k.pem') })).keyId).toBe(pair.keyId);
    expect((await loadSigningKey({ key: 'env:MY_KEY' }, { MY_KEY: pair.privateKeyPem })).keyId).toBe(pair.keyId);
    expect((await loadSigningKey({}, { LW_APP_SIGNING_KEY: pair.privateKeyPem })).keyId).toBe(pair.keyId);
    await expect(loadSigningKey({}, {})).rejects.toThrow('no signing key');
    await expect(loadSigningKey({ key: 'env:NOPE' }, {})).rejects.toThrow('no signing key');
  });

  it('decrypts passphrase-protected PKCS#8 keys and never echoes key material', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const encrypted = privateKey
      .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'hunter2' })
      .toString();

    await writeFile(join(dir, 'enc.pem'), encrypted);

    const key = await loadSigningKey({ key: join(dir, 'enc.pem') }, { LW_APP_SIGNING_KEY_PASSPHRASE: 'hunter2' });

    expect(key.passphrase).toBe('hunter2');
    expect(createPrivateKey({ key: key.privateKeyPem, passphrase: 'hunter2' }).asymmetricKeyType).toBe('ec');

    try {
      await loadSigningKey({ key: join(dir, 'enc.pem') }, {});
      throw new Error('expected a failure');
    } catch (error) {
      expect((error as Error).message).toContain('LW_APP_SIGNING_KEY_PASSPHRASE');
      expect((error as Error).message).not.toContain('BEGIN');
    }

    await expect(
      loadSigningKey({ key: join(dir, 'enc.pem'), passphraseEnv: 'PW' }, { PW: 'hunter2' }),
    ).resolves.toBeDefined();
  });

  it('refuses unsupported and cosign-encrypted keys, and private keys where public ones belong', async () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });

    await writeFile(join(dir, 'rsa.pem'), rsa);
    await expect(loadSigningKey({ key: join(dir, 'rsa.pem') })).rejects.toThrow('ECDSA P-256 or Ed25519');

    await writeFile(
      join(dir, 'cosign.key'),
      // Split so secret scanners don't mistake the marker for key material.
      [
        '-----BEGIN ENCRYPTED SIGSTORE',
        'PRIVATE KEY-----',
        'x',
        '-----END ENCRYPTED SIGSTORE',
        'PRIVATE KEY-----',
      ].join(' '),
    );
    await expect(loadSigningKey({ key: join(dir, 'cosign.key') })).rejects.toThrow('cosign import-key-pair');

    const pair = generateSigningKeyPair('ed25519');

    await writeFile(join(dir, 'priv.pub'), pair.privateKeyPem);
    await expect(readPublicKey(join(dir, 'priv.pub'))).rejects.toThrow('is a private key');

    await mkdir(join(dir, 'keys'));
    await writeFile(join(dir, 'keys', 'a.pub'), pair.publicKeyPem);
    await writeFile(join(dir, 'keys', 'notes.txt'), 'ignored');

    const keys = await loadPublicKeys([join(dir, 'keys')]);

    expect(keys).toHaveLength(1);
    expect(verifyBlob(Buffer.from('x'), 'AAAA', keys).ok).toBe(false);
  });
});
