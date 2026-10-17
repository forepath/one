import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { DesiredState } from '@forepath/loadweaver/shared/util-agent-protocol';
import { DEFAULT_REGISTRY_MIRRORS } from '@forepath/loadweaver/shared/util-model';

import { withPushSecrets } from '../agent-stream/agent-stream.server';
import type { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { objectStoreSecrets } from '../object-store/object-store.utils';
import { objectStoreRole, registryClient, registryRole } from '../object-store/registry-state.utils';
import { ImageResolverService } from '../services/image-resolver.service';
import { uncachedImageWarnings } from '../services/plans.service';
import { RegistryProxyService } from './registry-proxy.service';
import { grantRegistryAccess, parseRegistryScopes } from './registry-scope.utils';

const gen = (extra: Partial<ObjectStoreGenerationEntity>) => ({
  generation: 1,
  replicationFactor: 1,
  state: 'active' as const,
  holders: ['n1'],
  copy: null,
  ...extra,
});
const node = (name: string, overlayV4: string | null, site = 'fra1') => ({ name, site, overlayV4, overlayV6: null });
const registry = { mirrors: DEFAULT_REGISTRY_MIRRORS };

describe('registry scopes', () => {
  it('parses repository scopes and ignores everything else', () => {
    expect(
      parseRegistryScopes([
        'repository:shop/api:pull,push',
        'registry:catalog:*',
        'repository:../etc:pull',
        'repository:shop/api:delete',
      ]),
    ).toEqual([{ name: 'shop/api', actions: ['pull', 'push'] }]);
  });

  it('grants only existing project namespaces and only allowed actions', () => {
    const requested = [
      { name: 'shop/api', actions: ['pull', 'push'] as ('pull' | 'push')[] },
      { name: 'other/api', actions: ['pull'] as ('pull' | 'push')[] },
    ];

    expect(grantRegistryAccess(requested, new Set(['shop']), { pull: true, push: false })).toEqual([
      { name: 'shop/api', actions: ['pull'] },
    ]);
    expect(grantRegistryAccess(requested, new Set(['shop', 'other']), { pull: true, push: true })).toHaveLength(2);
  });
});

describe('registry desired state', () => {
  const nodes = [node('n1', '10.93.0.1'), node('n2', '10.93.0.2'), node('n3', '10.93.0.3')];

  it('runs object-store generations on their holders only', () => {
    const generations = [
      gen({ state: 'retiring' }),
      gen({ generation: 2, replicationFactor: 3, state: 'copying', holders: ['n1', 'n2', 'n3'] }),
    ];

    expect(objectStoreRole(nodes[0], generations)?.generations.map((g) => [g.generation, g.ports.s3, g.zone])).toEqual([
      [1, 3910, 'fra1'],
      [2, 3900, 'fra1'],
    ]);
    expect(objectStoreRole(nodes[1], [gen({})])).toBeUndefined();
    expect(objectStoreRole(nodes[0], [gen({ state: 'retired' })])).toBeUndefined();
  });

  it('gives members registry instances on the active generation, read-only during the final copy', () => {
    const members = new Set(['n1', 'n2']);
    const role = registryRole(
      nodes[1],
      members,
      nodes,
      [gen({}), gen({ generation: 2, state: 'copying', copy: { phase: 'final', copied: 0 } })],
      registry,
      'CA',
      'https://lw.example.com/',
    );

    expect(role).toMatchObject({
      generation: 1,
      s3: { address: '10.93.0.1', port: 3910 },
      readOnly: true,
      token: { realm: 'https://lw.example.com/api/registry/token', rootCertificatePem: 'CA' },
    });
    expect(role?.mirrors.map((m) => m.port)).toEqual([5001, 5002, 5003, 5004, 5005, 5006, 5007]);
    expect(registryRole(nodes[2], members, nodes, [gen({})], registry, 'CA', 'x')).toBeUndefined();
    expect(
      registryRole(nodes[0], members, nodes, [gen({ state: 'provisioning' })], registry, 'CA', 'x'),
    ).toBeUndefined();
  });

  it('lets every node pull through the members once a generation is active', () => {
    expect(registryClient(nodes, new Set(['n1', 'n3']), [gen({})], registry)).toMatchObject({
      routerPort: 7479,
      endpoints: ['10.93.0.1', '10.93.0.3'],
      privateHost: 'registry.lw',
    });
    expect(registryClient(nodes, new Set(['n1']), [], registry)).toBeUndefined();
  });

  it('adds object-store and registry secrets only at push time', () => {
    const key = 'k'.repeat(32);
    const state = {
      controlPlane: { role: 'none', members: [], automaticFailover: false, scope: 'c1' },
      objectStore: {
        generations: [
          { generation: 2, replicationFactor: 1, ports: { s3: 3900, rpc: 3901, admin: 3903 }, zone: 'fra1' },
        ],
      },
      registry: { generation: 2 },
    } as unknown as DesiredState;
    const pushed = withPushSecrets(state, { ENCRYPTION_KEY: key });

    expect(pushed.objectStore?.generations[0]).toMatchObject({
      rpcSecret: objectStoreSecrets(key, 2).rpcSecret,
      adminToken: objectStoreSecrets(key, 2).adminToken,
    });
    expect(pushed.registry).toMatchObject({
      accessKeyId: objectStoreSecrets(key, 2).accessKeyId,
      httpSecret: objectStoreSecrets(key, 2).registryHttpSecret,
    });
    // The stored state stays without secrets.
    expect(state.objectStore?.generations[0].rpcSecret).toBeUndefined();
    expect((state.registry as { accessKeyId?: string }).accessKeyId).toBeUndefined();
  });
});

describe('plans and images', () => {
  it('warns about images nodes pull without the cluster cache', () => {
    const parsed = [
      {
        project: 'shop',
        name: 'web',
        compose: {
          services: [
            { name: 'a', image: 'nginx:1' },
            { name: 'b', image: 'registry.example.com/x:1' },
            { name: 'c', image: 'registry.lw/shop/c:1' },
          ],
        },
      },
    ];

    expect(uncachedImageWarnings(parsed as never, registry).map((w) => w['path'])).toEqual(['services.b.image']);
  });

  it('pins private images through the members, failing over and reporting missing images', async () => {
    const resolver = new ImageResolverService();
    const digest = `sha256:${'b'.repeat(64)}`;
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(url);

      if (url.includes('10.93.0.1')) throw new Error('connect ECONNREFUSED');

      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer t');

      return new Response(null, {
        status: url.includes('missing') ? 404 : 200,
        headers: { 'docker-content-digest': digest },
      });
    };

    expect(
      await resolver.resolveInCluster('registry.lw/shop/api:1', ['10.93.0.1:5000', '10.93.0.2:5000'], 't', fetchImpl),
    ).toBe(`registry.lw/shop/api:1@${digest}`);
    expect(calls).toEqual([
      'http://10.93.0.1:5000/v2/shop/api/manifests/1',
      'http://10.93.0.2:5000/v2/shop/api/manifests/1',
    ]);
    await expect(
      resolver.resolveInCluster('registry.lw/shop/missing:1', ['10.93.0.2:5000'], 't', fetchImpl),
    ).rejects.toThrow('push it first');
  });
});

describe('RegistryProxyService', () => {
  let upstream: Server;
  let app: Server;
  const seen: { method?: string; url?: string; auth?: string; body: string }[] = [];

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      let body = '';

      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        res.writeHead(req.method === 'PUT' ? 201 : 200, {
          'docker-content-digest': 'sha256:x',
          location: '/v2/shop/api/blobs/uploads/abc',
        });
        res.end(req.method === 'GET' ? 'manifest' : '');
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));

    const port = (upstream.address() as AddressInfo).port;

    // The first member is unreachable; the fixed member port is the fake upstream's here.
    class TestProxy extends RegistryProxyService {
      protected override async members(): Promise<string[]> {
        return ['127.0.0.2', '127.0.0.1'];
      }

      protected override port(): number {
        return port;
      }
    }

    app = createServer(new TestProxy({} as never).handler());
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
  });

  afterAll(async () => {
    await new Promise<void>((r) => app.close(() => r()));
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  it('streams pulls and pushes to a member, keeping auth and relative locations', async () => {
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    const pulled = await fetch(`${base}/v2/shop/api/manifests/1`, { headers: { Authorization: 'Bearer t' } });

    expect(await pulled.text()).toBe('manifest');

    const pushed = await fetch(`${base}/v2/shop/api/blobs/uploads/abc?digest=sha256:y`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer t' },
      body: 'layer',
    });

    expect(pushed.status).toBe(201);
    expect(pushed.headers.get('location')).toBe('/v2/shop/api/blobs/uploads/abc');
    expect(seen.map((s) => [s.method, s.url, s.auth, s.body])).toEqual([
      ['GET', '/v2/shop/api/manifests/1', 'Bearer t', ''],
      ['PUT', '/v2/shop/api/blobs/uploads/abc?digest=sha256:y', 'Bearer t', 'layer'],
    ]);
    expect((await fetch(`${base}/v2/../../etc`)).status).toBe(404);
  });
});
