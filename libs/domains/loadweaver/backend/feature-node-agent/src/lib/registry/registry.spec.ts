import type {
  ObjectStoreGeneration,
  RegistryClient,
  RegistryRole,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { parse } from 'yaml';

import { garageSpec, renderGarageConfig } from '../object-store/garage-config';
import { privateRepositories, routedImage } from './image-routing';
import { mirrorContainerName, registrySpec, renderRegistryInstances } from './registry-config';
import { RegistryRouter, routeRequest } from './registry-router';

const DIGEST = `sha256:${'c'.repeat(64)}`;
const client: RegistryClient = {
  routerPort: 7479,
  endpoints: ['10.93.0.1'],
  privateHost: 'registry.lw',
  privatePort: 5000,
  mirrors: [
    { host: 'docker.io', port: 5001 },
    { host: 'ghcr.io', port: 5002 },
  ],
};

describe('image routing', () => {
  it('routes mirrored and private images through the loopback router', () => {
    expect(routedImage(`nginx@${DIGEST}`, client)).toBe(`127.0.0.1:7479/docker.io/library/nginx@${DIGEST}`);
    expect(routedImage(`ghcr.io/acme/api:1@${DIGEST}`, client)).toBe(`127.0.0.1:7479/ghcr.io/acme/api@${DIGEST}`);
    expect(routedImage('registry.lw/shop/api:2', client)).toBe('127.0.0.1:7479/registry.lw/shop/api:2');
    expect(routedImage(`quay.io/x/y@${DIGEST}`, client)).toBe(`quay.io/x/y@${DIGEST}`);
    expect(routedImage(`nginx@${DIGEST}`, undefined)).toBe(`nginx@${DIGEST}`);
  });

  it('allows private repositories of the node workloads only', () => {
    expect([...privateRepositories([{ image: 'registry.lw/shop/api:1' }, { image: 'nginx:1' }], client)]).toEqual([
      'shop/api',
    ]);
    expect(privateRepositories([{ image: 'registry.lw/shop/api:1' }], undefined).size).toBe(0);
    // Generic microVMs fetch their guest image's layers through the router (3.35).
    expect([
      ...privateRepositories(
        [
          {
            image: 'ghcr.io/forepath/microvm-launcher:1',
            microvm: { mode: 'generic', guestImage: 'registry.lw/shop/web@sha256:' + 'a'.repeat(64) } as never,
          },
        ],
        client,
      ),
    ]).toEqual(['shop/web']);
    // Full VMs fetch their disk image's layer through the router (3.35).
    expect([
      ...privateRepositories(
        [
          {
            image: 'ghcr.io/forepath/microvm-launcher:1',
            vm: { image: { ref: 'registry.lw/shop/debian@sha256:' + 'b'.repeat(64) } } as never,
          },
        ],
        client,
      ),
    ]).toEqual(['shop/debian']);
  });

  it('serves a private repository no workload uses only while a task borrowed it (re-imaging a stopped VM)', async () => {
    const router = new RegistryRouter();
    // A closed port: the router gets past its checks and fails upstream (503), instead of refusing (403).
    const local: RegistryClient = { ...client, routerPort: 0, endpoints: ['127.0.0.1'], privatePort: 1 };
    const tokenProvider = jest.fn(async () => ({ token: 't', expiresInSeconds: 300 }));

    router.tokenProvider = tokenProvider;
    await router.apply(local, new Set());

    const get = async () =>
      (await fetch(`http://127.0.0.1:${router.listening}/v2/registry.lw/shop/debian/blobs/${DIGEST}`)).status;

    try {
      expect(router.registryClient).toBe(local);
      expect(await get()).toBe(403);
      expect(await router.withRepository('shop/debian', get)).toBe(503);
      expect(tokenProvider).toHaveBeenCalledWith(['shop/debian']);
      expect(await get()).toBe(403);
    } finally {
      await router.onModuleDestroy();
    }
  });

  it('maps router paths to the registry instances', () => {
    expect(routeRequest(`/v2/docker.io/library/nginx/manifests/${DIGEST}`, client)).toEqual({
      port: 5001,
      path: `/v2/library/nginx/manifests/${DIGEST}`,
      repository: 'library/nginx',
      private: false,
    });
    expect(routeRequest('/v2/registry.lw/shop/api/blobs/sha256:abc', client)).toMatchObject({
      port: 5000,
      repository: 'shop/api',
      private: true,
    });
    expect(routeRequest('/v2/quay.io/x/manifests/1', client)).toBeNull();
    expect(routeRequest('/v2/docker.io/../etc/manifests/1', client)).toBeNull();
    expect(routeRequest('/v2/docker.io/library/nginx/tags/list', client)).toBeNull();
  });
});

describe('platform configs', () => {
  const generation: ObjectStoreGeneration = {
    generation: 2,
    replicationFactor: 3,
    ports: { s3: 3900, rpc: 3901, admin: 3903 },
    zone: 'fra1',
    rpcSecret: 'a'.repeat(64),
    adminToken: 'b'.repeat(64),
  };

  it('binds Garage to the overlay address only', () => {
    const config = renderGarageConfig(generation, 'fd00::1');

    expect(config).toContain('rpc_bind_addr = "[fd00::1]:3901"');
    expect(config).toContain('api_bind_addr = "[fd00::1]:3900"');
    expect(config).toContain('replication_factor = 3');
    expect(() => renderGarageConfig({ ...generation, rpcSecret: undefined }, '10.0.0.1')).toThrow(
      'without its secrets',
    );
    expect(garageSpec(generation, config, '/var/lib/lw/garage/g2', 'img').binds).toContain(
      '/var/lib/lw/garage/g2/garage.toml:/etc/garage.toml:ro',
    );
  });

  it('renders the private registry with token auth and one pull-through instance per mirror', () => {
    const role: RegistryRole = {
      generation: 1,
      s3: { address: '10.93.0.1', port: 3910 },
      bucket: 'lw-registry',
      privatePort: 5000,
      mirrors: [{ host: 'docker.io', remoteUrl: 'https://registry-1.docker.io', port: 5001 }],
      readOnly: true,
      token: { issuer: 'i', service: 's', realm: 'https://x/api/registry/token', rootCertificatePem: 'CA' },
      accessKeyId: `GK${'0'.repeat(24)}`,
      secretAccessKey: 'd'.repeat(64),
      httpSecret: 'e'.repeat(64),
    };
    const [priv, mirror] = renderRegistryInstances(role, '10.93.0.2');
    const p = parse(priv.config);
    const m = parse(mirror.config);

    expect(p.http).toMatchObject({ addr: '10.93.0.2:5000', relativeurls: true });
    expect(p.auth.token).toMatchObject({
      realm: 'https://x/api/registry/token',
      service: 's',
      issuer: 'i',
      rootcertbundle: '/etc/distribution/ca.pem',
    });
    expect(p.storage.s3).toMatchObject({
      regionendpoint: 'http://10.93.0.1:3910',
      rootdirectory: '/private',
      forcepathstyle: true,
    });
    expect(p.storage.maintenance.readonly.enabled).toBe(true);
    expect(m.proxy).toEqual({ remoteurl: 'https://registry-1.docker.io', ttl: '168h' });
    expect(m.storage.maintenance.readonly.enabled).toBe(false);
    expect(m.auth).toBeUndefined();
    expect(mirror.name).toBe(mirrorContainerName('docker.io'));
    expect(registrySpec(priv, '/d', 'CA', 'img').hash).not.toBe(registrySpec(priv, '/d', 'CA2', 'img').hash);
  });
});
