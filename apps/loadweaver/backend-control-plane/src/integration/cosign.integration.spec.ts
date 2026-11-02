import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ImageResolverService, verifyCosignSignature } from '@forepath/loadweaver/backend/feature-control-plane';
import { DEFAULT_REGISTRY_IMAGE } from '@forepath/loadweaver/backend/feature-node-agent';

/**
 * cosign interoperability (3.22): an image signed by the real cosign CLI (classic `.sig` format, key-based) in a real
 * registry verifies with the control plane's verifier; another key and an unsigned image don't.
 */

const COSIGN =
  'gcr.io/projectsigstore/cosign:v2.6.5@sha256:ad281047f85c5e1fc6ffbc30c2b55be3b07b4032bef715a12122ce5829619aca';
const BASE = 'docker.io/library/alpine:3.10.9@sha256:451eee8bedcb2f029756dc3e9d73bab0e7943c1ac55cff3a4861c52a0fdd3e98';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('cosign signatures (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-cosign-${run}`;
  const registry = `lw-cosign-registry-${run}`;
  const dir = mkdtempSync(join(tmpdir(), 'lw-cosign-'));
  let port = 0;
  let address = '';
  const pushed: Record<string, string> = {};

  /** Pushes the image manifest of an OCI layout (from `docker save`) to `lab/<name>:base`; returns its digest. */
  const pushLayout = async (layout: string, name: string): Promise<string> => {
    const blob = (digest: string) => readFileSync(join(layout, 'blobs', ...digest.split(':')));
    const base = `http://127.0.0.1:${port}/v2/lab/${name}`;
    let entry = JSON.parse(readFileSync(join(layout, 'index.json'), 'utf8')).manifests[0] as {
      digest: string;
      mediaType: string;
    };

    // An index: take the platform manifest that the save included.
    while (entry.mediaType.endsWith('index.v1+json') || entry.mediaType.endsWith('manifest.list.v2+json')) {
      const children = JSON.parse(blob(entry.digest).toString()).manifests as (typeof entry)[];

      entry = children.find((c) => {
        try {
          blob(c.digest);

          return true;
        } catch {
          return false;
        }
      }) as typeof entry;
    }

    const manifest = JSON.parse(blob(entry.digest).toString()) as {
      config: { digest: string };
      layers: { digest: string }[];
    };

    for (const digest of [manifest.config.digest, ...manifest.layers.map((l) => l.digest)]) {
      const start = await fetch(`${base}/blobs/uploads/`, { method: 'POST' });
      const location = new URL(start.headers.get('location') as string, `http://127.0.0.1:${port}`);

      location.searchParams.set('digest', digest);

      const put = await fetch(location, { method: 'PUT', body: blob(digest) });

      if (!put.ok) throw new Error(`blob ${digest}: ${put.status}`);
    }

    const put = await fetch(`${base}/manifests/base`, {
      method: 'PUT',
      headers: { 'content-type': entry.mediaType },
      body: blob(entry.digest),
    });

    if (!put.ok) throw new Error(`manifest lab/${name}: ${put.status} ${await put.text()}`);

    return entry.digest;
  };

  const cosign = (args: string[]) =>
    docker([
      'run',
      '--rm',
      '--network',
      network,
      '-v',
      `${dir}:/w`,
      '-w',
      '/w',
      '-e',
      'COSIGN_PASSWORD=',
      '-e',
      'HOME=/w',
      '--user',
      `${process.getuid?.() ?? 0}`,
      COSIGN,
      ...args,
    ]);

  beforeAll(async () => {
    chmodSync(dir, 0o777);
    docker(['network', 'create', network]);
    docker([
      'run',
      '-d',
      '--name',
      registry,
      '--network',
      network,
      '-p',
      '127.0.0.1::5000',
      '--memory',
      '128m',
      DEFAULT_REGISTRY_IMAGE,
    ]);
    port = Number(docker(['port', registry, '5000/tcp']).split('\n')[0].split(':').pop());
    address = docker(['inspect', '-f', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, registry]);

    // Two repositories with the same image, only one gets signed. Seeded from the local image cache (pulled once)
    // as an OCI layout pushed by cosign inside the lab network, so the lab doesn't hit Docker Hub's rate limit.
    try {
      docker(['image', 'inspect', BASE]);
    } catch {
      docker(['pull', BASE]);
    }

    docker(['save', BASE, '-o', join(dir, 'base.tar')]);
    mkdirSync(join(dir, 'layout'));
    execFileSync('tar', ['-xf', join(dir, 'base.tar'), '-C', join(dir, 'layout')]);

    for (const name of ['signed', 'unsigned']) pushed[name] = await pushLayout(join(dir, 'layout'), name);

    cosign(['generate-key-pair']);
    cosign([
      'sign',
      '--key',
      'cosign.key',
      '--tlog-upload=false',
      '--allow-insecure-registry',
      '--yes',
      `${address}:5000/lab/signed@${pushed['signed']}`,
    ]);
  }, 300_000);

  afterAll(() => {
    try {
      docker(['rm', '-f', registry]);
      docker(['network', 'rm', network]);
    } catch {
      // gone
    }

    rmSync(dir, { recursive: true, force: true });
  });

  const reader = (name: string) =>
    new ImageResolverService().clusterReader(
      `127.0.0.1:${port}/lab/${name}@${pushed[name]}`,
      [`127.0.0.1:${port}`],
      'unused',
    );

  it('verifies a signature made by the cosign CLI', async () => {
    const key = readFileSync(join(dir, 'cosign.pub'), 'utf8');

    expect(await verifyCosignSignature(reader('signed'), pushed['signed'], [key])).toEqual({ verified: true, key: 0 });
  });

  it('refuses other keys and unsigned images', async () => {
    cosign(['generate-key-pair', '--output-key-prefix', 'other']);

    const other = readFileSync(join(dir, 'other.pub'), 'utf8');
    const key = readFileSync(join(dir, 'cosign.pub'), 'utf8');

    expect(await verifyCosignSignature(reader('signed'), pushed['signed'], [other])).toMatchObject({ verified: false });
    expect(await verifyCosignSignature(reader('unsigned'), pushed['unsigned'], [key])).toEqual({
      verified: false,
      reason: 'no cosign signature found',
    });
  });
});
