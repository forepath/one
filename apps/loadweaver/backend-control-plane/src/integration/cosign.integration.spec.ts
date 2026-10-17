import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

  beforeAll(() => {
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

    // Two repositories with the same image (copied by cosign from inside the lab network), only one gets signed.
    for (const name of ['signed', 'unsigned']) {
      cosign(['copy', '--allow-insecure-registry', BASE, `${address}:5000/lab/${name}`]);
      pushed[name] = BASE.split('@')[1];
    }

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
