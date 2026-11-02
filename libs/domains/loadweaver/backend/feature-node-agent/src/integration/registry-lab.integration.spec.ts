import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ObjectStoreGeneration, RegistryRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
  signJwtEs256,
} from '@forepath/loadweaver/shared/util-pki';

import { DEFAULT_GARAGE_IMAGE, renderGarageConfig } from '../lib/object-store/garage-config';
import { DEFAULT_REGISTRY_IMAGE, renderRegistryInstances } from '../lib/registry/registry-config';
import { RegistryRouter } from '../lib/registry/registry-router';

/**
 * Built-in registry on real components (3.20, 3.22): Garage and Distribution run with exactly the configuration the
 * agent renders (bound to a node address on an isolated bridge network), images are pushed with a control-plane
 * style token and pulled through the node router; private repositories only for the node's own workloads.
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function eventually<T>(fn: () => Promise<T | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const start = Date.now();

  for (;;) {
    try {
      const value = await fn();

      if (value !== undefined && value !== false) return value as T;
    } catch {
      // retry
    }

    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');

    await new Promise((r) => setTimeout(r, 500));
  }
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex');
const sha256 = (data: Buffer | string) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

describe('built-in registry on real Garage and Distribution (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-lab-registry-${run}`;
  const subnet = `10.${150 + (process.pid % 50)}.${Date.now() % 250}.0/24`;
  const prefix = subnet.split('.').slice(0, 3).join('.');
  const nodeAddress = `${prefix}.10`;
  const garageName = `lw-lab-garage-${run}`;
  const registryName = `lw-lab-registry-${run}`;
  const mirrorName = `lw-lab-mirror-${run}`;
  const dir = mkdtempSync(join(tmpdir(), 'lw-lab-registry-'));
  const generation: ObjectStoreGeneration = {
    generation: 1,
    replicationFactor: 1,
    ports: { s3: 3910, rpc: 3911, admin: 3913 },
    zone: 'lab',
    rpcSecret: hex(32),
    adminToken: hex(32),
  };
  const keyId = `GK${hex(12)}`;
  const keySecret = hex(32);
  let ca: { certificatePem: string; privateKeyPem: string };
  let signer: { privateKeyPem: string; certificatePem: string };
  let ports: { admin: number; private: number; mirror: number };
  const router = new RegistryRouter();

  const token = (repository: string, actions: string[]) => {
    const now = Math.floor(Date.now() / 1000);

    return signJwtEs256(
      {
        iss: 'loadweaver-control-plane',
        sub: 'test',
        aud: 'loadweaver-registry',
        iat: now,
        nbf: now - 30,
        exp: now + 300,
        access: [{ type: 'repository', name: repository, actions }],
      },
      signer.privateKeyPem,
      signer.certificatePem,
    );
  };
  const published = (container: string, port: number) =>
    Number(
      docker(['port', container, `${port}/tcp`])
        .split('\n')[0]
        .split(':')
        .pop(),
    );

  beforeAll(async () => {
    ca = await createCertificateAuthority({ commonName: 'lab CA', validityDays: 1 });

    // Like the control plane: a dedicated, self-signed registry-token key, separate from the cluster CA.
    signer = await createCertificateAuthority({ commonName: 'lab registry tokens', validityDays: 1 });

    docker(['network', 'create', '--subnet', subnet, network]);

    // Garage, configured as the agent renders it, on the node address.
    writeFileSync(join(dir, 'garage.toml'), renderGarageConfig(generation, nodeAddress));
    docker([
      'run',
      '-d',
      '--memory',
      '512m',
      '--name',
      garageName,
      '--network',
      network,
      '--ip',
      nodeAddress,
      '-p',
      `127.0.0.1::${generation.ports.admin}`,
      '-v',
      `${join(dir, 'garage.toml')}:/etc/garage.toml:ro`,
      DEFAULT_GARAGE_IMAGE,
    ]);
    ports = { admin: published(garageName, generation.ports.admin), private: 0, mirror: 0 };

    // What the control plane does through the admin API: layout, key, bucket.
    const admin = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`http://127.0.0.1:${ports.admin}/v2/${path}`, {
        method,
        headers: { Authorization: `Bearer ${generation.adminToken}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);

      return (await res.json()) as Record<string, unknown>;
    };
    const status = await eventually(() => admin('GET', 'GetClusterStatus'));
    const nodeId = (status['nodes'] as { id: string }[])[0].id;

    await admin('POST', 'UpdateClusterLayout', { roles: [{ id: nodeId, zone: 'lab', capacity: 1024 ** 3, tags: [] }] });
    await admin('POST', 'ApplyClusterLayout', { version: 1 });
    await admin('POST', 'ImportKey', { accessKeyId: keyId, secretAccessKey: keySecret, name: 'lw-registry' });

    const bucket = await admin('POST', 'CreateBucket', { globalAlias: 'lw-registry' });

    await admin('POST', 'AllowBucketKey', {
      bucketId: bucket['id'],
      accessKeyId: keyId,
      permissions: { read: true, write: true, owner: false },
    });

    // The registry instances of a member, sharing one network namespace like they share the node address.
    const role: RegistryRole = {
      generation: 1,
      s3: { address: nodeAddress, port: generation.ports.s3 },
      bucket: 'lw-registry',
      privatePort: 5000,
      mirrors: [{ host: 'docker.io', remoteUrl: 'https://registry-1.docker.io', port: 5001 }],
      readOnly: false,
      token: {
        issuer: 'loadweaver-control-plane',
        service: 'loadweaver-registry',
        realm: 'http://127.0.0.1/api/registry/token',
        rootCertificatePem: signer.certificatePem,
      },
      accessKeyId: keyId,
      secretAccessKey: keySecret,
      httpSecret: hex(32),
    };
    const registryAddress = `${prefix}.11`;
    const [privateInstance, mirrorInstance] = renderRegistryInstances(role, registryAddress);

    writeFileSync(join(dir, 'private.yml'), privateInstance.config);
    writeFileSync(join(dir, 'mirror.yml'), mirrorInstance.config);
    writeFileSync(join(dir, 'ca.pem'), signer.certificatePem);
    docker([
      'run',
      '-d',
      '--memory',
      '256m',
      '--name',
      registryName,
      '--network',
      network,
      '--ip',
      registryAddress,
      '-p',
      '127.0.0.1::5000',
      '-p',
      '127.0.0.1::5001',
      '-v',
      `${join(dir, 'private.yml')}:/etc/distribution/config.yml:ro`,
      '-v',
      `${join(dir, 'ca.pem')}:/etc/distribution/ca.pem:ro`,
      DEFAULT_REGISTRY_IMAGE,
    ]);
    docker([
      'run',
      '-d',
      '--memory',
      '256m',
      '--name',
      mirrorName,
      '--network',
      `container:${registryName}`,
      '-v',
      `${join(dir, 'mirror.yml')}:/etc/distribution/config.yml:ro`,
      DEFAULT_REGISTRY_IMAGE,
    ]);
    ports.private = published(registryName, 5000);
    ports.mirror = published(registryName, 5001);
    await eventually(async () => (await fetch(`http://127.0.0.1:${ports.private}/v2/`)).status === 401);
    // The pull-through mirror starts separately: wait for it too (else the first hub pull races it → 503).
    await eventually(async () => (await fetch(`http://127.0.0.1:${ports.mirror}/v2/`).catch(() => undefined))?.ok);
  }, 180_000);

  afterAll(async () => {
    await router.onModuleDestroy();

    if (process.env['LW_LAB_KEEP'] !== '1') {
      for (const name of [mirrorName, registryName, garageName]) {
        try {
          docker(['rm', '-f', name]);
        } catch {
          // gone
        }
      }

      try {
        docker(['network', 'rm', network]);
      } catch {
        // gone
      }
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts pushes only with a token chained to the cluster CA and serves pulls through the node router', async () => {
    const repository = 'shop/app';
    const base = `http://127.0.0.1:${ports.private}/v2/${repository}`;
    const push = token(repository, ['pull', 'push']);
    const auth = { Authorization: `Bearer ${push}` };
    const layer = Buffer.from(`layer ${hex(8)}`);
    const config = Buffer.from(
      JSON.stringify({ architecture: 'amd64', os: 'linux', rootfs: { type: 'layers', diff_ids: [sha256(layer)] } }),
    );
    const upload = async (blob: Buffer) => {
      const start = await fetch(`${base}/blobs/uploads/`, { method: 'POST', headers: auth });

      expect(start.status).toBe(202);

      const location = new URL(start.headers.get('location') as string, base);

      location.searchParams.set('digest', sha256(blob));

      const done = await fetch(location, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(blob),
      });

      expect(done.status).toBe(201);
    };

    // Without a token, or with one signed by a node identity of the cluster CA, nothing gets in.
    expect((await fetch(`${base}/blobs/uploads/`, { method: 'POST' })).status).toBe(401);

    const foreignKeys = await generateKeyPair();
    const foreign = await issueCertificate({
      ca,
      csrPem: await createCsr(foreignKeys, 'n1'),
      clusterId: 'lab',
      kind: 'node',
      name: 'n1',
      validityHours: 1,
    });
    const now = Math.floor(Date.now() / 1000);
    const forged = signJwtEs256(
      {
        iss: 'loadweaver-control-plane',
        sub: 'x',
        aud: 'loadweaver-registry',
        iat: now,
        nbf: now - 30,
        exp: now + 300,
        access: [{ type: 'repository', name: repository, actions: ['pull', 'push'] }],
      },
      foreignKeys.privateKeyPem,
      foreign.certificatePem,
    );

    expect(
      (await fetch(`${base}/blobs/uploads/`, { method: 'POST', headers: { Authorization: `Bearer ${forged}` } }))
        .status,
    ).toBe(401);

    await upload(layer);
    await upload(config);

    const manifest = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha256(config), size: config.length },
        layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar', digest: sha256(layer), size: layer.length }],
      }),
    );
    const put = await fetch(`${base}/manifests/v1`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/vnd.oci.image.manifest.v1+json' },
      body: new Uint8Array(manifest),
    });

    expect(put.status).toBe(201);
    expect(put.headers.get('docker-content-digest')).toBe(sha256(manifest));

    // The node router: private pulls with a node token, only for the node's own workloads.
    const requested: string[][] = [];

    router.tokenProvider = async (repositories) => {
      requested.push(repositories);

      return { token: token(repositories[0], ['pull']), expiresInSeconds: 300 };
    };
    await router.apply(
      {
        routerPort: 0,
        endpoints: ['127.0.0.1'],
        privateHost: 'registry.lw',
        privatePort: ports.private,
        mirrors: [{ host: 'docker.io', port: ports.mirror }],
      },
      new Set([repository]),
    );

    const via = `http://127.0.0.1:${router.listening}`;

    expect((await fetch(`${via}/v2/`)).status).toBe(200);

    const pulled = await fetch(`${via}/v2/registry.lw/${repository}/manifests/${sha256(manifest)}`, {
      headers: { Accept: 'application/vnd.oci.image.manifest.v1+json' },
    });

    expect(pulled.status).toBe(200);
    expect(Buffer.from(await pulled.arrayBuffer()).equals(manifest)).toBe(true);

    const blob = await fetch(`${via}/v2/registry.lw/${repository}/blobs/${sha256(layer)}`);

    expect(Buffer.from(await blob.arrayBuffer()).equals(layer)).toBe(true);
    // Cached: one token for both requests.
    expect(requested).toEqual([[repository]]);
    expect((await fetch(`${via}/v2/registry.lw/other/app/manifests/v1`)).status).toBe(403);
    expect((await fetch(`${via}/v2/registry.lw/${repository}/blobs/uploads/`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${via}/v2/quay.io/x/y/manifests/1`)).status).toBe(404);

    // Pull-through cache for Docker Hub, stored in Garage.
    const hub = await fetch(`${via}/v2/docker.io/library/busybox/manifests/1.37`, {
      headers: {
        Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
      },
    });

    expect(hub.status).toBe(200);
    expect(hub.headers.get('docker-content-digest')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
