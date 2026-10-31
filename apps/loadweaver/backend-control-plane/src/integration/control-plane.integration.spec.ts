import {
  agentMessage,
  decodeControlPlaneMessage,
  openAgentStream,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_FEATURES,
  type DesiredState,
  type Envelope,
  type AuthoritativeDns,
  type Ingress,
  type NodeNetworkConfig,
  type WorkloadIdentities,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
  verifyCertificate,
  dnssecKeyMatches,
  generateWireguardKeyPair,
  verifyJwtEs256,
  wireguardPublicKey,
} from '@forepath/loadweaver/shared/util-pki';
import { generateSealKeyPair, openSealed, sealTo } from '@forepath/loadweaver/shared/util-secrets';
import { checkJsonSchema, type JsonSchemaObject } from '@forepath/loadweaver/shared/util-json-schema';
import {
  AlertService,
  ReportsService,
  WallboardService,
  LiveRecordsService,
  SearchService,
  TopologyService,
  HealthService,
  OverviewService,
  CronControllerService,
  garageS3Client,
  MasterKeyService,
  ObjectStoreControllerService,
  PublicAddressControllerService,
  CertificatesService,
  DnsReconcilerService,
  RpkiCheckService,
  DnsFailoverControllerService,
  DnssecService,
  ImagePolicyService,
  ImageResolverService,
  DriftService,
  PlansService,
  PosturePluginRegistry,
  PostureIntegrationsService,
  ProjectAccessService,
  RemoteAccessService,
  ResourcesController,
  ResourceStoreService,
  objectStorePorts,
  objectStoreSecrets,
  REGISTRY_BUCKET,
  WorkloadControllerService,
  NetworkStateService,
  PostgresCertificateRenewalService,
} from '@forepath/loadweaver/backend/feature-control-plane';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DnsProviderRegistry, FailoverIpProviderRegistry } from '@forepath/shared/backend/util-hosting-providers';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpServer, get as httpGet } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import type { RequestWithUser } from '@forepath/identity/backend';
import { io } from 'socket.io-client';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';
import { docker } from './postgres.container';
import { removeContainers, startGarage, type GarageContainer } from './garage.containers';
import { wafModule } from './waf-module';
import { geoipTestDb, GEOIP_TEST_DB_SHA256 } from './geoip-test-db';
// eslint-disable-next-line @nx/enforce-module-boundaries -- exercise the registered controller without adding a public library export just for this integration test
import { SecretsController } from '../../../../../libs/domains/loadweaver/backend/feature-control-plane/src/lib/controllers/secrets.controller';

const PEBBLE_IMAGE =
  'ghcr.io/letsencrypt/pebble:2.10.1@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199';
const VAULT_IMAGE =
  'docker.io/hashicorp/vault:2.2.0@sha256:e0acd3c681bdf57f002d7214e5d050b876e1704678005c6b0406dd96a65be919';

const API_KEY = 'integration-test-api-key';

const SEAL = { n1: generateSealKeyPair(), n2: generateSealKeyPair() } as Record<
  string,
  ReturnType<typeof generateSealKeyPair>
>;

const hello = (nodeName: string, key: string) => ({
  nodeName,
  agentVersion: '0.0.0-it',
  os: { id: 'debian', versionId: '12', kernel: '6.1.0', arch: 'amd64' as const },
  capabilities: {
    runtimes: ['runc' as const],
    sandboxProbe: 'missing' as const,
    wireguard: true,
    nftables: true,
    bird: true,
    drbd: false,
    criu: false,
  },
  capacity: { cpuMillis: 4000, memoryBytes: 8_000_000_000, diskBytes: 100_000_000_000 },
  wireguardPublicKey: key,
  endpointHost: `${nodeName}.example.test`,
  ...(SEAL[nodeName] ? { sealPublicKey: SEAL[nodeName].publicKey } : {}),
  appliedRevision: 0,
});

/**
 * The simulated agents' hellos carry no protocol version or features, like agents built before versioning (3.26):
 * everything the control plane sends them must validate against the latest frozen protocol snapshot (N-1).
 */
const PROTOCOL_COMPAT_DIR = joinPath(
  __dirname,
  '../../../../../libs/domains/loadweaver/shared/util-agent-protocol/src/compat',
);
const N1_PROTOCOL = (() => {
  const latest = Math.max(
    ...readdirSync(PROTOCOL_COMPAT_DIR)
      .filter((d) => /^v\d+$/.test(d))
      .map((d) => Number(d.slice(1))),
  );

  return JSON.parse(readFileSync(joinPath(PROTOCOL_COMPAT_DIR, `v${latest}`, 'control-plane-to-agent.json'), 'utf8'))
    .messages as Record<string, JsonSchemaObject>;
})();
const protocolViolations: string[] = [];

function checkN1Protocol(env: Envelope): void {
  const schema = N1_PROTOCOL[env.type];

  if (!schema) {
    protocolViolations.push(`${env.type}: unknown to N-1 agents`);

    return;
  }

  const payload = JSON.parse(Buffer.from(env.payload).toString('utf8')) as unknown;

  for (const issue of checkJsonSchema(schema, payload))
    protocolViolations.push(`${env.type}.${issue.path.join('.')}: ${issue.message}`);
}

// Valid-format WireGuard public keys (32 bytes, base64).
const WG_KEYS = [
  'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=',
  'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
  'HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=',
];

describe('control plane (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let n1Credentials: { caCertificatePem: string; certificatePem: string; privateKeyPem: string };
  let n2Credentials: { caCertificatePem: string; certificatePem: string; privateKeyPem: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test helper returns arbitrary JSON response bodies
  const api = async (
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<{ status: number; json: any; headers: Headers }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${API_KEY}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();

    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  };

  /** A simulated agent reports every desired state it gets as applied, like a healthy node (3.19 apply tracking). */
  const openAgent = (...args: Parameters<typeof openAgentStream>) => {
    const opened = openAgentStream(...args);

    opened.stream.on('data', (env: Envelope) => {
      checkN1Protocol(env);

      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok === true && decoded.message.type === 'desiredState' && !opened.stream.writableEnded)
        opened.stream.write(
          agentMessage('applyReport', { revision: decoded.message.payload.revision, status: 'applied', steps: [] }),
        );
    });

    return opened;
  };

  const join = async (nodeName: string, wgKey: string, token: string) => {
    const keys = await generateKeyPair();
    const res = await api(
      'POST',
      '/nodes/join',
      { token, nodeName, csrPem: await createCsr(keys, nodeName), hello: hello(nodeName, wgKey) },
      false,
    );

    return { res, keys };
  };

  const waitFor = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> => {
    const start = Date.now();

    for (;;) {
      const value = await fn();

      if (value !== undefined) return value;

      if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${fn.toString().slice(0, 300)}`);

      await new Promise((r) => setTimeout(r, 200));
    }
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('bootstraps the cluster with a CA, default resources and an intact audit chain', async () => {
    const summary = await api('GET', '/cluster');

    expect(summary.status).toBe(200);
    expect(summary.json).toMatchObject({ clusterId: 'it', nodes: { total: 0 } });
    expect(summary.json.caCertificate).toContain('BEGIN CERTIFICATE');

    const resources = await api('GET', '/resources');

    expect(resources.json.map((r: { kind: string }) => r.kind).sort()).toEqual(['Cluster', 'Site']);
    expect((await api('GET', '/cluster/audit/verify')).json).toMatchObject({ ok: true, checked: 1 });
  });

  it('rejects unauthenticated access and invalid join tokens', async () => {
    expect((await api('GET', '/nodes', undefined, false)).status).toBe(401);

    const { res } = await join('n0', WG_KEYS[0], `lwj_abcdefghijkl.${'A'.repeat(43)}`);

    expect(res.status).toBe(401);
  });

  it('joins nodes with single-use tokens, grows the control plane and streams desired state over mTLS', async () => {
    const tokenRes = await api('POST', '/join-tokens', { ttlMinutes: 10 });

    expect(tokenRes.status).toBe(201);

    const token: string = tokenRes.json.token;
    const first = await join('n1', WG_KEYS[0], token);

    expect(first.res.status).toBe(200);
    expect(first.res.json).toMatchObject({ clusterId: 'it', nodeName: 'n1' });
    n1Credentials = {
      caCertificatePem: first.res.json.caCertificatePem,
      certificatePem: first.res.json.certificatePem,
      privateKeyPem: first.keys.privateKeyPem,
    };

    // Single use.
    expect((await join('n9', WG_KEYS[1], token)).res.status).toBe(401);

    const secondToken = (await api('POST', '/join-tokens', {})).json.token;
    const second = await join('n2', WG_KEYS[1], secondToken);

    expect(second.res.status).toBe(200);
    n2Credentials = {
      caCertificatePem: second.res.json.caCertificatePem,
      certificatePem: second.res.json.certificatePem,
      privateKeyPem: second.keys.privateKeyPem,
    };

    const nodes = await api('GET', '/nodes');

    expect(nodes.json.map((n: { name: string }) => n.name)).toEqual(['n1', 'n2']);
    expect(nodes.json[0].overlayV4).toBe('10.93.0.1');
    expect(nodes.json[1].podSubnetV4).toBe('10.88.1.0/24');

    // Connect n1 with its issued certificate and receive its desired state.
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, {
      caCertificatePem: first.res.json.caCertificatePem,
      certificatePem: first.res.json.certificatePem,
      privateKeyPem: first.keys.privateKeyPem,
    });
    const received: DesiredState[] = [];

    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok === true && decoded.message.type === 'desiredState') received.push(decoded.message.payload);
    });
    stream.on('error', () => undefined);
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));

    const state = await waitFor(async () => received.find((s) => s.controlPlane.members.length === 2));

    // Two members without a witness: replicated, but no automatic failover (3.2).
    expect(state.controlPlane).toMatchObject({ role: 'member', automaticFailover: false });
    // Built-in agent-api / quorum policies create the n1↔n2 tunnel.
    expect(state.network.wireguard.map((l) => l.peer)).toEqual(['n2']);
    expect(state.network.wireguard[0].peerEndpoint).toMatch(/^n2\.example\.test:\d+$/);

    stream.write(agentMessage('applyReport', { revision: state.revision, status: 'applied', steps: [] }));
    await waitFor(async () =>
      (await api('GET', '/nodes/n1')).json.appliedRevision === state.revision ? true : undefined,
    );

    stream.end();
    client.close();
  });

  it('plans and applies a policy, showing the compiled per-layer effect', async () => {
    const documents = `
apiVersion: loadweaver.com/v1
kind: NodeGroup
metadata: { name: storage }
spec:
  selector: { names: [n1, n2] }
`;
    const plan = await api('POST', '/plans', { documents });

    expect(plan.status).toBe(201);
    expect(plan.json.changes).toEqual([
      expect.objectContaining({ action: 'create', kind: 'NodeGroup', name: 'storage' }),
    ]);

    const applied = await api('POST', `/plans/${plan.json.id}/apply`);

    expect(applied.json.status).toBe('applied');
    expect((await api('POST', `/plans/${plan.json.id}/apply`)).status).toBe(409);
    expect((await api('GET', '/resources/NodeGroup/storage')).json.spec).toMatchObject({ intraGroup: 'allow' });
  });

  it('refuses stale plans', async () => {
    const doc = (desc: string) =>
      `apiVersion: loadweaver.com/v1\nkind: Site\nmetadata: { name: ams1 }\nspec: { description: ${desc} }\n`;
    const a = await api('POST', '/plans', { documents: doc('a') });
    const b = await api('POST', '/plans', { documents: doc('b') });

    expect((await api('POST', `/plans/${a.json.id}/apply`)).status).toBe(200);
    expect((await api('POST', `/plans/${b.json.id}/apply`)).status).toBe(409);
  });

  it('plans and applies a compose deployment: placements, addresses, failure analysis, workload specs on the node', async () => {
    const documents = `
apiVersion: loadweaver.com/v1
kind: Project
metadata: { name: shop }
spec: {}
---
apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: store, project: shop }
spec:
  compose: |
    services:
      web:
        image: nginx@sha256:1111111111111111111111111111111111111111111111111111111111111111
        ports: ["8080:80"]
        x-loadweaver: { replicas: 2 }
      cache:
        image: redis@sha256:2222222222222222222222222222222222222222222222222222222222222222
`;
    const plan = await api('POST', '/plans', { documents });

    expect(plan.status).toBe(201);
    expect(
      plan.json.workloadChanges.map((c: { action: string; replica: string }) => `${c.action} ${c.replica}`).sort(),
    ).toEqual(['start shop/store/cache/0', 'start shop/store/web/0', 'start shop/store/web/1']);
    // One cache replica: losing its node is survivable by rescheduling, so no single point of failure is reported.
    expect(plan.json.failureAnalysis).toMatchObject({ findings: [] });
    expect(plan.json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'no resource requests; the project defaults apply' }),
      ]),
    );

    const applied = await api('POST', `/plans/${plan.json.id}/apply`, {});

    expect(applied.json.status).toBe('applied');

    const dataSource = app.get(DataSource);
    const placements: { id: string; node: string; addresses: string[] }[] = await dataSource.query(
      'SELECT id, node, addresses FROM lw_workload_placements ORDER BY id',
    );

    expect(placements.map((p) => p.id)).toEqual(['shop/store/cache/0', 'shop/store/web/0', 'shop/store/web/1']);
    expect(new Set(placements.filter((p) => p.id.startsWith('shop/store/web')).map((p) => p.node)).size).toBe(2);
    placements.forEach((p) => expect(p.addresses.length).toBeGreaterThan(0));

    const services = await dataSource.query('SELECT id, address_v4 FROM lw_service_addresses ORDER BY id');

    expect(services.map((r: { id: string }) => r.id)).toEqual(['shop/store/cache', 'shop/store/web']);

    // The compiled desired state of the node carries the workloads placed on it.
    const desired = await waitFor(async () => {
      const rows = await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`);
      const workloads = rows[0]?.state?.workloads ?? [];

      return workloads.length > 0 ? workloads : undefined;
    });

    expect(desired[0]).toMatchObject({ project: 'shop', deployment: 'store', dnsSearch: ['store.shop.lw', 'shop.lw'] });
  });

  it('rejects deployments that do not fit and compose errors', async () => {
    const tooBig = await api('POST', '/plans', {
      documents: `apiVersion: loadweaver.com/v1\nkind: Deployment\nmetadata: { name: huge, project: shop }\nspec:\n  compose: |\n    services:\n      x:\n        image: x\n        deploy: { resources: { reservations: { cpus: '64', memory: 512g } } }\n`,
    });

    expect(tooBig.status).toBe(400);
    expect(tooBig.json.issues[0].message).toContain('capacity');

    const broken = await api('POST', '/plans', {
      documents: `apiVersion: loadweaver.com/v1\nkind: Deployment\nmetadata: { name: broken, project: shop }\nspec:\n  compose: |\n    services:\n      x: { build: . }\n`,
    });

    expect(broken.status).toBe(400);
    expect(broken.json.issues[0].message).toContain('build is not supported');
  });

  it('applies a plan with unacknowledged pins only when the apply confirms them', async () => {
    const plan = await api('POST', '/plans', {
      documents: `apiVersion: loadweaver.com/v1\nkind: Deployment\nmetadata: { name: pinned, project: shop }\nspec:\n  compose: |\n    services:\n      x:\n        image: ghcr.io/acme/app@sha256:${'7'.repeat(64)}\n        container_name: fixed\n`,
    });

    expect(plan.status).toBe(201);
    expect(plan.json.warnings.some((w: { pin?: boolean }) => w.pin)).toBe(true);
    expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).status).toBe(409);
    expect((await api('POST', `/plans/${plan.json.id}/apply`, { confirm: 'yes' })).status).toBe(400);
    expect((await api('POST', `/plans/${plan.json.id}/apply`, { confirm: true })).json.status).toBe('applied');
  });

  it('stores secrets envelope-encrypted, pins their versions and delivers them only to the node running the workload', async () => {
    const set = await api('PUT', '/projects/shop/secrets/db-password', { value: 'hunter2' });

    expect(set.status).toBe(200);
    expect(set.json).toMatchObject({ project: 'shop', name: 'db-password', version: 1, usedBy: [], reserved: false });
    expect(set.headers.get('cache-control')).toBe('no-store');
    const listed = await api('GET', '/projects/shop/secrets');
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toBe('no-store');
    expect(listed.json.items).toContainEqual(set.json);
    for (const response of [set.json, listed.json]) {
      for (const forbidden of ['hunter2', 'fingerprint', 'ciphertext', 'wrappedKey'])
        expect(JSON.stringify(response)).not.toContain(forbidden);
    }

    const dataSource = app.get(DataSource);
    const [row] = await dataSource.query(`SELECT ciphertext FROM lw_secrets WHERE name = 'db-password'`);

    expect(Buffer.from(row.ciphertext).toString('latin1')).not.toContain('hunter2');

    const documents = `apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: store, project: shop }
spec:
  compose: |
    services:
      web:
        image: nginx@sha256:${'1'.repeat(64)}
        ports: ["8080:80"]
        x-loadweaver: { replicas: 2 }
      cache:
        image: redis@sha256:${'2'.repeat(64)}
      api:
        image: ghcr.io/acme/api@sha256:${'3'.repeat(64)}
        secrets: [db-password]
      db:
        image: postgres@sha256:${'4'.repeat(64)}
        volumes: [data:/var/lib/postgresql/data]
    volumes:
      data: { x-loadweaver: { size: 1g } }
    secrets:
      db-password: { external: true }
`;
    // n1 is long established; n2 joined but its agent never connected: it is still joining (M6 gate).
    await dataSource.query(`UPDATE lw_nodes SET joined_at = now() - interval '1 hour' WHERE name = 'n1'`);
    await dataSource.query(`UPDATE lw_nodes SET joined_at = now() WHERE name = 'n2'`);

    const plan = await api('POST', '/plans', { documents });
    const joiningNote = (p: { warnings: { message?: string }[] }) =>
      p.warnings.filter((w) => w.message?.includes('while it is joining')).map((w) => w.message);

    expect(plan.status).toBe(201);
    // The joining node gets no copy of the new volume; the plan says so.
    expect(joiningNote(plan.json)).toEqual([
      'volume data gets no copy on n2 (joining: agent not connected yet) while it is joining; plan again once the node is ready to add the copy',
    ]);
    expect(plan.json.deploymentStates['shop/store']).toEqual({
      images: {
        web: `nginx@sha256:${'1'.repeat(64)}`,
        cache: `redis@sha256:${'2'.repeat(64)}`,
        api: `ghcr.io/acme/api@sha256:${'3'.repeat(64)}`,
        db: `postgres@sha256:${'4'.repeat(64)}`,
      },
      secretVersions: { 'secret://shop/db-password': 1 },
    });
    expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');

    const usedBy = [{ kind: 'Deployment', project: 'shop', name: 'store', pinnedVersion: 1 }];
    const inUse = await api('DELETE', '/projects/shop/secrets/db-password');
    expect(inUse.status).toBe(409);
    expect(inUse.headers.get('cache-control')).toBe('no-store');
    expect(inUse.json).toEqual({ message: 'secret is in use; remove the references first', usedBy });
    expect((await api('GET', '/secrets?project=shop&q=DB&limit=1')).json.items[0].usedBy).toEqual(usedBy);

    const volumeRow = async () =>
      (
        await dataSource.query(
          `SELECT primary_node, sync_replicas FROM lw_volume_placements WHERE id = 'shop/store/data'`,
        )
      )[0] as { primary_node: string; sync_replicas: string[] };

    expect(await volumeRow()).toEqual({ primary_node: 'n1', sync_replicas: [] });

    // n2's agent connects and applies its desired state: ready, so the next plan adds the copy.
    const n2Agent = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n2Credentials);

    n2Agent.stream.on('error', () => undefined);
    n2Agent.stream.write(agentMessage('hello', hello('n2', WG_KEYS[1])));
    await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT n.connected, n.applied_revision, d.revision FROM lw_nodes n JOIN lw_node_desired_states d ON d.node_name = n.name WHERE n.name = 'n2'`,
      );

      return row?.connected && Number(row.applied_revision) >= Number(row.revision) ? true : undefined;
    });

    const again = await api('POST', '/plans', { documents });

    expect(again.status).toBe(201);
    expect(joiningNote(again.json)).toEqual([]);
    // The preview lists the copy the apply adds (M6 gate): no replica changes, one `copy` entry.
    expect(again.json.workloadChanges).toEqual([{ action: 'copy', volume: 'shop/store/data', to: 'n2', copy: 'sync' }]);
    expect((await api('POST', `/plans/${again.json.id}/apply`, {})).json.status).toBe('applied');
    expect(await volumeRow()).toEqual({ primary_node: 'n1', sync_replicas: ['n2'] });
    n2Agent.stream.end();
    n2Agent.client.close();
    // From here on both nodes count as long joined (the remaining cases don't model joining).
    await dataSource.query(`UPDATE lw_nodes SET joined_at = now() - interval '1 hour' WHERE name IN ('n1', 'n2')`);

    // The volume is placed with the database, encrypted with its own key, and assigned to its replica holders.
    const [volume] = await dataSource.query(
      `SELECT primary_node, sync_replicas, drbd_minor FROM lw_volume_placements WHERE id = 'shop/store/data'`,
    );
    const [db] = await dataSource.query(`SELECT node FROM lw_workload_placements WHERE id = 'shop/store/db/0'`);

    expect(volume.primary_node).toBe(db.node);
    expect(volume.sync_replicas).toEqual([db.node === 'n1' ? 'n2' : 'n1']);
    expect(
      (await dataSource.query(`SELECT count(*)::int AS n FROM lw_secrets WHERE name = 'lw-volume-store.data'`))[0].n,
    ).toBe(1);
    expect((await api('PUT', '/projects/shop/secrets/lw-admin-check', { value: 'x' })).status).toBe(200);
    expect((await api('DELETE', '/projects/shop/secrets/lw-admin-check')).status).toBe(204);

    const volumeState = await waitFor(async () => {
      const rows = await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = $1`, [db.node]);

      return rows[0]?.state?.volumes?.length ? rows[0].state.volumes : undefined;
    });

    expect(volumeState[0]).toMatchObject({
      dockerName: 'lw-vol-shop.store.data',
      primary: db.node,
      minor: volume.drbd_minor,
    });

    const [placement] = await dataSource.query(`SELECT node FROM lw_workload_placements WHERE id = 'shop/store/api/0'`);
    const nodeCredentials = { n1: n1Credentials, n2: n2Credentials } as Record<string, typeof n1Credentials>;
    const ask = async (node: string) => {
      const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, nodeCredentials[node]);
      const reply = new Promise<Envelope>((resolve) =>
        stream.on('data', (env: Envelope) => env.type !== 'desiredState' && resolve(env)),
      );

      stream.on('error', () => undefined);
      stream.write(agentMessage('secretRequest', { workload: 'shop/store/api/0', ref: 'secret://shop/db-password@1' }));

      const env = await reply;

      stream.end();
      client.close();

      return decodeControlPlaneMessage(env);
    };
    const own = await ask(placement.node);

    expect(
      own.ok === true &&
        own.message.type === 'secretValue' &&
        Buffer.from(own.message.payload.valueBase64, 'base64').toString(),
    ).toBe('hunter2');

    const other = await ask(placement.node === 'n1' ? 'n2' : 'n1');

    expect(other.ok === true && other.message.type).toBe('error');
  });

  it('steers sources with per-source egress settings older agents cannot apply to nodes with egress-policies', async () => {
    const dataSource = app.get(DataSource);
    const features = async (n1: string[], n2: string[]) => {
      await dataSource.query(`UPDATE lw_nodes SET protocol_features = $1::jsonb WHERE name = 'n1'`, [
        JSON.stringify(n1),
      ]);
      await dataSource.query(`UPDATE lw_nodes SET protocol_features = $1::jsonb WHERE name = 'n2'`, [
        JSON.stringify(n2),
      ]);
    };
    // The simulated agents aren't connected here: keep both nodes reachable for the scheduler.
    const plan = async (body: Record<string, unknown>) => {
      await dataSource.query(`UPDATE lw_nodes SET last_seen_at = now() WHERE name IN ('n1', 'n2')`);

      return api('POST', '/plans', body);
    };
    const policy = `apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: ci-egress, project: shop }
spec:
  from: [{ selector: { matchLabels: { role: ci } } }]
  egressMode: enforce
  denyUrlPatterns: ['\\.exe$']
`;
    const runner = (placement = '') => `apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: steer, project: shop }
spec:
  compose: |
    services:
      runner:
        image: alpine@sha256:${'6'.repeat(64)}
        labels: { role: ci }${placement ? `\n        x-loadweaver: { placement: { selector: { names: [${placement}] } } }` : ''}
`;
    const node = async () =>
      (
        (await dataSource.query(`SELECT node FROM lw_workload_placements WHERE id = 'shop/steer/runner/0'`))[0] as
          | { node: string }
          | undefined
      )?.node;

    try {
      // n1's agent lacks `egress-policies` (an older agent), n2's has it: the URL deny patterns put the replica on n2.
      await features([], ['egress-policies']);

      const placed = await plan({ documents: `${policy}---\n${runner()}` });

      expect(placed.status).toBe(201);
      expect(placed.json.workloadChanges).toEqual([
        expect.objectContaining({ action: 'start', replica: 'shop/steer/runner/0', to: 'n2' }),
      ]);
      expect((await api('POST', `/plans/${placed.json.id}/apply`, {})).json.status).toBe('applied');
      expect(await node()).toBe('n2');

      // Only n1 is eligible: refused, naming the feature and the setting.
      const refused = await plan({ documents: runner('n1') });

      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.json.issues)).toMatch(
        /protocol feature egress-policies \(needed for per-source egress settings older agents can't apply: denyUrlPatterns\); update the node agents/,
      );

      // A replica already on n1 (placed before the policy) stays there; the plan warns to update n1's agent. A move
      // n2 → n1 would be a migration the simulated agents never finish, so remove it (it drains) and place it anew.
      const removed = await plan({
        documents: '',
        delete: [
          { kind: 'Deployment', project: 'shop', name: 'steer' },
          { kind: 'Policy', project: 'shop', name: 'ci-egress' },
        ],
      });

      expect((await api('POST', `/plans/${removed.json.id}/apply`, { confirm: true })).json.status).toBe('applied');
      await waitFor(async () => ((await node()) === undefined ? true : undefined), 30_000);

      const onN1 = await plan({ documents: runner('n1') });

      expect(onN1.status).toBe(201);
      expect((await api('POST', `/plans/${onN1.json.id}/apply`, { confirm: true })).json).toMatchObject({
        status: 'applied',
      });
      expect(await node()).toBe('n1');

      const kept = await plan({ documents: policy });

      expect(kept.status).toBe(201);
      expect(kept.json.workloadChanges).toEqual([]);
      expect(kept.json.warnings).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          path: 'services.runner',
          message: expect.stringMatching(
            /^replica shop\/steer\/runner\/0 stays on node n1, whose agent lacks the egress-policies protocol feature .*update the agent on n1/,
          ),
        }),
      );
    } finally {
      await features([], []);

      // Cleanup must not mask a failure above: remove only what exists.
      const existing = (
        await dataSource.query(
          `SELECT kind, name FROM lw_resources WHERE project = 'shop' AND ((kind = 'Deployment' AND name = 'steer') OR (kind = 'Policy' AND name = 'ci-egress'))`,
        )
      ).map((r: { kind: string; name: string }) => ({ kind: r.kind, project: 'shop', name: r.name }));

      if (existing.length > 0) {
        const removal = await plan({ documents: '', delete: existing });

        expect((await api('POST', `/plans/${removal.json.id}/apply`, { confirm: true })).json.status).toBe('applied');
      }

      // Removed replicas drain first (two-phase removal); the later cases expect it gone.
      await waitFor(async () => ((await node()) === undefined ? true : undefined), 30_000);
    }
  });

  it('pushes a member the same stored Postgres certificate on every push and renews it on the timer at two thirds of its lifetime', async () => {
    const dataSource = app.get(DataSource);
    // A current agent (protocol features incl. `postgres-tls`) on the member n1; not the N-1 helper.
    const { client, stream } = openAgentStream(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);
    const received: DesiredState[] = [];

    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok !== true || decoded.message.type !== 'desiredState') return;

      received.push(decoded.message.payload);
      stream.write(
        agentMessage('applyReport', { revision: decoded.message.payload.revision, status: 'applied', steps: [] }),
      );
    });
    stream.write(
      agentMessage('hello', {
        ...hello('n1', WG_KEYS[0]),
        protocolVersion: PROTOCOL_VERSION,
        features: [...SUPPORTED_PROTOCOL_FEATURES],
      }),
    );

    try {
      // Other pushes (e.g. a recompile after a drained replica of an earlier case) may arrive in between: `accept`
      // picks the push the step waits for.
      const tlsAfter = async (
        revision: number,
        accept: (tls: NonNullable<DesiredState['controlPlane']['postgresTls']>) => boolean = () => true,
      ) =>
        await waitFor(async () => {
          const state = received.find(
            (s) => s.revision > revision && s.controlPlane.postgresTls && accept(s.controlPlane.postgresTls),
          );

          return state?.controlPlane.postgresTls
            ? { revision: state.revision, tls: state.controlPlane.postgresTls }
            : undefined;
        });
      const first = await tlsAfter(0);

      // Pushed again (new revision, same state): byte-identical certificate and key, no new key per push.
      await app.get(NetworkStateService).repush(['n1'], 'integration test');

      const second = await tlsAfter(first.revision);

      expect(second.tls).toEqual(first.tls);

      const stored = async () =>
        (
          await dataSource.query(
            `SELECT serial, certificate_pem, private_key, not_before, not_after FROM lw_postgres_certificates WHERE node_name = 'n1'`,
          )
        )[0] as { serial: string; certificate_pem: string; private_key: string; not_before: Date; not_after: Date };
      const row = await stored();

      expect(row.certificate_pem).toBe(first.tls.certificatePem);
      // The private key is stored encrypted.
      expect(row.private_key).not.toContain('PRIVATE KEY');

      const renewal = app.get(PostgresCertificateRenewalService);

      // Fresh: nothing due.
      expect(await renewal.tick()).toEqual([]);

      // Back-dated past two thirds of its lifetime: the timer re-pushes n1, the push renews the certificate.
      await dataSource.query(
        `UPDATE lw_postgres_certificates SET not_before = now() - interval '300 days', not_after = now() + interval '65 days' WHERE node_name = 'n1'`,
      );
      expect(await renewal.tick()).toEqual(['n1']);

      const renewed = await tlsAfter(second.revision, (tls) => tls.certificatePem !== first.tls.certificatePem);

      expect(renewed.tls.certificatePem).not.toBe(first.tls.certificatePem);
      expect(renewed.tls.privateKeyPem).not.toBe(first.tls.privateKeyPem);

      const next = await stored();

      expect(next.serial).not.toBe(row.serial);
      expect(next.certificate_pem).toBe(renewed.tls.certificatePem);
      expect(new Date(next.not_after).getTime()).toBeGreaterThan(Date.now() + 300 * 24 * 3600_000);
      expect(await renewal.tick()).toEqual([]);
    } finally {
      stream.end();
      client.close();
    }

    // Back to a pre-versioning hello, as the remaining cases expect of n1 (N-1 agents).
    const legacy = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);

    legacy.stream.on('error', () => undefined);
    legacy.stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));
    await waitFor(async () => {
      const [node] = await dataSource.query(`SELECT protocol_version FROM lw_nodes WHERE name = 'n1'`);

      return Number(node.protocol_version) === 0 ? true : undefined;
    });
    legacy.stream.end();
    legacy.client.close();
  });

  it("unseals the master key from the members' shares without ever storing them in plaintext", async () => {
    const masterKey = app.get(MasterKeyService);
    const description = await masterKey.describe();

    expect(description).toMatchObject({ threshold: 2, holders: ['n1', 'n2'] });

    // Simulate both member agents: decrypt the own share, re-seal it for the requesting replica.
    const agents = ['n1', 'n2'].map((node) => {
      const { client, stream } = openAgent(
        process.env.LOADWEAVER_GRPC_ENDPOINTS as string,
        node === 'n1' ? n1Credentials : n2Credentials,
      );

      stream.on('error', () => undefined);
      stream.on('data', (env: Envelope) => {
        const decoded = decodeControlPlaneMessage(env);

        if (decoded.ok !== true || decoded.message.type !== 'unsealShareRequest') return;

        const request = decoded.message.payload;
        const share = openSealed(
          SEAL[node].privateKey,
          Buffer.from(request.encryptedShare, 'base64'),
          `master-key/${request.keyId}/${node}`,
        );

        stream.write(
          agentMessage('unsealShare', {
            requestId: request.requestId,
            keyId: request.keyId,
            sealedShare: sealTo(request.requesterPublicKey, share, `unseal/${request.requestId}`).toString('base64'),
          }),
        );
      });

      return { client, stream };
    });

    await new Promise((r) => setTimeout(r, 300));
    (masterKey as unknown as { key: unknown }).key = null;

    const key = await masterKey.unseal();

    expect(key.id).toBe(description?.id);
    expect((await app.get(DataSource).query('SELECT count(*)::int AS n FROM lw_unseal_requests'))[0].n).toBe(0);
    agents.forEach(({ client, stream }) => {
      stream.end();
      client.close();
    });
  });

  it('moves the master key into an external KMS (Vault transit) and back, re-wrapping every secret', async () => {
    const masterKey = app.get(MasterKeyService);
    const dataSource = app.get(DataSource);
    const vault = `lw-it-vault-${process.pid}`;
    const agents = ['n1', 'n2'].map((node) => {
      const { client, stream } = openAgent(
        process.env.LOADWEAVER_GRPC_ENDPOINTS as string,
        node === 'n1' ? n1Credentials : n2Credentials,
      );

      stream.on('error', () => undefined);
      stream.on('data', (env: Envelope) => {
        const decoded = decodeControlPlaneMessage(env);

        if (decoded.ok !== true || decoded.message.type !== 'unsealShareRequest') return;

        const request = decoded.message.payload;
        const share = openSealed(
          SEAL[node].privateKey,
          Buffer.from(request.encryptedShare, 'base64'),
          `master-key/${request.keyId}/${node}`,
        );

        stream.write(
          agentMessage('unsealShare', {
            requestId: request.requestId,
            keyId: request.keyId,
            sealedShare: sealTo(request.requesterPublicKey, share, `unseal/${request.requestId}`).toString('base64'),
          }),
        );
      });

      return { client, stream };
    });
    const keyIds = async () => [
      ...new Set((await dataSource.query('SELECT key_id FROM lw_secrets')).map((r: { key_id: string }) => r.key_id)),
    ];

    try {
      docker([
        'run',
        '-d',
        '--name',
        vault,
        '--cap-add',
        'IPC_LOCK',
        '-e',
        'VAULT_DEV_ROOT_TOKEN_ID=it-root',
        '-p',
        '127.0.0.1::8200',
        VAULT_IMAGE,
      ]);

      const address = `http://127.0.0.1:${docker(['port', vault, '8200/tcp']).split('\n')[0].split(':').pop()}`;
      const vaultApi = (path: string, body: unknown) =>
        fetch(`${address}/v1/${path}`, {
          method: 'POST',
          headers: { 'X-Vault-Token': 'it-root' },
          body: JSON.stringify(body),
        });

      await waitFor(
        async () =>
          (await vaultApi('sys/mounts/transit', { type: 'transit' }).catch(() => null))?.ok ? true : undefined,
        30_000,
      );
      expect((await vaultApi('transit/keys/loadweaver', {})).ok).toBe(true);

      // Unsealed from the shares first.
      await new Promise((r) => setTimeout(r, 300));
      (masterKey as unknown as { key: unknown }).key = null;

      const shamir = await masterKey.current();

      expect(await keyIds()).toEqual([shamir.id]);

      Object.assign(process.env, {
        LOADWEAVER_MASTER_KEY_KMS: 'vault-transit',
        VAULT_ADDR: address,
        VAULT_TOKEN: 'it-root',
      });
      expect(await masterKey.reshare()).toBe(true);

      const held = await masterKey.describe();

      expect(held).toMatchObject({
        threshold: 0,
        holders: [],
        kms: { provider: 'vault-transit', keyRef: `${address}/transit/loadweaver` },
      });
      expect(await keyIds()).toEqual([held?.id]);
      // Only Vault's ciphertext is stored.
      expect((await dataSource.query('SELECT kms FROM lw_master_keys WHERE active'))[0].kms.wrapped).toMatch(
        /^vault:v1:/,
      );

      // A fresh replica unseals through Vault alone.
      (masterKey as unknown as { key: unknown }).key = null;
      expect((await masterKey.current()).id).toBe(held?.id);

      // Back to shares on the members.
      delete process.env['LOADWEAVER_MASTER_KEY_KMS'];
      expect(await masterKey.reshare()).toBe(true);
      expect(await masterKey.describe()).toMatchObject({ threshold: 2, holders: ['n1', 'n2'], kms: null });
      expect(await keyIds()).toEqual([(await masterKey.describe())?.id]);
    } finally {
      for (const key of ['LOADWEAVER_MASTER_KEY_KMS', 'VAULT_ADDR', 'VAULT_TOKEN']) delete process.env[key];

      agents.forEach(({ client, stream }) => {
        stream.end();
        client.close();
      });
      removeContainers([vault]);
    }
  });

  it('runs one-off jobs once per apply: before jobs gate the services, after jobs wait for them', async () => {
    const dataSource = app.get(DataSource);
    const controller = app.get(WorkloadControllerService);
    const documents = `apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: jobs, project: shop }
spec:
  compose: |
    services:
      app:
        image: ghcr.io/acme/app@sha256:${'5'.repeat(64)}
      migrate:
        image: ghcr.io/acme/app@sha256:${'5'.repeat(64)}
        command: ["migrate"]
        x-loadweaver: { job: { phase: before } }
      notify:
        image: ghcr.io/acme/app@sha256:${'5'.repeat(64)}
        x-loadweaver: { job: { phase: after } }
`;
    const plan = await api('POST', '/plans', { documents });

    expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');

    const gates = async () =>
      Object.fromEntries(
        (
          await dataSource.query(`SELECT service, gate, node FROM lw_workload_placements WHERE deployment = 'jobs'`)
        ).map((r: { service: string; gate: string | null; node: string }) => [r.service, r]),
      );
    const before = await gates();

    expect(before).toMatchObject({
      app: { gate: 'before-jobs' },
      migrate: { gate: null },
      notify: { gate: 'after-services' },
    });

    // The app and the after job are not part of any node's desired state yet; the before job is.
    const workloadsOf = async (node: string) =>
      (
        await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = $1`, [node])
      )[0]?.state?.workloads?.map((w: { id: string }) => w.id) ?? [];

    await waitFor(async () =>
      (await workloadsOf(before.migrate.node)).includes('shop/jobs/migrate/0') ? true : undefined,
    );
    expect(
      [...(await workloadsOf('n1')), ...(await workloadsOf('n2'))].some(
        (id: string) => id.startsWith('shop/jobs/app') || id.startsWith('shop/jobs/notify'),
      ),
    ).toBe(false);

    const send = async (node: string, workloads: { id: string; state: 'exited' | 'running' }[]) => {
      const { client, stream } = openAgent(
        process.env.LOADWEAVER_GRPC_ENDPOINTS as string,
        node === 'n1' ? n1Credentials : n2Credentials,
      );

      stream.on('error', () => undefined);
      stream.on('data', () => undefined);
      stream.write(
        agentMessage('workloadStatus', {
          workloads: workloads.map((w) => ({ ...w, specHash: 'x', ...(w.state === 'exited' ? { exitCode: 0 } : {}) })),
        }),
      );
      await new Promise((r) => setTimeout(r, 300));
      stream.end();
      client.close();
    };

    await send(before.migrate.node, [{ id: 'shop/jobs/migrate/0', state: 'exited' }]);
    expect(await controller.tick()).toBe(true);
    expect((await gates()).app.gate).toBeNull();
    expect((await gates()).notify.gate).toBe('after-services');

    await send(before.app.node, [{ id: 'shop/jobs/app/0', state: 'running' }]);
    await controller.tick();
    expect((await gates()).notify.gate).toBeNull();
  });

  it('drains a node: blue / green and short-stop migrations, re-replicated volumes, and only then it may leave', async () => {
    const dataSource = app.get(DataSource);
    const controller = app.get(WorkloadControllerService);
    const placementsOn = async (node: string) =>
      (await dataSource.query(`SELECT id FROM lw_workload_placements WHERE node = $1 ORDER BY id`, [node])).map(
        (r: { id: string }) => r.id,
      );
    const agents = (['n1', 'n2'] as const).map((node) => {
      const { client, stream } = openAgent(
        process.env.LOADWEAVER_GRPC_ENDPOINTS as string,
        node === 'n1' ? n1Credentials : n2Credentials,
      );

      stream.on('error', () => undefined);
      stream.on('data', () => undefined);
      stream.write(agentMessage('hello', hello(node, node === 'n1' ? WG_KEYS[0] : WG_KEYS[1])));

      return { node, client, stream };
    });
    const report = (node: 'n1' | 'n2', ids: string[]) =>
      agents
        .find((a) => a.node === node)
        ?.stream.write(
          agentMessage('workloadStatus', {
            workloads: ids.map((id) => ({ id, state: 'running' as const, specHash: 'x' })),
          }),
        );

    expect((await api('POST', '/nodes/n2/leave')).status).toBe(409);
    expect((await api('POST', '/nodes/n2/drain')).status).toBe(200);

    const onN2 = await placementsOn('n2');

    expect(onN2.length).toBeGreaterThan(0);
    // Workloads and volume copies are still on n2: leaving now would lose data (3.2).
    expect((await api('POST', '/nodes/n2/leave')).status).toBe(409);

    expect(await controller.tick()).toBe(true);

    const migrations: { id: string; target_node: string; migration: { method: string; phase: string } }[] =
      await dataSource.query(
        `SELECT id, target_node, migration FROM lw_workload_placements WHERE migration IS NOT NULL ORDER BY id`,
      );

    expect(migrations.map((m) => m.id)).toEqual(onN2);
    migrations.forEach((m) => expect(m.target_node).toBe('n1'));

    const db = migrations.find((m) => m.id === 'shop/store/db/0');

    if (db) {
      expect(db.migration).toMatchObject({ method: 'short-stop', phase: 'stopping' });
      expect(
        (await dataSource.query(`SELECT pending_primary FROM lw_volume_placements WHERE id = 'shop/store/data'`))[0]
          .pending_primary,
      ).toBe('n1');
    }

    // The targets report their new copies running; n2 reports that its containers are gone.
    await new Promise((r) => setTimeout(r, 50));
    report('n1', [...(await placementsOn('n1')), ...migrations.map((m) => m.id)]);
    report('n2', []);
    await waitFor(async () => {
      const [{ n }] = await dataSource.query(
        `SELECT count(*)::int AS n FROM lw_workload_placements WHERE status ? 'n2' AND id = ANY($1)`,
        [onN2],
      );

      return n === onN2.length ? true : undefined;
    });

    for (
      let i = 0;
      i < 4 &&
      ((await placementsOn('n2')).length > 0 ||
        (
          await dataSource.query(
            `SELECT 1 FROM lw_volume_placements WHERE sync_replicas ? 'n2' OR remote_replicas ? 'n2' OR primary_node = 'n2'`,
          )
        ).length > 0);
      i++
    ) {
      await controller.tick();
    }

    expect(await placementsOn('n2')).toEqual([]);
    expect(
      (
        await dataSource.query(
          `SELECT primary_node, sync_replicas FROM lw_volume_placements WHERE id = 'shop/store/data'`,
        )
      )[0],
    ).toEqual({ primary_node: 'n1', sync_replicas: [] });
    agents.forEach(({ client, stream }) => {
      stream.end();
      client.close();
    });
  });

  it('runs cron jobs exactly once per due time, with retries, concurrency policy, timeouts and a run history', async () => {
    const dataSource = app.get(DataSource);
    const cron = app.get(CronControllerService);
    const documents = `apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: cron, project: shop }
spec:
  compose: |
    services:
      report:
        image: ghcr.io/acme/app@sha256:${'6'.repeat(64)}
        command: ["report"]
        x-loadweaver: { cron: { schedule: '*/5 * * * *', timezone: Europe/Berlin, concurrency: forbid, retries: 1, timeout: 1h } }
`;
    const plan = await api('POST', '/plans', { documents });

    expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');
    // Cron jobs are not placed by plans; their runs are.
    expect(await dataSource.query(`SELECT id FROM lw_workload_placements WHERE deployment = 'cron'`)).toEqual([]);

    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);

    stream.on('error', () => undefined);
    stream.on('data', () => undefined);
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));

    const report = async (id: string, state: 'exited' | 'failed', exitCode: number) => {
      stream.write(agentMessage('workloadStatus', { workloads: [{ id, state, exitCode, specHash: 'x' }] }));
      await waitFor(async () =>
        (await dataSource.query(`SELECT status FROM lw_workload_placements WHERE id = $1`, [id]))[0]?.status?.n1
          ?.state === state
          ? true
          : undefined,
      );
    };
    const runs = async () =>
      (await api('GET', '/projects/shop/cron-runs?job=cron/report')).json.map(
        (r: {
          attempt: number;
          state: string;
          exitCode: number | null;
          workload: string | null;
          node: string | null;
          scheduledAt: string;
        }) => ({
          attempt: r.attempt,
          state: r.state,
          exitCode: r.exitCode,
          workload: r.workload,
          node: r.node,
          scheduledAt: r.scheduledAt,
        }),
      );
    // A clock two hours back (every run start lies in the past of the agents' reports), one minute after a due time.
    const base = Math.floor((Date.now() - 2 * 3_600_000) / 300_000) * 300_000 + 60_000;
    const at = (minutes: number) => base + minutes * 60_000;

    // A new cron job waits for its next due time.
    expect(await cron.tick(at(0))).toBe(false);
    expect(await runs()).toEqual([]);

    // Two leaders racing for the same due time: exactly one run.
    await Promise.all([cron.tick(at(5)), cron.tick(at(5))]);

    const first = await runs();

    expect(first).toEqual([
      {
        attempt: 0,
        state: 'running',
        exitCode: null,
        workload: 'shop/cron/report/1',
        node: expect.any(String),
        scheduledAt: new Date(at(4)).toISOString(),
      },
    ]);
    expect(first[0].node).toBe('n1'); // n2 is draining

    await waitFor(async () =>
      (
        await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`)
      )[0]?.state?.workloads?.some(
        (w: { id: string; kind: string; restart: string }) =>
          w.id === 'shop/cron/report/1' && w.kind === 'cron' && w.restart === 'no',
      )
        ? true
        : undefined,
    );

    // A failed run is retried once (retries: 1); the retry succeeds.
    await report('shop/cron/report/1', 'failed', 3);
    await cron.tick(at(5.2));
    await report('shop/cron/report/2', 'exited', 0);
    await cron.tick(at(5.4));
    expect(
      (await runs()).map((r: { attempt: number; state: string; exitCode: number | null }) => [
        r.attempt,
        r.state,
        r.exitCode,
      ]),
    ).toEqual([
      [1, 'succeeded', 0],
      [0, 'failed', 3],
    ]);

    // The next run starts; while it runs, the following due time is skipped (concurrency: forbid).
    await cron.tick(at(10));
    await cron.tick(at(15));
    // An hour later it timed out: the container is stopped and retried once; the due time meanwhile is skipped.
    await cron.tick(at(75));

    const later = await runs();

    expect(
      later
        .slice(0, 5)
        .map((r: { attempt: number; state: string; workload: string | null }) => [r.attempt, r.state, r.workload]),
    ).toEqual([
      [0, 'skipped', null],
      [1, 'running', 'shop/cron/report/4'],
      [0, 'skipped', null],
      [0, 'timed-out', 'shop/cron/report/3'],
      [1, 'succeeded', 'shop/cron/report/2'],
    ]);
    // Only the running retry and no finished or stopped run of earlier sequences remain placed.
    expect(
      (await dataSource.query(`SELECT id FROM lw_workload_placements WHERE deployment = 'cron' ORDER BY id`)).map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual(['shop/cron/report/4']);

    const failures = await dataSource.query(
      `SELECT details FROM lw_audit_events WHERE action = 'cron.run-failed' ORDER BY seq`,
    );

    expect(failures.map((f: { details: { state: string } }) => f.details.state)).toEqual(['failed', 'timed-out']);
    expect((await api('GET', '/projects/shop/cron-runs?job=../x')).status).toBe(400);

    stream.end();
    client.close();
  });

  it('forms the object store on the members and moves it to a new generation when the replication factor grows', async () => {
    const dataSource = app.get(DataSource);
    const controller = app.get(ObjectStoreControllerService);
    const network = `lw-it-overlay-${process.pid}`;
    const containers: string[] = [];
    const endpoints = new Map<string, GarageContainer>();
    const secrets = (generation: number) => objectStoreSecrets(process.env.ENCRYPTION_KEY as string, generation);
    const generation = async (g: number) =>
      (
        await dataSource.query(
          `SELECT state, holders, replication_factor, copy FROM lw_object_store_generations WHERE generation = $1`,
          [g],
        )
      )[0];
    const desired = async (node: string) =>
      (await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = $1`, [node]))[0]?.state;
    const garage = (g: number, node: string, rf: number, ip?: string) => {
      const ports = objectStorePorts(g);
      const container = startGarage({
        name: `lw-it-garage-${process.pid}-g${g}-${node}`,
        replicationFactor: rf,
        ports,
        rpcSecret: secrets(g).rpcSecret,
        adminToken: secrets(g).adminToken,
        rpcPublicAddress: ip ?? '127.0.0.1',
        ...(ip ? { network: { name: network, ip } } : {}),
      });

      containers.push(container.name);
      endpoints.set(`${node}:${ports.admin}`, container);
      endpoints.set(`${node}:${ports.s3}`, container);

      return container;
    };

    // The controller reaches Garage over the overlay; here through the containers' published ports.
    Object.assign(controller, {
      endpoint: (node: { name: string }, port: number) => {
        const container = endpoints.get(`${node.name}:${port}`);

        if (!container) throw new Error(`no garage for ${node.name}:${port}`);

        return port === objectStorePorts(1).admin || port === objectStorePorts(2).admin
          ? container.adminUrl
          : container.s3Url;
      },
    });

    try {
      const t0 = Date.now();

      // Generation 1: one member (n2 is draining), replication factor 1.
      expect(await controller.tick(t0)).toBe('create');
      expect(await generation(1)).toMatchObject({ state: 'provisioning', holders: ['n1'], replication_factor: 1 });
      await waitFor(async () =>
        (await desired('n1'))?.objectStore?.generations?.[0]?.generation === 1 ? true : undefined,
      );
      // Secrets are injected at push time only.
      expect((await desired('n1')).objectStore.generations[0].rpcSecret).toBeUndefined();

      garage(1, 'n1', 1);
      await waitFor(async () => ((await controller.tick(t0)) === 'idle' ? true : undefined), 30_000);
      expect((await generation(1)).state).toBe('active');

      const state = await waitFor(async () => {
        const s = await desired('n1');

        return s?.registry && s?.registryClient ? s : undefined;
      });

      expect(state.registry).toMatchObject({
        generation: 1,
        bucket: REGISTRY_BUCKET,
        privatePort: 5000,
        readOnly: false,
        s3: { address: '10.93.0.1', port: 3910 },
      });
      expect(state.registry.mirrors[0]).toEqual({
        host: 'docker.io',
        remoteUrl: 'https://registry-1.docker.io',
        port: 5001,
      });
      expect(state.registryClient).toMatchObject({
        routerPort: 7479,
        endpoints: ['10.93.0.1'],
        privateHost: 'registry.lw',
      });

      // A blob the registry stored in generation 1.
      const s3v1 = garageS3Client(
        endpoints.get('n1:3910')?.s3Url as string,
        secrets(1).accessKeyId,
        secrets(1).secretAccessKey,
      );

      await s3v1.send(
        new PutObjectCommand({
          Bucket: REGISTRY_BUCKET,
          Key: 'docker/registry/v2/blobs/sha256/ab/abc/data',
          Body: 'layer-bytes',
        }),
      );

      // Control-plane files (reports) in the files bucket, through the shared file storage on Garage.
      const files = app.get(FileStorageService);
      const withGarage = async <T>(fn: () => Promise<T>): Promise<T> => {
        process.env.FILE_STORAGE_PROVIDER = 'garage';

        try {
          return await fn();
        } finally {
          process.env.FILE_STORAGE_PROVIDER = 'local';
        }
      };

      await withGarage(() =>
        files.writeFile(
          FileStorageScope.loadweaverReports,
          'cluster/2026/09/report.html',
          Buffer.from('<h1>September</h1>'),
        ),
      );
      // The registry's key can't read them.
      await expect(
        s3v1.send(new GetObjectCommand({ Bucket: 'lw-files', Key: 'loadweaver/reports/cluster/2026/09/report.html' })),
      ).rejects.toThrow();

      const TAG = 'docker/registry/v2/repositories/shop/app/_manifests/tags/latest/current/link';
      const OLD_MANIFEST = 'docker/registry/v2/repositories/shop/app/_manifests/revisions/sha256/aa/link';

      await s3v1.send(new PutObjectCommand({ Bucket: REGISTRY_BUCKET, Key: TAG, Body: `sha256:${'a'.repeat(64)}` }));
      await s3v1.send(
        new PutObjectCommand({ Bucket: REGISTRY_BUCKET, Key: OLD_MANIFEST, Body: `sha256:${'a'.repeat(64)}` }),
      );

      // Two more nodes make three members: replication factor 3 needs a new generation.
      for (const name of ['n3', 'n4']) {
        const token = (await api('POST', '/join-tokens', {})).json.token;

        expect((await join(name, randomBytes(32).toString('base64'), token)).res.status).toBe(200);
      }

      await waitFor(async () =>
        (await dataSource.query(`SELECT name FROM lw_nodes WHERE control_plane ORDER BY name`))
          .map((r: { name: string }) => r.name)
          .join(',') === 'n1,n3,n4'
          ? true
          : undefined,
      );
      expect(await controller.tick(t0)).toBe('observe');
      // Not before the membership was stable for a while.
      expect(await controller.tick(t0 + 60_000)).toBe('idle');
      expect(await controller.tick(t0 + 6 * 60_000)).toBe('create');
      expect(await generation(2)).toMatchObject({
        state: 'provisioning',
        holders: ['n1', 'n3', 'n4'],
        replication_factor: 3,
      });

      docker(['network', 'create', '--subnet', '10.93.0.0/24', '--gateway', '10.93.0.254', network]);
      garage(2, 'n1', 3, '10.93.0.1');
      garage(2, 'n3', 3, '10.93.0.3');
      garage(2, 'n4', 3, '10.93.0.4');

      const t1 = t0 + 7 * 60_000;

      await waitFor(
        async () => ((await generation(2)).state === 'copying' ? true : (await controller.tick(t1), undefined)),
        60_000,
      );
      // Live pass, then the registries go read-only for the final pass.
      expect(await controller.tick(t1)).toBe('copy');
      expect((await generation(2)).copy).toMatchObject({ phase: 'final' });
      // Before the registries went read-only: the tag moved (same size) and an old manifest was deleted.
      await s3v1.send(new PutObjectCommand({ Bucket: REGISTRY_BUCKET, Key: TAG, Body: `sha256:${'b'.repeat(64)}` }));
      await s3v1.send(new DeleteObjectCommand({ Bucket: REGISTRY_BUCKET, Key: OLD_MANIFEST }));
      await waitFor(async () => ((await desired('n1'))?.registry?.readOnly === true ? true : undefined));
      expect(await controller.tick(t1 + 1000)).toBe('copy');
      expect((await generation(2)).state).toBe('copying');
      expect(await controller.tick(t1 + 31_000)).toBe('copy');
      expect((await generation(2)).copy).toMatchObject({ phase: 'sweep' });
      expect(await controller.tick(t1 + 32_000)).toBe('copy');
      expect((await generation(2)).state).toBe('active');
      expect((await generation(1)).state).toBe('retiring');

      const s3v2 = garageS3Client(
        endpoints.get('n1:3900')?.s3Url as string,
        secrets(2).accessKeyId,
        secrets(2).secretAccessKey,
      );
      const copied = await s3v2.send(
        new GetObjectCommand({ Bucket: REGISTRY_BUCKET, Key: 'docker/registry/v2/blobs/sha256/ab/abc/data' }),
      );

      expect(await copied.Body?.transformToString()).toBe('layer-bytes');

      const tag = await s3v2.send(new GetObjectCommand({ Bucket: REGISTRY_BUCKET, Key: TAG }));

      expect(await tag.Body?.transformToString()).toBe(`sha256:${'b'.repeat(64)}`);
      // The files moved with the generation.
      expect(
        (
          await withGarage(() => files.readFile(FileStorageScope.loadweaverReports, 'cluster/2026/09/report.html'))
        ).toString(),
      ).toBe('<h1>September</h1>');
      await expect(s3v2.send(new GetObjectCommand({ Bucket: REGISTRY_BUCKET, Key: OLD_MANIFEST }))).rejects.toThrow();
      await waitFor(async () => {
        const s = await desired('n3');

        return s?.registry?.generation === 2 && s.registry.readOnly === false ? true : undefined;
      });

      // The old generation goes away after the grace period.
      expect(await controller.tick(t1 + 32_000 + 2 * 60_000)).toBe('retire');
      await waitFor(async () =>
        (await desired('n1'))?.objectStore?.generations?.map((g: { generation: number }) => g.generation).join(',') ===
        '2'
          ? true
          : undefined,
      );
      s3v1.destroy();
      s3v2.destroy();
    } finally {
      removeContainers(containers);

      try {
        docker(['network', 'rm', network]);
      } catch {
        // not created
      }
    }
  });

  it('issues registry tokens for docker login: Basic credentials, project namespaces, chained to the cluster CA', async () => {
    const tokenFor = async (query: string, authorization?: string) => {
      const res = await fetch(`${baseUrl}/api/registry/token?${query}`, {
        headers: authorization ? { authorization } : {},
      });

      return { status: res.status, json: res.status === 200 ? await res.json() : null };
    };
    const basic = `Basic ${Buffer.from(`anyone:${API_KEY}`).toString('base64')}`;
    const granted = await tokenFor(
      'service=loadweaver-registry&scope=repository:shop/app:pull,push&scope=repository:nope/app:pull',
      basic,
    );

    expect(granted.status).toBe(200);
    expect(granted.json.expires_in).toBe(300);

    const verified = verifyJwtEs256(granted.json.token);

    expect(verified?.claims).toMatchObject({
      iss: 'loadweaver-control-plane',
      aud: 'loadweaver-registry',
      sub: 'api-key',
      access: [{ type: 'repository', name: 'shop/app', actions: ['pull', 'push'] }],
    });
    // Signed with the dedicated registry-token key, never with anything the cluster CA issued (node identities).
    const [{ registry_token_certificate: tokenRoot }] = await app
      .get(DataSource)
      .query('SELECT registry_token_certificate FROM lw_cluster');
    const leaf = `-----BEGIN CERTIFICATE-----\n${verified?.header.x5c[0]}\n-----END CERTIFICATE-----`;

    expect(leaf.replace(/\s/g, '')).toBe(tokenRoot.replace(/\s/g, ''));
    expect(await verifyCertificate(leaf, (await api('GET', '/cluster')).json.caCertificate)).toBeNull();

    expect((await tokenFor('service=loadweaver-registry')).status).toBe(401);
    expect(
      (await tokenFor('service=loadweaver-registry', `Basic ${Buffer.from('x:wrong').toString('base64')}`)).status,
    ).toBe(401);
    expect((await tokenFor('service=elsewhere', basic)).status).toBe(400);
  });

  it('assigns public addresses from IP pools and moves provider failover IPs with credentials from secrets', async () => {
    const dataSource = app.get(DataSource);
    const controller = app.get(PublicAddressControllerService);
    const assigned: { address: string; server: { id?: string; name?: string }; config: Record<string, string> }[] = [];

    app.get(FailoverIpProviderRegistry).register({
      id: 'it-provider',
      displayName: 'Integration test provider',
      create: (config: Record<string, string>) => ({
        id: 'it-provider',
        assign: async (address: string, server: { id?: string; name?: string }) =>
          void assigned.push({ address, server, config }),
        holder: async () => null,
      }),
    });
    expect((await api('PUT', '/projects/shop/secrets/hcloud', { value: 'hc-secret-token' })).status).toBeLessThan(300);

    // n1 is the only reachable member of the ingress group.
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);

    stream.on('error', () => undefined);
    stream.on('data', () => undefined);
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));
    await new Promise((r) => setTimeout(r, 500));

    const cluster = (await api('GET', '/resources?kind=Cluster')).json[0];
    const documents = (pool: string) => `apiVersion: loadweaver.com/v1
kind: NodeGroup
metadata: { name: ingress }
spec: { selector: { names: [n1, n3] } }
---
apiVersion: loadweaver.com/v1
kind: IpPool
metadata: { name: vip }
spec: { cidrs: [198.51.100.0/29], nodeGroup: ingress, failover: vrrp }
---
apiVersion: loadweaver.com/v1
kind: IpPool
metadata: { name: floating }
spec: { cidrs: [203.0.113.10/32, 203.0.113.11/32], nodeGroup: ingress, failover: provider, provider: { type: it-provider, credentials: 'secret://shop/hcloud' } }
---
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: ${cluster.metadata.name} }
spec: ${JSON.stringify({ ...cluster.spec, ingress: { pool, addresses: 1 } })}
`;
    const desired = async () =>
      (await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`))[0]?.state;

    try {
      const vrrp = await api('POST', '/plans', { documents: documents('vip') });

      expect(vrrp.status).toBe(201);
      expect(vrrp.json.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'ipam', message: 'assigns 198.51.100.1 from pool vip to ingress/0' }),
        ]),
      );
      expect((await api('POST', `/plans/${vrrp.json.id}/apply`, {})).json.status).toBe('applied');
      expect(await controller.tick()).toEqual(['198.51.100.1']);
      // The apply's own compile already lists the address; the holder follows with the controller's recompile.
      await waitFor(async () => ((await desired())?.publicAddresses?.[0]?.active ? true : undefined));
      expect((await desired()).publicAddresses).toEqual([
        { address: '198.51.100.1', mode: 'vrrp', active: true, vrrp: { vrid: 1, priority: 200 } },
      ]);

      // Switching the ingress to provider failover IPs: the VRRP address cools down, the provider moves the new one.
      const provider = await api('POST', '/plans', { documents: documents('floating') });

      expect((await api('POST', `/plans/${provider.json.id}/apply`, {})).json.status).toBe('applied');
      expect(await dataSource.query(`SELECT address, owner, state FROM lw_public_addresses ORDER BY address`)).toEqual([
        { address: '198.51.100.1', owner: null, state: 'cooldown' },
        { address: '203.0.113.10', owner: 'ingress/0', state: 'assigned' },
      ]);
      expect(await controller.tick()).toEqual(['203.0.113.10']);
      expect(assigned).toEqual([
        { address: '203.0.113.10', server: { name: 'n1' }, config: { apiToken: 'hc-secret-token' } },
      ]);
      await waitFor(async () => ((await desired())?.publicAddresses?.[0]?.mode === 'provider' ? true : undefined));
      expect((await desired()).publicAddresses).toEqual([{ address: '203.0.113.10', mode: 'provider', active: true }]);
      // Holders stay put while healthy.
      expect(await controller.tick()).toEqual([]);
    } finally {
      stream.end();
      client.close();
    }
  });

  it('configures the ingress on the ingress nodes: hostnames, port forwards, replica endpoints and its policy', async () => {
    const dataSource = app.get(DataSource);
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);

    stream.on('error', () => undefined);
    stream.on('data', () => undefined);
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));
    await new Promise((r) => setTimeout(r, 500));

    const site = (name: string, host: string) => `apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: ${name}, project: shop }
spec:
  compose: |
    services:
      web:
        image: ghcr.io/acme/web@sha256:${'8'.repeat(64)}
        ports: ["5432:5432"]
        x-loadweaver: { replicas: 1, exposure: { http: [{ host: ${host}, port: 8080 }] } }
`;

    try {
      const plan = await api('POST', '/plans', { documents: site('site', 'www.example.test') });

      expect(plan.status).toBe(201);
      expect((await api('POST', `/plans/${plan.json.id}/apply`, { confirm: true })).json.status).toBe('applied');

      const [replica] = await dataSource.query(
        `SELECT addresses FROM lw_workload_placements WHERE id = 'shop/site/web/0'`,
      );
      const ingress = await waitFor(async () =>
        (
          await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`)
        )[0]?.state?.ingress?.upstreams?.some(
          (u: { name: string; endpoints: unknown[] }) => u.name === 'shop/site/web:8080' && u.endpoints.length > 0,
        )
          ? (await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`))[0].state
          : undefined,
      );

      expect(ingress.ingress.addresses).toEqual(['203.0.113.10']);
      expect(ingress.ingress.sites).toEqual([
        { host: 'www.example.test', routes: [{ prefix: '/', upstream: 'shop/site/web:8080' }] },
      ]);
      expect(ingress.ingress.forwards).toContainEqual({ protocol: 'tcp', port: 5432, upstream: 'shop/site/web:5432' });
      expect(
        ingress.ingress.upstreams.find((u: { name: string }) => u.name === 'shop/site/web:8080').endpoints,
      ).toEqual(replica.addresses.map((address: string) => ({ address, port: 8080 })));
      // The built-in policy opens exactly the exposed ports from the ingress node towards the replica.
      expect(JSON.stringify(ingress.network.firewall.rules)).toContain('ingress:site/web');

      // Another deployment can't take the same hostname.
      const clash = await api('POST', '/plans', { documents: site('copycat', 'www.example.test') });

      expect(clash.status).toBe(400);
      expect(clash.json.issues.map((i: { message: string }) => i.message)).toContain(
        'www.example.test/ is exposed by both shop/copycat/web and shop/site/web',
      );
    } finally {
      stream.end();
      client.close();
    }
  });

  it('protects exposures: cluster-wide rate limits on the members, the WAF module checksum for the ingress', async () => {
    const dataSource = app.get(DataSource);
    const states = async () =>
      (await dataSource.query(`SELECT node_name, state FROM lw_node_desired_states`)) as {
        node_name: string;
        state: { ingress?: Ingress; rateLimiter?: { config: string; port: number } };
      }[];
    const documents = `apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: limited, project: shop }
spec:
  compose: |
    services:
      api:
        image: ghcr.io/acme/api@sha256:${'7'.repeat(64)}
        x-loadweaver:
          replicas: 1
          exposure:
            http: [{ host: api.example.test, port: 8080, rateLimit: { perIp: 100/m }, waf: enforce }]
`;

    const plan = await api('POST', '/plans', { documents });

    expect(plan.status).toBe(201);
    expect((await api('POST', `/plans/${plan.json.id}/apply`, { confirm: true })).json.status).toBe('applied');

    const all = await waitFor(async () => {
      const rows = await states();

      return rows.some((r) => r.state.rateLimiter) && rows.some((r) => r.state.ingress?.rateLimitService)
        ? rows
        : undefined;
    });
    const limiters = all.filter((r) => r.state.rateLimiter);
    const ingress = all.find((r) => r.state.ingress?.rateLimitService)?.state.ingress as Ingress;
    const site = ingress.sites.find((s) => s.host === 'api.example.test');

    expect(limiters[0].state.rateLimiter?.config).toContain(`value: ${site?.routes[0].rateLimit?.id}`);
    expect(ingress.rateLimitService?.endpoints).toHaveLength(limiters.length);
    expect(site?.waf).toBe('enforce');
    expect(ingress.wafModule?.sha256).toMatch(/^[0-9a-f]{64}$/);

    // The module the agents fetch (from the release bundle) is the pinned one.
    const bundle = mkdtempSync(joinPath(tmpdir(), 'lw-it-bundle-'));

    writeFileSync(joinPath(bundle, 'coraza-proxy-wasm.wasm'), wafModule());
    process.env['LOADWEAVER_AGENT_BINARY_DIR'] = bundle;

    try {
      const module = await fetch(`${baseUrl}/api/install/waf/coraza.wasm`);

      expect(module.status).toBe(200);
      expect(
        createHash('sha256')
          .update(Buffer.from(await module.arrayBuffer()))
          .digest('hex'),
      ).toBe(ingress.wafModule?.sha256);
    } finally {
      delete process.env['LOADWEAVER_AGENT_BINARY_DIR'];
      rmSync(bundle, { recursive: true, force: true });
    }

    // Without limited routes, the members stop the service.
    const removal = await api('POST', '/plans', {
      documents: '',
      delete: [{ kind: 'Deployment', project: 'shop', name: 'limited' }],
    });

    expect((await api('POST', `/plans/${removal.json.id}/apply`, { confirm: true })).json.status).toBe('applied');
    await waitFor(async () => ((await states()).every((r) => !r.state.rateLimiter) ? true : undefined));
  });

  it('issues ingress certificates with ACME, pushes their keys only to ingress nodes, and prefers uploaded ones', async () => {
    const dataSource = app.get(DataSource);
    const certificates = app.get(CertificatesService);
    const pebble = `lw-it-pebble-${process.pid}`;
    const received: DesiredState[] = [];
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);

    // n1 acts like an agent: applies every desired state it receives.
    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok === true && decoded.message.type === 'desiredState') {
        received.push(decoded.message.payload);
        stream.write(
          agentMessage('applyReport', { revision: decoded.message.payload.revision, status: 'applied', steps: [] }),
        );
      }
    });
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));

    try {
      // Pebble skips validation here; the real HTTP-01 path through Envoy is covered by the ACME lab test.
      docker([
        'run',
        '-d',
        '--name',
        pebble,
        '-p',
        '127.0.0.1::14000',
        '-e',
        'PEBBLE_VA_ALWAYS_VALID=1',
        '-e',
        'PEBBLE_VA_NOSLEEP=1',
        '-e',
        'PEBBLE_WFE_NONCEREJECT=0',
        PEBBLE_IMAGE,
      ]);

      const port = docker(['port', pebble, '14000/tcp']).split('\n')[0].split(':').pop();
      const caFile = joinPath(tmpdir(), `lw-it-pebble-ca-${process.pid}.pem`);

      docker(['cp', `${pebble}:/test/certs/pebble.minica.pem`, caFile]);

      const ca = readFileSync(caFile, 'utf8');

      rmSync(caFile, { force: true });
      certificates.transport = (url, init) =>
        new Promise((resolve, reject) => {
          const req = httpsRequest(url, { method: init.method, headers: init.headers, ca }, (res) => {
            const chunks: Buffer[] = [];

            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              const headers = new Headers();

              for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') headers.set(k, v);

              resolve(
                new Response(init.method === 'HEAD' ? null : Buffer.concat(chunks), {
                  status: res.statusCode ?? 0,
                  headers,
                }),
              );
            });
          });

          req.on('error', reject);
          req.end(init.body);
        });

      const cluster = (await api('GET', '/resources?kind=Cluster')).json[0];
      const plan = await api('POST', '/plans', {
        documents: `apiVersion: loadweaver.com/v1\nkind: Cluster\nmetadata: { name: ${cluster.metadata.name} }\nspec: ${JSON.stringify({ ...cluster.spec, ingress: { ...cluster.spec.ingress, acme: { enabled: true, email: 'ops@example.test', directory: `https://localhost:${port}/dir` } } })}\n`,
      });

      expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');
      await new Promise((r) => setTimeout(r, 1_500));
      expect(await certificates.tick()).toBe('www.example.test');

      const [row] = await dataSource.query(
        `SELECT source, names, not_after, failures, private_key FROM lw_certificates WHERE id = 'www-example-test'`,
      );

      expect(row).toMatchObject({ source: 'acme', names: ['www.example.test'], failures: 0 });
      // Stored encrypted.
      expect(row.private_key).not.toContain('PRIVATE KEY');
      // The challenge was served by the ingress while Pebble checked it.
      expect(received.some((s) => (s.ingress?.acmeChallenges.length ?? 0) > 0)).toBe(true);

      const pushed = await waitFor(async () =>
        received.find((s) =>
          s.ingress?.sites.some((site) => site.host === 'www.example.test' && site.certificate === 'www-example-test'),
        ),
      );

      expect(pushed.ingress?.certificates.find((c) => c.id === 'www-example-test')?.privateKeyPem).toContain(
        'PRIVATE KEY',
      );
      expect(
        JSON.stringify(
          (await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`))[0].state,
        ),
      ).not.toContain('PRIVATE KEY');
      expect((await api('GET', '/certificates')).json).toContainEqual(
        expect.objectContaining({ id: 'www-example-test', source: 'acme' }),
      );

      // An uploaded certificate for the same host takes precedence; a key that doesn't match is refused.
      const own = await createCertificateAuthority({ commonName: 'own', validityDays: 30 });
      const keys = await generateKeyPair();
      const uploaded = await issueCertificate({
        ca: own,
        csrPem: await createCsr(keys, 'www'),
        clusterId: 'it',
        kind: 'client',
        name: 'www',
        dnsNames: ['www.example.test'],
        validityHours: 24 * 20,
      });

      expect(
        (
          await api('PUT', '/certificates/own-www', {
            certificatePem: uploaded.certificatePem,
            privateKeyPem: (await generateKeyPair()).privateKeyPem,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await api('PUT', '/certificates/own-www', {
            certificatePem: uploaded.certificatePem,
            privateKeyPem: keys.privateKeyPem,
          })
        ).json,
      ).toMatchObject({ id: 'own-www', source: 'custom', names: ['www.example.test'] });
      await waitFor(async () =>
        received.find((s) =>
          s.ingress?.sites.some((site) => site.host === 'www.example.test' && site.certificate === 'own-www'),
        ),
      );
      // Uploaded certificates are never renewed by ACME.
      expect(await certificates.tick()).not.toBe('www.example.test');
      expect((await api('DELETE', '/certificates/www-example-test')).status).toBe(400);
      expect((await api('DELETE', '/certificates/own-www')).status).toBe(204);
    } finally {
      stream.end();
      client.close();
      removeContainers([pebble]);
    }
  });

  it('manages DNS: plan diff in words, ownership markers, foreign records untouched, conflicts reported', async () => {
    const dataSource = app.get(DataSource);
    const reconciler = app.get(DnsReconcilerService);
    type Rec = { id?: string; name: string; type: string; content: string; ttl: number; priority?: number };
    const zone: Rec[] = [
      { id: 'foreign-1', name: 'legacy.example.test', type: 'A', content: '192.0.2.50', ttl: 3600 },
      { id: 'foreign-2', name: 'api.example.test', type: 'A', content: '192.0.2.51', ttl: 3600 },
    ];
    let next = 0;
    let token = '';

    app.get(DnsProviderRegistry).register({
      id: 'it-dns',
      displayName: 'Integration test DNS',
      create: (config: Record<string, string>) => {
        token = config['apiToken'];

        return {
          id: 'it-dns',
          capabilities: { minTtl: 30, wildcard: true, proxied: false, dnssec: false, createZones: false },
          listZones: async () => [{ id: 'z-1', name: 'example.test' }],
          listRecords: async () => zone.map((r) => ({ ...r })) as never,
          upsertRecord: async (_zone: string, record: Rec) => {
            const existing = record.id ? zone.find((r) => r.id === record.id) : undefined;

            if (existing) Object.assign(existing, record);
            else zone.push({ ...record, id: `r-${++next}` });

            return record as never;
          },
          deleteRecord: async (_zone: string, id: string) =>
            void zone.splice(
              zone.findIndex((r) => r.id === id),
              1,
            ),
        };
      },
    });
    expect((await api('PUT', '/projects/shop/secrets/dns-token', { value: 'dns-secret' })).status).toBeLessThan(300);

    const documents = (withMx: boolean) => `apiVersion: loadweaver.com/v1
kind: DnsProvider
metadata: { name: it }
spec: { type: it-dns, credentials: 'secret://shop/dns-token' }
---
apiVersion: loadweaver.com/v1
kind: DnsZone
metadata: { name: example }
spec: { zone: example.test, provider: it }
---
apiVersion: loadweaver.com/v1
kind: DnsRecord
metadata: { name: api }
spec: { zone: example, name: api, type: A, values: [203.0.113.99] }
${
  withMx
    ? `---
apiVersion: loadweaver.com/v1
kind: DnsRecord
metadata: { name: mail }
spec: { zone: example, name: '@', type: MX, values: [mx.example.net], priority: 10 }
`
    : ''
}`;
    const plan = await api('POST', '/plans', { documents: documents(true) });

    expect(plan.status).toBe(201);
    expect(
      plan.json.networkChanges
        .filter((c: { layer: string }) => c.layer === 'dns-records')
        .map((c: { summary: string }) => c.summary),
    ).toEqual(
      expect.arrayContaining([
        'creates A www.example.test → 203.0.113.10 at it (zone example.test)',
        'creates MX example.test → mx.example.net at it (zone example.test)',
      ]),
    );
    expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');

    expect(await reconciler.tick()).toBeGreaterThan(0);
    expect(token).toBe('dns-secret');

    const names = () => zone.map((r) => `${r.type} ${r.name} ${r.content}`).sort();

    expect(names()).toEqual(
      expect.arrayContaining([
        'A www.example.test 203.0.113.10',
        'TXT _loadweaver.www.example.test heritage=loadweaver,cluster=it,types=A',
        'MX example.test mx.example.net',
        'A legacy.example.test 192.0.2.50',
        // Someone else's record stays; the declared one is a conflict.
        'A api.example.test 192.0.2.51',
      ]),
    );
    expect(names()).not.toContain('A api.example.test 203.0.113.99');

    const [status] = await dataSource.query(
      `SELECT conflicts, error FROM lw_dns_zone_status WHERE zone = 'example' AND provider = 'it'`,
    );

    expect(status).toEqual({
      conflicts: ['A api.example.test exists and is not managed by this cluster'],
      error: null,
    });
    // Idempotent.
    expect(await reconciler.tick()).toBe(0);

    // Removing the MX removes what the cluster created there, nothing else.
    const removal = await api('POST', '/plans', {
      documents: documents(false),
      delete: [{ kind: 'DnsRecord', name: 'mail' }],
    });

    expect((await api('POST', `/plans/${removal.json.id}/apply`, {})).json.status).toBe('applied');
    await reconciler.tick();
    expect(names().filter((n) => n.includes('example.test') && n.startsWith('MX'))).toEqual([]);
    expect(names()).toContain('A legacy.example.test 192.0.2.50');
    expect((await api('GET', '/dns/zones')).json).toEqual([
      expect.objectContaining({ zone: 'example', provider: 'it', error: null }),
    ]);
  });

  it('peers edge nodes with external BGP: held prefixes only, passwords at push time', async () => {
    const dataSource = app.get(DataSource);
    const received: DesiredState[] = [];
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);

    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok === true && decoded.message.type === 'desiredState') received.push(decoded.message.payload);
    });
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));

    // No internet in tests: the ROA lookup answers "no ROA".
    app.get(RpkiCheckService).fetchImpl = async () => new Response(JSON.stringify({ data: { status: 'unknown' } }));

    try {
      expect((await api('PUT', '/projects/shop/secrets/bgp-transit', { value: 'md5-secret' })).status).toBeLessThan(
        300,
      );

      const bgp = (extra = '') => `apiVersion: loadweaver.com/v1
kind: AutonomousSystem
metadata: { name: own }
spec: { asn: 4200000001, prefixes: [192.0.2.0/24] }
---
apiVersion: loadweaver.com/v1
kind: BgpPeer
metadata: { name: transit }
spec: { asn: 64500, address: 198.18.0.1, nodeGroup: ingress, password: 'secret://shop/bgp-transit' }
---
apiVersion: loadweaver.com/v1
kind: BgpAnnouncement
metadata: { name: web }
spec: { prefixes: [192.0.2.0/24], nodeGroup: ingress, communities: ['64500:100'] }
${extra}`;

      const evil = await api('POST', '/plans', {
        documents: bgp(
          `---\napiVersion: loadweaver.com/v1\nkind: BgpAnnouncement\nmetadata: { name: evil }\nspec: { prefixes: [8.8.8.0/24], nodeGroup: ingress }\n`,
        ),
      });

      expect(evil.status).toBe(400);
      expect(evil.json.issues[0].message).toContain('8.8.8.0/24 is not held by the cluster');

      const plan = await api('POST', '/plans', { documents: bgp() });

      expect(plan.status).toBe(201);
      expect(plan.json.warnings).toContainEqual(
        expect.objectContaining({
          path: 'bgp',
          message: expect.stringContaining('192.0.2.0/24: no ROA for AS4200000001'),
        }),
      );
      expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');

      const pushed = await waitFor(async () =>
        received.find((s) => s.externalBgp?.announcements.some((a) => a.prefix === '192.0.2.0/24')),
      );

      expect(pushed.externalBgp).toMatchObject({
        asn: 4200000001,
        peers: [
          {
            name: 'transit',
            address: '198.18.0.1',
            asn: 64500,
            import: 'default',
            maxPrefixes: 10,
            password: 'md5-secret',
          },
        ],
        gracefulShutdown: false,
      });
      expect(pushed.externalBgp?.announcements.find((a) => a.prefix === '192.0.2.0/24')).toEqual({
        prefix: '192.0.2.0/24',
        peers: ['transit'],
        communities: ['64500:100'],
        prepend: 0,
      });
      expect(
        JSON.stringify(
          (await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`))[0].state,
        ),
      ).not.toContain('md5-secret');
    } finally {
      stream.end();
      client.close();
    }
  });

  it('fails DNS over on probe votes with quorum, and hosted bind9 zones follow with a new serial', async () => {
    const dataSource = app.get(DataSource);
    const engine = app.get(DnsFailoverControllerService);
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);

    stream.on('error', () => undefined);
    stream.on('data', () => undefined);
    // n1 becomes a name server with a public IP endpoint.
    stream.write(agentMessage('hello', { ...hello('n1', WG_KEYS[0]), endpointHost: '192.0.2.53' }));

    const zoneFile = async () =>
      (
        await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`)
      )[0]?.state?.authoritativeDns?.zones?.find((z: { name: string }) => z.name === 'hosted.test')?.file as
        | string
        | undefined;

    try {
      const plan = await api('POST', '/plans', {
        documents: `apiVersion: loadweaver.com/v1
kind: NodeGroup
metadata: { name: dns }
spec: { selector: { names: [n1] } }
---
apiVersion: loadweaver.com/v1
kind: DnsProvider
metadata: { name: ns }
spec: { type: bind9, nodeGroup: dns }
---
apiVersion: loadweaver.com/v1
kind: DnsZone
metadata: { name: hosted }
spec: { zone: hosted.test, provider: ns }
---
apiVersion: loadweaver.com/v1
kind: DnsFailover
metadata: { name: shop }
spec:
  host: shop.hosted.test
  endpoints: [{ name: fra, address: 203.0.113.10, site: fra1 }, { name: ams, address: 198.51.100.10, site: ams1 }]
  check: { protocol: tcp, port: 443 }
  failAfter: 3
`,
      });

      expect(plan.status).toBe(201);
      expect(plan.json.warnings).toContainEqual(
        expect.objectContaining({
          path: 'dns',
          message: 'zone hosted.test: fewer than two name servers with public addresses (single point of failure)',
        }),
      );
      expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');

      // The first round answers the primary; n1 gets the zone and probes.
      const t0 = new Date();

      expect(await engine.tick(t0)).toEqual([]);

      const first = await waitFor(async () => {
        const file = await zoneFile();

        return file?.includes('shop.hosted.test. 30 IN A 203.0.113.10') ? file : undefined;
      });
      const serial = (file: string) => Number(/IN SOA \S+ \S+ (\d+)/.exec(file)?.[1]);
      const n1Probes = (
        await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`)
      )[0].state.probes.map((p: { id: string }) => p.id);

      expect(n1Probes).toEqual(['shop/fra', 'shop/ams']);
      expect(first).toContain('ns1.hosted.test. 300 IN A 192.0.2.53');

      // The authoritative servers (n1's bind9 here) answer the new record right away.
      engine.query = async () => ['198.51.100.10'];
      engine.propagationOptions = { intervalMs: 50, timeoutMs: 5_000 };

      // Two probing nodes report fra down for three rounds: fail over to ams.
      for (let round = 1; round <= 3; round++) {
        const at = new Date(t0.getTime() + round * 10_000);

        // Two of the three members (n1, n3) are reachable: control-plane quorum.
        await dataSource.query(`UPDATE lw_nodes SET last_seen_at = $1 WHERE name IN ('n1', 'n3')`, [at]);

        for (const node of ['n1', 'n3']) {
          await engine.record(
            node,
            new Set(['shop/fra', 'shop/ams']),
            [
              { id: 'shop/fra', ok: false, error: 'timeout' },
              { id: 'shop/ams', ok: true },
            ],
            at,
          );
        }

        expect(await engine.tick(at)).toEqual(round === 3 ? ['shop'] : []);
      }

      // Results for probes a node wasn't given are ignored.
      await engine.record('n1', new Set(['shop/fra']), [{ id: 'other/x', ok: false }]);
      expect(
        (await dataSource.query(`SELECT count(*)::int AS n FROM lw_probe_results WHERE probe_id = 'other/x'`))[0].n,
      ).toBe(0);

      const switched = await waitFor(async () => {
        const file = await zoneFile();

        return file?.includes('shop.hosted.test. 30 IN A 198.51.100.10') ? file : undefined;
      });

      expect(serial(switched)).toBeGreaterThan(serial(first));
      expect((await api('GET', '/dns/failover')).json).toContainEqual(
        expect.objectContaining({ name: 'shop', state: expect.objectContaining({ active: ['ams'] }) }),
      );
      expect(
        (
          await dataSource.query(
            `SELECT details FROM lw_audit_events WHERE action = 'dns-failover.switch' ORDER BY seq DESC LIMIT 1`,
          )
        )[0].details,
      ).toMatchObject({ host: 'shop.hosted.test', from: ['203.0.113.10'], to: ['198.51.100.10'], unhealthy: ['fra'] });
      expect((await api('POST', '/dns/failover/shop/failback')).status).toBe(404);
      // The switch is confirmed on every authoritative server.
      await waitFor(async () =>
        (await dataSource.query(`SELECT propagation FROM lw_dns_failover_state WHERE name = 'shop'`))[0]?.propagation
          ?.done
          ? true
          : undefined,
      );
    } finally {
      stream.end();
      client.close();
    }
  });

  it('signs hosted zones with DNSSEC, rolls keys over yearly, and transfers to AXFR secondaries with TSIG', async () => {
    const dataSource = app.get(DataSource);
    const dnssec = app.get(DnssecService);
    const received: DesiredState[] = [];
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);
    const tsig = randomBytes(32).toString('base64');
    let parent: { keyTag: number; algorithm: number; digestType: number; digest: string }[] = [];

    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok === true && decoded.message.type === 'desiredState') received.push(decoded.message.payload);
    });
    stream.write(agentMessage('hello', { ...hello('n1', WG_KEYS[0]), endpointHost: '192.0.2.53' }));
    // The parent zone, as the DS lookup sees it.
    dnssec.dsLookup = async () => parent;

    const documents = (secondary: string) => `apiVersion: loadweaver.com/v1
kind: DnsProvider
metadata: { name: sec }
spec: { type: axfr, servers: [198.51.100.53], credentials: 'secret://shop/tsig' }
---
apiVersion: loadweaver.com/v1
kind: DnsZone
metadata: { name: signed }
spec: { zone: signed.test, provider: ns, secondaries: [${secondary}], dnssec: true }
`;
    const pushedZone = () =>
      received
        .map((s) => s.authoritativeDns?.zones.find((z) => z.name === 'signed.test'))
        .reverse()
        .find(Boolean);

    try {
      expect((await api('PUT', '/projects/shop/secrets/tsig', { value: tsig })).status).toBeLessThan(300);

      // API secondaries would serve the zone unsigned.
      const unsigned = await api('POST', '/plans', {
        documents:
          `${documents('sec')}---\napiVersion: loadweaver.com/v1\nkind: DnsProvider\nmetadata: { name: cf2 }\nspec: { type: it-dns, credentials: 'secret://shop/dns-token' }\n`.replace(
            'secondaries: [sec]',
            'secondaries: [sec, cf2]',
          ),
      });

      expect(unsigned.status).toBe(400);
      expect(unsigned.json.issues.map((i: { message: string }) => i.message)).toContain(
        'zone signed.test: cf2 would serve the records unsigned; with DNSSEC, secondaries get the signed zone by AXFR',
      );

      const plan = await api('POST', '/plans', { documents: documents('sec') });

      expect(plan.status).toBe(201);
      expect(plan.json.networkChanges).toContainEqual(
        expect.objectContaining({
          layer: 'dnssec',
          node: 'signed',
          summary: expect.stringContaining('signs signed.test'),
        }),
      );
      expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');

      // The first key, pushed with its private key and the TSIG secret; neither is stored in the desired state.
      const t0 = new Date();

      expect(await dnssec.tick(t0)).toBe(true);

      const first = (await api('GET', '/dns/dnssec')).json[0];

      expect(first).toMatchObject({ zone: 'signed.test', mode: 'signed', registrar: null });
      expect(first.keys).toHaveLength(1);
      expect(first.expectedDs).toEqual([first.keys[0].ds]);

      const zone = await waitFor(async () => (pushedZone()?.dnssec?.keys[0]?.privateKey ? pushedZone() : undefined));
      const tsigKeys = received.at(-1)?.authoritativeDns?.tsigKeys;

      expect(zone?.transfers).toEqual([{ address: '198.51.100.53', key: 'sec' }]);
      expect(tsigKeys).toEqual([{ name: 'sec', algorithm: 'hmac-sha256', secret: tsig }]);
      expect(dnssecKeyMatches(zone?.dnssec?.keys[0] as { publicKey: string; privateKey: string })).toBe(true);

      const stored = JSON.stringify(
        (await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`))[0].state,
      );

      expect(stored).toContain(zone?.dnssec?.keys[0].publicKey);
      expect(stored).not.toContain(zone?.dnssec?.keys[0].privateKey);
      expect(stored).not.toContain(tsig);

      // A year later, with the DS at the parent: a successor is added, both DS are asked for, then only the new one.
      const [ds] = first.expectedDs[0].split(' IN DS ')[1].split(' ').map(Number);
      const digest = first.expectedDs[0].split(' ').at(-1);

      parent = [{ keyTag: ds, algorithm: 13, digestType: 2, digest }];

      const later = new Date(t0.getTime() + 366 * 24 * 3600 * 1000);

      expect(await dnssec.tick(later)).toBe(true);

      const rolling = (await api('GET', '/dns/dnssec')).json[0];

      expect(rolling.keys.map((k: { state: string }) => k.state)).toEqual(['retired', 'active']);
      expect(rolling.keys[0].dsAtParent).toBe(true);
      expect(rolling.expectedDs).toHaveLength(2);
      expect(
        (await dataSource.query(`SELECT action FROM lw_audit_events WHERE action LIKE 'dnssec.%' ORDER BY seq`)).map(
          (r: { action: string }) => r.action,
        ),
      ).toEqual(['dnssec.key-created', 'dnssec.rollover-started']);
      await waitFor(async () => (pushedZone()?.dnssec?.keys.length === 2 ? true : undefined));

      // No new rollover while one is in progress; the old key goes 14 days after its DS left the parent.
      const newDs = rolling.expectedDs[0].split(' ');

      parent = [{ keyTag: Number(newDs[3]), algorithm: 13, digestType: 2, digest: newDs[6] }];
      expect(await dnssec.tick(new Date(later.getTime() + 3 * 24 * 3600 * 1000))).toBe(false);
      expect(await dnssec.tick(new Date(later.getTime() + 18 * 24 * 3600 * 1000))).toBe(true);
      expect((await api('GET', '/dns/dnssec')).json[0].keys).toHaveLength(1);
      await waitFor(async () => (pushedZone()?.dnssec?.keys.length === 1 ? true : undefined));

      // Still signed: it can't be moved off hosted bind9 or deleted (the DS may still be at the parent).
      const moved = await api('POST', '/plans', { documents: '', delete: [{ kind: 'DnsZone', name: 'signed' }] });

      expect(moved.status).toBe(400);
      expect(moved.json.issues[0].message).toContain('zone signed is still DNSSEC-signed');

      // The AXFR secondary lags one serial behind n1's bind9: shown on the zone and warned about in plans.
      const reconciler = app.get(DnsReconcilerService);

      reconciler.soaQuery = async (server) => (server === '198.51.100.53' ? 9 : 10);
      await reconciler.tick();
      expect((await api('GET', '/dns/zones')).json).toContainEqual(
        expect.objectContaining({ zone: 'signed', provider: 'sec', drift: '198.51.100.53 at serial 9, primary at 10' }),
      );
      expect(
        (
          await api('POST', '/plans', {
            documents: documents('sec').replace('dnssec: true', 'dnssec: true, defaultTtl: 600'),
          })
        ).json.warnings,
      ).toContainEqual(
        expect.objectContaining({
          message: 'zone signed.test: secondary sec drifted from the primary: 198.51.100.53 at serial 9, primary at 10',
        }),
      );
    } finally {
      stream.end();
      client.close();
    }
  });

  it('steers hosted DNS answers per client: weighted by address, geo and latency through GeoIP views', async () => {
    const dataSource = app.get(DataSource);
    const engine = app.get(DnsFailoverControllerService);
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);

    stream.on('error', () => undefined);
    stream.on('data', () => undefined);
    stream.write(agentMessage('hello', { ...hello('n1', WG_KEYS[0]), endpointHost: '192.0.2.53' }));
    process.env['LOADWEAVER_GEOIP_DB'] = geoipTestDb();

    const failover = (name: string, mode: string, endpoints: string) => `---
apiVersion: loadweaver.com/v1
kind: DnsFailover
metadata: { name: ${name} }
spec: { host: ${name}.hosted.test, mode: ${mode}, check: { protocol: tcp, port: 443 }, endpoints: ${endpoints} }
`;
    const documents = `apiVersion: loadweaver.com/v1
kind: Site
metadata: { name: default }
spec: { location: { latitude: 50.1, longitude: 8.7, label: Frankfurt } }
${failover('geo', 'geo', '[{ name: uk, address: 203.0.113.21, countries: [GB] }, { name: rest, address: 203.0.113.22 }]')}${failover(
      'lat',
      'latency',
      '[{ name: fra, address: 203.0.113.31, site: fra1 }, { name: ams, address: 203.0.113.32, site: ams1 }]',
    )}${failover('wgt', 'weighted', '[{ name: a, address: 203.0.113.41, weight: 3 }, { name: b, address: 203.0.113.42, weight: 1 }]')}`;
    const state = async () =>
      (await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = 'n1'`))[0]?.state
        ?.authoritativeDns as AuthoritativeDns | undefined;

    try {
      const plan = await api('POST', '/plans', { documents });

      expect(plan.status).toBe(201);
      expect(plan.json.warnings).toContainEqual(
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('lat.hosted.test: DNS failover recovers in about 70 s'),
        }),
      );
      expect(JSON.stringify(plan.json.warnings)).not.toContain('needs a GeoIP database');
      expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');

      // ams answers fastest from the probing site (Frankfurt, in Europe).
      const now = new Date();

      await dataSource.query(`UPDATE lw_nodes SET last_seen_at = $1 WHERE name IN ('n1', 'n3')`, [now]);

      for (const node of ['n1', 'n3'])
        await engine.record(
          node,
          new Set(['lat/fra', 'lat/ams']),
          [
            { id: 'lat/fra', ok: true, latencyMs: 30 },
            { id: 'lat/ams', ok: true, latencyMs: 8 },
          ],
          now,
        );

      await engine.tick(now);
      expect((await api('GET', '/dns/failover')).json).toContainEqual(
        expect.objectContaining({
          name: 'lat',
          state: expect.objectContaining({ latency: { default: 'ams', byContinent: { EU: 'ams' } } }),
        }),
      );

      const dns = await waitFor(async () => {
        const s = await state();

        return s?.views?.some((v) => v.continent === 'EU') ? s : undefined;
      });
      const zoneIn = (view: { zones: { name: string; file: string }[] }) =>
        view.zones.find((z) => z.name === 'hosted.test')?.file ?? '';
      const views = dns.views ?? [];

      expect(dns.geoip).toEqual({ sha256: GEOIP_TEST_DB_SHA256 });
      expect(views.length).toBeLessThanOrEqual(64);
      expect(zoneIn(views.find((v) => v.country === 'GB') as (typeof views)[number])).toContain(
        'geo.hosted.test. 30 IN A 203.0.113.21',
      );
      expect(zoneIn(views.find((v) => v.continent === 'EU' && !v.country) as (typeof views)[number])).toContain(
        'lat.hosted.test. 30 IN A 203.0.113.32',
      );
      // Weighted: 3 : 1 over the address buckets.
      const weighted = views.filter((v) => v.networks && !v.country && !v.continent);

      expect(weighted.map((v) => v.networks?.length ?? 0).sort((a, b) => a - b)).toEqual([512, 1536]);
      // The shared zone (and every API provider) answers the defaults.
      const shared = dns.zones.find((z) => z.name === 'hosted.test')?.file ?? '';

      expect(shared).toContain('geo.hosted.test. 30 IN A 203.0.113.22');
      expect(shared).toContain('wgt.hosted.test. 30 IN A 203.0.113.41');
      expect(shared).toContain('wgt.hosted.test. 30 IN A 203.0.113.42');

      // The agents fetch the database from the control plane and check it against that checksum.
      const db = await fetch(`${baseUrl}/api/install/geoip/country.mmdb`);

      expect(db.status).toBe(200);
      expect(
        createHash('sha256')
          .update(Buffer.from(await db.arrayBuffer()))
          .digest('hex'),
      ).toBe(GEOIP_TEST_DB_SHA256);

      const removal = await api('POST', '/plans', {
        documents: '',
        delete: ['geo', 'lat', 'wgt'].map((name) => ({ kind: 'DnsFailover', name })),
      });

      expect((await api('POST', `/plans/${removal.json.id}/apply`, {})).json.status).toBe('applied');
      await waitFor(async () => ((await state())?.views ? undefined : true));
    } finally {
      delete process.env['LOADWEAVER_GEOIP_DB'];
      stream.end();
      client.close();
    }
  });

  it('sends a workload group out with an address from an own pool, through the node holding it', async () => {
    const dataSource = app.get(DataSource);
    const [replica] = await dataSource.query(
      `SELECT node, addresses FROM lw_workload_placements WHERE id = 'shop/site/web/0'`,
    );
    const gateway = ['n1', 'n2', 'n3'].find((n) => n !== replica.node) as string;
    const state = async (node: string) =>
      (await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = $1`, [node]))[0]?.state
        ?.network as NodeNetworkConfig | undefined;
    const documents = `apiVersion: loadweaver.com/v1
kind: NodeGroup
metadata: { name: edge }
spec: { selector: { names: [${gateway}] } }
---
apiVersion: loadweaver.com/v1
kind: IpPool
metadata: { name: egress }
spec: { cidrs: [192.0.2.248/29], nodeGroup: edge, failover: none, purposes: [egress] }
---
apiVersion: loadweaver.com/v1
kind: WorkloadGroup
metadata: { name: web, project: shop }
spec: { selector: { names: [web] } }
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: out, project: shop }
spec:
  from: [{ group: web }]
  to: [{ builtin: internet }]
  rules: [{ ports: [443] }]
  egress: { pools: [egress], reverseDns: out.example.test }
`;

    await dataSource.query(`UPDATE lw_nodes SET last_seen_at = now() WHERE name = $1`, [gateway]);

    const plan = await api('POST', '/plans', { documents });

    expect(plan.status).toBe(201);
    expect(plan.json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'ipam', message: 'assigns 192.0.2.248 from pool egress to egress/shop/out/0' }),
        expect.objectContaining({
          path: 'dns',
          message:
            'PTR 192.0.2.248 → out.example.test: no managed reverse zone covers it; set it where the address is delegated',
        }),
      ]),
    );
    // Another project's workloads can't be sent out through this project's gateway.
    const foreign = await api('POST', '/plans', {
      documents: documents.replace('from: [{ group: web }]', 'from: [{ group: web, project: other }]'),
    });

    expect(foreign.status).toBe(400);
    // Another project's group: it would have to exist and be exposed (3.17) before egress rules even come into play.
    expect(foreign.json.issues[0].message).toBe('Policy shop/out: group other/web does not exist');
    expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');
    expect(await app.get(PublicAddressControllerService).tick()).toContain('192.0.2.248');

    const v4 = (replica.addresses as string[]).filter((a) => !a.includes(':'));
    const gatewayConfig = await waitFor(async () => {
      const network = await state(gateway);

      return network?.egress?.snat.length ? network : undefined;
    });

    // Every `web` service of the project, this replica among them.
    expect(gatewayConfig.egress?.snat).toEqual([{ address: '192.0.2.248', sources: expect.arrayContaining(v4) }]);
    // The replica's node routes its traffic out of the cluster to the gateway over their link.
    const replicaConfig = await state(replica.node);
    const link = replicaConfig?.wireguard.find((l) => l.peer === gateway);

    expect(replicaConfig?.egress?.routes).toEqual([
      { interface: link?.interface, sources: expect.arrayContaining(v4), destinations: ['0.0.0.0/0'] },
    ]);
    expect(link?.allowedIps).toContain('0.0.0.0/0');

    const removal = await api('POST', '/plans', {
      documents: '',
      delete: [
        { kind: 'Policy', project: 'shop', name: 'out' },
        { kind: 'WorkloadGroup', project: 'shop', name: 'web' },
        { kind: 'IpPool', name: 'egress' },
        { kind: 'NodeGroup', name: 'edge' },
      ],
    });

    expect((await api('POST', `/plans/${removal.json.id}/apply`, {})).json.status).toBe('applied');
    await waitFor(async () => ((await state(gateway))?.egress ? undefined : true));
  });

  it('issues workload identities for the node proxies only for services the node runs', async () => {
    const dataSource = app.get(DataSource);
    const [placement] = await dataSource.query(
      `SELECT project, deployment, service, node FROM lw_workload_placements WHERE node = 'n1' LIMIT 1`,
    );
    const own = `${placement.project}/${placement.deployment}/${placement.service}`;
    const foreign = 'other/elsewhere/api';
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);
    const answer = new Promise<WorkloadIdentities>((resolve) =>
      stream.on('data', (env: Envelope) => {
        const decoded = decodeControlPlaneMessage(env);

        if (decoded.ok === true && decoded.message.type === 'workloadIdentities') resolve(decoded.message.payload);
      }),
    );

    stream.on('error', () => undefined);
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));

    try {
      const keys = await generateKeyPair();

      stream.write(
        agentMessage('workloadIdentityRequest', {
          requests: [
            { identity: own, csrPem: await createCsr(keys, own) },
            { identity: foreign, csrPem: await createCsr(keys, foreign) },
          ],
        }),
      );

      const identities = await answer;
      const verified = await verifyCertificate(identities.certificates[0].certificatePem, identities.caCertificatePem);

      expect(identities.refused).toEqual([foreign]);
      expect(identities.certificates.map((c) => c.identity)).toEqual([own]);
      expect(verified).toMatchObject({ kind: 'workload', name: own });
      expect(verified?.notAfter.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000 + 60_000);
    } finally {
      stream.end();
      client.close();
    }
  });

  it('applies image policies: scans and signatures in plans, limits for the nodes, scan reports only for own images', async () => {
    const dataSource = app.get(DataSource);
    const digest = `sha256:${'6'.repeat(64)}`;
    const image = `ghcr.io/acme/scanned@${digest}`;
    const resolver = app.get(ImageResolverService);
    const publicReader = resolver.publicReader.bind(resolver);

    // No registry in tests: the image has no signature.
    resolver.publicReader = () => ({ manifest: async () => null, blob: async () => Buffer.alloc(0) });
    await dataSource.query(
      `INSERT INTO lw_image_scans (digest, image, scanned_at, node, scanner, summary, findings) VALUES ($1, $2, now(), 'n1', 'trivy', $3, $4)`,
      [
        digest,
        image,
        JSON.stringify({
          counts: {
            CRITICAL: { total: 2, fixable: 1 },
            HIGH: { total: 0, fixable: 0 },
            MEDIUM: { total: 0, fixable: 0 },
            LOW: { total: 0, fixable: 0 },
            UNKNOWN: { total: 0, fixable: 0 },
          },
        }),
        JSON.stringify([{ id: 'CVE-2026-1', severity: 'CRITICAL', package: 'openssl', installed: '1', fixed: '2' }]),
      ],
    );

    const documents = (mode: string, extra = '') => `apiVersion: loadweaver.com/v1
kind: ImagePolicy
metadata: { name: no-criticals, project: shop }
spec: { mode: ${mode}, vulnerabilities: { block: [CRITICAL] }${extra} }
---
apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: scanned, project: shop }
spec:
  compose: |
    services:
      app:
        image: ${image}
`;

    try {
      const blocked = await api('POST', '/plans', { documents: documents('enforce') });

      expect(blocked.status).toBe(400);
      expect(blocked.json.issues[0].message).toContain(
        `${image} has 1 critical vulnerabilities (e.g. CVE-2026-1 in openssl)`,
      );

      const key = generateKeyPairSync('ec', { namedCurve: 'P-256' })
        .publicKey.export({ type: 'spki', format: 'pem' })
        .toString();
      const unsigned = await api('POST', '/plans', {
        documents: documents('enforce', `, requireSignature: { keys: [${JSON.stringify(key)}] }`),
      });

      expect(unsigned.status).toBe(400);
      expect(JSON.stringify(unsigned.json.issues)).toContain(
        'is not signed by a policy key: no cosign signature found',
      );

      const monitored = await api('POST', '/plans', { documents: documents('monitor') });

      expect(monitored.status).toBe(201);
      expect(monitored.json.warnings).toContainEqual(
        expect.objectContaining({ level: 'warning', message: expect.stringContaining('critical vulnerabilities') }),
      );
      expect((await api('POST', `/plans/${monitored.json.id}/apply`, {})).json.status).toBe('applied');

      // The node gets the limit with the workload.
      const [placement] = await dataSource.query(
        `SELECT node FROM lw_workload_placements WHERE id = 'shop/scanned/app/0'`,
      );
      const spec = await waitFor(async () => {
        const state = (
          await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = $1`, [placement.node])
        )[0]?.state;

        return state?.workloads?.find((w: { id: string }) => w.id === 'shop/scanned/app/0');
      });

      expect(spec.imagePolicy).toEqual([{ mode: 'monitor', block: ['CRITICAL'], ignoreUnfixed: true }]);

      // Scan reports: accepted for an image the node runs, ignored otherwise.
      const policies = app.get(ImagePolicyService);
      const report = (d: string) => ({
        image,
        digest: d,
        scanner: 'trivy 0.76.0',
        counts: {
          CRITICAL: { total: 0, fixable: 0 },
          HIGH: { total: 0, fixable: 0 },
          MEDIUM: { total: 0, fixable: 0 },
          LOW: { total: 0, fixable: 0 },
          UNKNOWN: { total: 0, fixable: 0 },
        },
        findings: [],
      });

      expect(await policies.record(placement.node, report(digest))).toBe(true);
      expect(await policies.record(placement.node, report(`sha256:${'5'.repeat(64)}`))).toBe(false);
      expect((await api('GET', '/images/scans')).json).toContainEqual(
        expect.objectContaining({ digest, node: placement.node }),
      );
    } finally {
      resolver.publicReader = publicReader;
    }
  });

  it('runs remote access: enrollment by identity-provider groups, posture, policies on the gateway, instant revocation', async () => {
    const dataSource = app.get(DataSource);
    const remote = app.get(RemoteAccessService);
    const cluster = (await api('GET', '/resources?kind=Cluster')).json[0];
    const state = async (node: string) =>
      (await dataSource.query(`SELECT state FROM lw_node_desired_states WHERE node_name = $1`, [node]))[0]?.state
        ?.network as NodeNetworkConfig | undefined;
    const ids: Record<string, string> = {
      alice: '7d3f9a52-1c1e-4c39-9a51-3a3c1e0d0a01',
      bob: '7d3f9a52-1c1e-4c39-9a51-3a3c1e0d0a02',
      mallory: '7d3f9a52-1c1e-4c39-9a51-3a3c1e0d0a03',
    };
    const user = (name: string, roles: string[], amr = ['pwd']) =>
      ({ user: { id: ids[name], email: `${name}@example.test`, roles, amr } }) as unknown as RequestWithUser;
    const admin = { apiKeyAuthenticated: true } as unknown as RequestWithUser;
    const [web] = await dataSource.query(`SELECT addresses FROM lw_workload_placements WHERE id = 'shop/site/web/0'`);
    const webV4 = (web.addresses as string[]).filter((a) => !a.includes(':'));
    const documents = (remoteAccess: boolean) => `apiVersion: loadweaver.com/v1
kind: NodeGroup
metadata: { name: vpn }
spec: { selector: { names: [n1] } }
---
apiVersion: loadweaver.com/v1
kind: IpPool
metadata: { name: vpn }
spec: { cidrs: [192.0.2.240/30], nodeGroup: vpn, failover: none, purposes: [vpn] }
---
apiVersion: loadweaver.com/v1
kind: ClientGroup
metadata: { name: staff }
spec:
  idpGroups: [staff]
  keyLifetimeDays: 7
  posture: { diskEncryption: true, plugins: [{ type: it-mdm, require: compliant }] }
  restrictedGroup: quarantine
---
apiVersion: loadweaver.com/v1
kind: ClientGroup
metadata: { name: quarantine }
spec: {}
---
apiVersion: loadweaver.com/v1
kind: ClientGroup
metadata: { name: offices }
spec: {}
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: staff-web }
spec: { from: [{ clients: staff }], to: [{ selector: { names: [web] } }], rules: [{ protocol: udp, ports: [80] }] }
---
apiVersion: loadweaver.com/v1
kind: Policy
metadata: { name: web-printers }
spec: { from: [{ selector: { names: [web] } }], to: [{ clients: offices }], rules: [{ ports: [631] }] }
---
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: ${cluster.metadata.name} }
spec: ${JSON.stringify({
      ...cluster.spec,
      ...(remoteAccess
        ? {
            remoteAccess: {
              nodeGroup: 'vpn',
              endpoint: 'vpn.example.test',
              pool: 'vpn',
              clientNetwork: '100.96.0.0/24',
            },
          }
        : {}),
    })}
`;

    // Client groups without gateways are rejected; with them the plan assigns the gateway address.
    expect((await api('POST', '/plans', { documents: documents(false) })).json.issues).toEqual([
      expect.objectContaining({ message: 'ClientGroups need remoteAccess in the Cluster resource' }),
    ]);

    await dataSource.query(`UPDATE lw_nodes SET last_seen_at = now() WHERE name = 'n1'`);

    const plan = await api('POST', '/plans', { documents: documents(true) });

    expect(plan.status).toBe(201);
    expect(plan.json.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'assigns 192.0.2.240 from pool vpn to vpn/0' })]),
    );
    expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');
    expect(await app.get(PublicAddressControllerService).tick()).toContain('192.0.2.240');
    // The gateways get their key with the first compilation, before anyone enrolls.
    await waitFor(async () =>
      (await dataSource.query(`SELECT public_key FROM lw_vpn_gateway_keys`)).length === 1 ? true : undefined,
    );

    // A posture plugin (MDM) that knows one device, configured as an integration (P4).
    app.get(PosturePluginRegistry).register({
      id: 'it-mdm',
      displayName: 'Integration MDM',
      category: 'mdm',
      fields: [{ key: 'apiToken', label: 'API token', secret: true, required: true }],
      defaultMatchBy: ['deviceId'],
      allowedHosts: () => ['mdm.example.test'],
      create: () => ({
        id: 'it-mdm',
        category: 'mdm',
        testConnection: async () => 'ok',
        fetchDevices: async () => [
          { externalId: 'm-1', deviceIds: ['SER-1'], status: 'compliant' as const, reasons: [] },
          {
            externalId: 'm-2',
            deviceIds: ['SER-9'],
            status: 'non-compliant' as const,
            reasons: ['MDM: encryption off'],
          },
        ],
      }),
    });

    const posture = app.get(PostureIntegrationsService);
    const mdm = await posture.create(admin, { name: 'it-mdm', type: 'it-mdm', config: { apiToken: 'it-secret' } });

    expect(mdm).toMatchObject({ secretsSet: ['apiToken'], config: {} });
    // The stored configuration is encrypted at rest.
    expect(JSON.stringify(await dataSource.query(`SELECT config FROM lw_posture_integrations`))).not.toContain(
      'it-secret',
    );

    // Users enroll with an interactive login and an identity-provider group that maps to a client group.
    const laptopKey = generateWireguardKeyPair();

    await expect(remote.enroll(user('mallory', ['other']), 'laptop', laptopKey.publicKey)).rejects.toThrow(
      'you are not in any client group',
    );
    await expect(remote.enroll(user('alice', ['staff'], ['pat']), 'laptop', laptopKey.publicKey)).rejects.toThrow(
      'interactive login',
    );
    await expect(remote.enroll(admin, 'laptop', laptopKey.publicKey)).rejects.toThrow('interactive login');

    const enrolled = await remote.enroll(user('alice', ['staff']), 'laptop', laptopKey.publicKey);

    // No posture report yet: the device lands in the restricted group and reaches nothing but DNS.
    expect(enrolled.client).toMatchObject({
      owner: 'alice@example.test',
      address: '100.96.0.2',
      groups: ['staff'],
      effectiveGroups: ['quarantine'],
      restrictions: { staff: ['no posture report from this device'] },
    });
    expect(new Date(enrolled.client.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000);
    expect(enrolled.routes).toEqual(['100.96.0.1/32']);
    expect(enrolled.config).toContain('Endpoint = vpn.example.test:51800');
    expect(enrolled.config).not.toMatch(/PrivateKey = [A-Za-z0-9+/]{43}=/);

    // Admins don't report for users' devices.
    await expect(
      remote.reportPosture(admin, enrolled.client.id, { platform: 'linux', osVersion: '6.8', diskEncryption: true }),
    ).rejects.toThrow('device not found');
    await remote.reportPosture(user('alice', ['staff']), enrolled.client.id, {
      platform: 'linux',
      osVersion: '6.8',
      diskEncryption: true,
      deviceId: 'SER-1',
    });
    // Until the integration looked the device up, the MDM verdict is unknown (fail closed).
    expect((await remote.config(user('alice', ['staff']), enrolled.client.id)).client.effectiveGroups).toEqual([
      'quarantine',
    ]);
    expect(await posture.sync({ integrationId: mdm.id, slot: 'it' })).toMatchObject({
      vendorDevices: 2,
      matchedDevices: 1,
    });
    // The device id is pinned at the first report, no other report can borrow it.
    await expect(
      remote.reportPosture(user('alice', ['staff']), enrolled.client.id, {
        platform: 'linux',
        osVersion: '6.8',
        diskEncryption: true,
        deviceId: 'SER-2',
      }),
    ).rejects.toThrow('another device id');

    const bobs = await remote.enroll(user('bob', ['staff']), 'desktop', generateWireguardKeyPair().publicKey);

    await expect(
      remote.reportPosture(user('bob', ['staff']), bobs.client.id, {
        platform: 'linux',
        osVersion: '6.8',
        diskEncryption: true,
        deviceId: 'SER-1',
      }),
    ).rejects.toThrow('belongs to another enrolled device');
    // Pins are stored normalized and unique among non-revoked clients in the database too (migration 048: a
    // concurrent first report can't pin the same value twice).
    await expect(
      dataSource.query(`UPDATE lw_vpn_clients SET posture = '{"deviceId":"ser-1"}'::jsonb WHERE id = $1`, [
        bobs.client.id,
      ]),
    ).rejects.toThrow(/UQ_lw_vpn_clients_pinned_device_id/);
    await remote.revoke(user('bob', ['staff']), bobs.client.id);

    const config = await remote.config(user('alice', ['staff']), enrolled.client.id);

    expect(config.client.effectiveGroups).toEqual(['staff']);
    expect(config.routes).toEqual(expect.arrayContaining([...webV4.map((a) => `${a}/32`), '100.96.0.1/32']));
    // Other users can't see the device.
    await expect(remote.config(user('bob', ['staff']), enrolled.client.id)).rejects.toThrow('device not found');

    // Offices: overlapping subnets are rejected; the router's networks are a group in the policy model.
    const officeKey = generateWireguardKeyPair();
    const office = await remote.createMachine(admin, {
      name: 'office-berlin',
      publicKey: officeKey.publicKey,
      groups: ['offices'],
      subnets: ['192.168.50.0/24'],
    });

    await expect(
      remote.createMachine(admin, {
        name: 'office-hamburg',
        publicKey: generateWireguardKeyPair().publicKey,
        groups: ['offices'],
        subnets: ['192.168.50.128/25'],
      }),
    ).rejects.toThrow('192.168.50.128/25 overlaps 192.168.50.0/24 of office-berlin');
    expect(office.routes).toEqual(expect.arrayContaining(webV4.map((a) => `${a}/32`)));
    // Machines have no login to renew with: admins extend them.
    expect(new Date((await remote.renewMachine(admin, office.client.id, 30)).expiresAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 30 * 86_400_000,
    );

    // The gateway: both clients as peers, their prefixes routed, the policies enforced on it.
    const gateway = await waitFor(async () => {
      const network = await state('n1');

      return network?.remoteAccess?.peers.length === 2 ? network : undefined;
    });

    expect(gateway.remoteAccess).toMatchObject({
      active: true,
      address: '100.96.0.1/24',
      prefixes: ['100.96.0.0/24', '192.168.50.0/24'],
    });
    expect(gateway.remoteAccess?.peers.map((p) => [p.label, p.allowedIps])).toEqual(
      expect.arrayContaining([
        ['alice@example.test/laptop', ['100.96.0.2/32']],
        ['machine/office-berlin', ['100.96.0.4/32', '192.168.50.0/24']],
      ]),
    );
    expect(gateway.firewall.rules.map((r) => r.policy)).toEqual(
      expect.arrayContaining(['staff-web', 'web-printers', 'builtin:vpn-dns']),
    );
    // Never stored with the desired state; added at push time.
    expect(JSON.stringify(gateway)).not.toContain('privateKey');

    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);
    const pushed = new Promise<DesiredState>((resolve) =>
      stream.on('data', (env: Envelope) => {
        const decoded = decodeControlPlaneMessage(env);

        if (decoded.ok === true && decoded.message.type === 'desiredState') resolve(decoded.message.payload);
      }),
    );

    stream.on('error', () => undefined);
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));

    try {
      const desired = await Promise.race([
        pushed,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no desired state pushed')), 15_000)),
      ]);
      const [key] = await dataSource.query(`SELECT public_key, private_key FROM lw_vpn_gateway_keys`);

      expect(wireguardPublicKey(desired.network.remoteAccess?.privateKey as string)).toBe(key.public_key);
      expect(key.private_key).not.toBe(desired.network.remoteAccess?.privateKey);
      expect(config.config).toContain(`PublicKey = ${key.public_key}`);

      // Sessions from the active gateway update "last seen"; other nodes are ignored.
      stream.write(
        agentMessage('vpnSessions', {
          sessions: [
            {
              publicKey: laptopKey.publicKey,
              endpoint: '198.51.100.7:40211',
              latestHandshake: Math.floor(Date.now() / 1000),
              rxBytes: 1,
              txBytes: 2,
            },
          ],
        }),
      );
      await waitFor(async () =>
        (await remote.sessions(admin)).some((s) => s.id === enrolled.client.id) ? true : undefined,
      );
      expect(await remote.recordSessions('n2', { sessions: [] })).toBe(false);
    } finally {
      stream.end();
      client.close();
    }

    // Instant revocation by the owner: the gateway drops the peer.
    await remote.revoke(user('alice', ['staff']), enrolled.client.id);
    expect((await state('n1'))?.remoteAccess?.peers.map((p) => p.label)).toEqual(['machine/office-berlin']);
    expect((await remote.list(user('alice', ['staff']), false))[0].status).toBe('revoked');

    const removal = await api('POST', '/plans', {
      documents: documents(false)
        .split('---')
        .filter((d) => d.includes('kind: Cluster'))
        .join('---'),
      delete: [
        { kind: 'Policy', name: 'staff-web' },
        { kind: 'Policy', name: 'web-printers' },
        { kind: 'ClientGroup', name: 'staff' },
        { kind: 'ClientGroup', name: 'quarantine' },
        { kind: 'ClientGroup', name: 'offices' },
        { kind: 'IpPool', name: 'vpn' },
        { kind: 'NodeGroup', name: 'vpn' },
      ],
    });

    expect((await api('POST', `/plans/${removal.json.id}/apply`, {})).json.status).toBe('applied');
    await waitFor(async () => ((await state('n1'))?.remoteAccess ? undefined : true));
  });

  it('manages project access: roles, approvals, cross-project acceptance, quotas and scoped reads', async () => {
    const access = app.get(ProjectAccessService);
    const plans = app.get(PlansService);
    const ids: Record<string, string> = {
      alice: '9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b01',
      oscar: '9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b02',
      bea: '9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b03',
      paula: '9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b04',
    };
    const user = (name: string) =>
      ({
        user: { id: ids[name], email: `${name}@example.test`, roles: [], amr: ['pwd'] },
      }) as unknown as RequestWithUser;
    const doc = (kind: string, name: string, project: string | null, spec: string) =>
      `apiVersion: loadweaver.com/v1\nkind: ${kind}\nmetadata: { name: ${name}${project ? `, project: ${project}` : ''} }\nspec: ${spec}\n`;

    // Cluster admins create projects (with quotas); the creator is recorded.
    const projects = await api('POST', '/plans', {
      documents: [doc('Project', 'alpha', null, "{ quota: { cpu: '1' } }"), doc('Project', 'beta', null, '{}')].join(
        '---\n',
      ),
    });

    expect((await api('POST', `/plans/${projects.json.id}/apply`, {})).json.status).toBe('applied');
    expect((await api('GET', '/projects/alpha/settings')).json).toMatchObject({
      approvalMode: 'developers',
      createdBy: 'api-key',
    });

    for (const [project, name, role] of [
      ['alpha', 'alice', 'developer'],
      ['alpha', 'oscar', 'operator'],
      ['alpha', 'paula', 'admin'],
      ['beta', 'bea', 'operator'],
    ])
      expect((await api('PUT', `/projects/${project}/members/${ids[name]}`, { role })).status).toBe(204);

    // Project admins add operators, developers and viewers, never admins.
    await expect(access.setMember(user('paula'), 'alpha', ids.bea, 'admin')).rejects.toThrow('project creator');
    await access.setMember(user('paula'), 'alpha', ids.bea, 'viewer');

    // The real controller and database memberships: operators manage ordinary secrets, never platform names.
    const secrets = app.get(SecretsController);

    await expect(
      secrets.set('alpha', 'operator-check', { value: 'private-project-value' }, user('oscar')),
    ).resolves.toMatchObject({ version: 1 });
    await expect(secrets.remove('alpha', 'operator-check', user('bea'))).rejects.toMatchObject({ status: 403 });
    await expect(secrets.set('alpha', 'viewer-check', { value: 'private' }, user('bea'))).rejects.toMatchObject({
      status: 403,
    });
    await expect(secrets.set('alpha', 'lw-reserved', { value: 'private' }, user('oscar'))).rejects.toMatchObject({
      status: 403,
    });
    await expect(secrets.remove('alpha', 'lw-reserved', user('oscar'))).rejects.toMatchObject({ status: 403 });
    await secrets.remove('alpha', 'operator-check', user('oscar'));

    await expect(access.setMember(user('oscar'), 'alpha', ids.bea, 'developer')).rejects.toThrow(
      'project admin role required',
    );

    // A developer plans; applying needs an approval from an operator who didn't write the plan.
    const devPlan = await plans.create(
      {
        documents: [
          doc('WorkloadGroup', 'web', 'alpha', '{ selector: { names: [web] } }'),
          doc(
            'Policy',
            'internal',
            'alpha',
            '{ from: [{ group: web }], to: [{ group: web }], rules: [{ ports: [8080] }] }',
          ),
        ].join('---\n'),
      },
      user('alice'),
    );

    expect(devPlan.creatorRoles).toEqual({ alpha: 'developer' });
    await expect(plans.apply(devPlan.id, user('alice'))).rejects.toMatchObject({
      response: { blockers: ["project alpha needs an approval from an operator or admin who didn't create the plan"] },
    });
    await expect(plans.approve(devPlan.id, user('alice'))).rejects.toThrow('not the plan author');
    expect((await plans.approve(devPlan.id, user('oscar'))).approvals).toEqual([
      expect.objectContaining({ project: 'alpha', userId: ids.oscar }),
    ]);
    expect((await plans.apply(devPlan.id, user('alice'))).status).toBe('applied');
    // Viewers and non-members can't plan.
    await expect(
      plans.create({ documents: doc('WorkloadGroup', 'x', 'alpha', '{ selector: { names: [x] } }') }, user('bea')),
    ).rejects.toThrow('developer role or higher');

    // Cross-project: only exposed groups, and the other project accepts exactly this policy.
    const exposed = await plans.create(
      { documents: doc('WorkloadGroup', 'db', 'beta', '{ selector: { names: [db] }, exposed: true }') },
      user('bea'),
    );

    expect((await plans.apply(exposed.id, user('bea'))).status).toBe('applied');
    await expect(
      plans.create(
        {
          documents: doc(
            'Policy',
            'to-api',
            'alpha',
            '{ from: [{ group: web }], to: [{ group: api, project: beta }], rules: [{ ports: [80] }] }',
          ),
        },
        user('oscar'),
      ),
    ).rejects.toMatchObject({
      response: {
        issues: [expect.objectContaining({ message: 'Policy alpha/to-api: group beta/api does not exist' })],
      },
    });

    const toDb = await plans.create(
      {
        documents: doc(
          'Policy',
          'to-db',
          'alpha',
          '{ from: [{ group: web }], to: [{ group: db, project: beta }], rules: [{ ports: [5432] }] }',
        ),
      },
      user('oscar'),
    );

    await expect(plans.apply(toDb.id, user('oscar'))).rejects.toMatchObject({
      response: { blockers: ['Policy alpha/to-db reaches project beta, which has to accept it first'] },
    });

    const [request] = await access.requests(user('bea'), 'beta');

    expect(request).toMatchObject({ project: 'alpha', policy: 'to-db', planId: toDb.id, accepted: false });
    await expect(access.accept(user('alice'), 'beta', request)).rejects.toThrow('accepting project');
    await access.accept(user('bea'), 'beta', request);
    expect((await plans.apply(toDb.id, user('oscar'))).status).toBe('applied');

    // Quotas: 3 × 0.5 CPU in a project limited to 1 CPU.
    await expect(
      plans.create(
        {
          documents: doc(
            'Deployment',
            'busy',
            'alpha',
            `{ compose: "services:\\n  web:\\n    image: nginx@sha256:${'3'.repeat(64)}\\n    deploy: { resources: { reservations: { cpus: '0.5' } } }\\n    x-loadweaver: { replicas: 3 }\\n" }`,
          ),
        },
        user('oscar'),
      ),
    ).rejects.toMatchObject({
      response: { issues: [expect.objectContaining({ message: 'project alpha: CPU 1.5 exceeds the quota of 1' })] },
    });

    // Reads are scoped: alice sees alpha's resources and plans only.
    const listed = (await app.get(ResourcesController).list(undefined, user('alice'))).map(
      (r) => `${r.kind}/${r.metadata.project ?? ''}/${r.metadata.name}`,
    );

    expect(listed.every((r) => r.split('/')[1] === 'alpha')).toBe(true);
    expect(listed).toEqual(expect.arrayContaining(['WorkloadGroup/alpha/web', 'Policy/alpha/to-db']));
    expect((await plans.list(user('alice'))).some((p) => p.id === exposed.id)).toBe(false);
    await expect(plans.get(exposed.id, user('alice'))).rejects.toThrow('plan not found');

    // Access as YAML: exported, and imported to match exactly (here: alice removed from alpha).
    const yaml = await access.exportAccess({ apiKeyAuthenticated: true } as unknown as RequestWithUser);

    expect(yaml).toContain(ids.alice);
    expect(
      (
        await access.importAccess(
          { apiKeyAuthenticated: true } as unknown as RequestWithUser,
          yaml.replace(new RegExp(`\\s+- userId: ${ids.alice}\\n\\s+role: developer`), ''),
        )
      ).changed,
    ).toBe(1);
    expect((await access.members(user('oscar'), 'alpha')).map((m) => m.userId)).not.toContain(ids.alice);

    // Every change above is in the audit chain.
    const actions = (
      await app
        .get(DataSource)
        .query(
          `SELECT action FROM lw_audit_events WHERE action LIKE 'project.%' OR action LIKE 'plan.approve' OR action = 'access.import'`,
        )
    ).map((r: { action: string }) => r.action);

    expect(actions).toEqual(
      expect.arrayContaining(['project.member.set', 'plan.approve', 'project.policy.accept', 'access.import']),
    );
  });

  it('tracks applies: progress, automatic rollback, failed rollbacks with locks and a fix-forward, cancel, drift', async () => {
    const dataSource = app.get(DataSource);
    const plans = app.get(PlansService);
    const admin = { apiKeyAuthenticated: true } as unknown as RequestWithUser;
    // A simulated n1 agent whose answer to each desired state is chosen by the test.
    let answer: (revision: number) => 'applied' | 'rolled-back' | null = () => 'applied';
    const { client, stream } = openAgentStream(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);

    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok !== true || decoded.message.type !== 'desiredState' || stream.writableEnded) return;

      const revision = decoded.message.payload.revision;
      const status = answer(revision);

      if (status)
        stream.write(
          agentMessage('applyReport', {
            revision,
            status,
            steps: [{ layer: 'filtering', status: status === 'applied' ? 'applied' : 'failed' }],
            ...(status === 'applied' ? {} : { error: 'nft: syntax error' }),
          }),
        );
    });
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));
    await new Promise((r) => setTimeout(r, 500));

    const policy = (port: number) =>
      `apiVersion: loadweaver.com/v1\nkind: NodeGroup\nmetadata: { name: track-a }\nspec: { selector: { names: [n1] } }\n---\napiVersion: loadweaver.com/v1\nkind: NodeGroup\nmetadata: { name: track-b }\nspec: { selector: { names: [n2] } }\n---\napiVersion: loadweaver.com/v1\nkind: Policy\nmetadata: { name: track }\nspec: { from: [{ group: track-a }], to: [{ group: track-b }], rules: [{ ports: [${port}] }] }\n`;
    const live = io(`${baseUrl}/socket/plans`, {
      transports: ['websocket'],
      auth: { Authorization: `Bearer ${API_KEY}` },
    });
    const patches: { id: string; status: string; percent?: number }[] = [];

    live.on('planPatch', ({ plan }: { plan: { id: string; status: string; progress: { percent: number } | null } }) =>
      patches.push({ id: plan.id, status: plan.status, percent: plan.progress?.percent }),
    );

    try {
      const snapshot = await new Promise<{ plans: unknown[] }>((resolve) => live.once('plansSnapshot', resolve));

      expect(Array.isArray(snapshot.plans)).toBe(true);

      // 1. Converges: n1 reports the revision, the plan is applied and its locks are gone.
      const ok = await plans.create({ documents: policy(9001) }, admin);
      const applied = await plans.apply(ok.id, admin);

      expect(applied.status).toBe('applied');
      expect(applied.progress).toMatchObject({ phase: 'apply', percent: 100, nodes: { n1: { state: 'applied' } } });
      expect(await dataSource.query(`SELECT * FROM lw_resource_locks WHERE plan_id = $1`, [ok.id])).toEqual([]);
      await waitFor(async () => (patches.some((p) => p.id === ok.id && p.status === 'applied') ? true : undefined));

      // 2. n1 fails the change (and applies the rollback): rolled back to the previous version automatically.
      let failNext = false;

      answer = () => {
        if (!failNext) return 'applied';

        failNext = false;

        return 'rolled-back';
      };

      const bad = await plans.create({ documents: policy(9002) }, admin);

      failNext = true;
      await plans.apply(bad.id, admin);

      const rolled = await waitFor(async () => {
        const plan = await plans.get(bad.id, admin);

        return ['rolled-back', 'rollback-failed'].includes(plan.status) ? plan : undefined;
      }, 30_000);

      expect(rolled.status).toBe('rolled-back');
      expect(rolled.error).toContain('n1: nft: syntax error');
      expect((await app.get(ResourceStoreService).get('Policy', 'track', null))?.spec.rules[0].ports).toEqual([9001]);

      // 3. The rollback fails too: the plan stays inconsistent, keeps its locks, and a fix-forward is proposed.
      answer = () => 'rolled-back';

      const worse = await plans.create({ documents: policy(9003) }, admin);

      await plans.apply(worse.id, admin).catch(() => undefined);

      const stuck = await waitFor(async () => {
        const plan = await plans.get(worse.id, admin);

        return plan.status === 'rollback-failed' ? plan : undefined;
      }, 30_000);
      const drift = await app.get(DriftService).report(admin);
      const fix = drift.inconsistent.find((i) => i.planId === stuck.id)?.fixForward as string;

      expect(fix).toBeTruthy();
      expect(
        (await dataSource.query(`SELECT scope FROM lw_resource_locks WHERE plan_id = $1`, [worse.id])).length,
      ).toBeGreaterThan(0);

      // Nothing else may touch those resources ...
      answer = () => 'applied';

      const blocked = await plans.create({ documents: policy(9004) }, admin);

      await expect(plans.apply(blocked.id, admin)).rejects.toMatchObject({
        response: { locks: expect.arrayContaining([`Policy//track (plan ${worse.id})`]) },
      });
      await plans.discard(blocked.id, admin);

      // ... except the fix-forward, which resolves the failed plan.
      expect((await plans.get(fix, admin)).resolves).toBe(worse.id);
      expect((await plans.apply(fix, admin)).status).toBe('applied');
      expect((await plans.get(worse.id, admin)).status).toBe('failed');
      expect(await dataSource.query(`SELECT * FROM lw_resource_locks`)).toEqual([]);

      // 4. Cancel: the node doesn't answer, the operator cancels, the change is rolled back.
      answer = () => null;

      const slow = await plans.create({ documents: policy(9005) }, admin);
      const pending = await plans.apply(slow.id, admin);

      expect(pending.status).toBe('applying');
      expect(pending.progress?.step).toContain('waiting for n1');
      answer = () => 'applied';
      await plans.cancel(slow.id, admin);

      expect(
        (
          await waitFor(async () => {
            const plan = await plans.get(slow.id, admin);

            return plan.status === 'rolled-back' ? plan : undefined;
          }, 30_000)
        ).error,
      ).toBe('cancelled');

      // 5. Drift: a container started outside Loadweaver is reported and can become a proposed plan.
      stream.write(
        agentMessage('heartbeat', {
          appliedRevision: 0,
          usage: { cpuMillis: 0, memoryBytes: 0, diskBytes: 0 },
          at: new Date().toISOString(),
          foreign: {
            containers: [
              {
                id: 'abcdef1234567890',
                name: 'legacy-web',
                image: `nginx@sha256:${'4'.repeat(64)}`,
                state: 'running',
                ports: ['0.0.0.0:8088->80/tcp'],
              },
            ],
          },
        }),
      );

      const reported = await waitFor(async () => {
        const report = await app.get(DriftService).report(admin);

        return report.containers.find((c) => c.name === 'legacy-web');
      });

      expect(reported).toMatchObject({ node: 'n1', ports: ['0.0.0.0:8088->80/tcp'] });

      // The simulated nodes only heartbeat when a test talks to them: keep them reachable for the re-plan (30 s timeout).
      await dataSource.query(`UPDATE lw_nodes SET last_seen_at = now() WHERE lifecycle <> 'left'`);

      const proposal = await app
        .get(DriftService)
        .propose(admin, { node: 'n1', container: 'abcdef123456', project: 'shop', deployment: 'legacy' })
        .catch((error: { response?: unknown; message: string }) => {
          throw new Error(`drift proposal rejected: ${JSON.stringify(error.response ?? error.message)}`);
        });
      const compose = (proposal.changes[0].after as { spec: { compose: string } }).spec.compose;

      expect(compose).toContain(`image: nginx@sha256:${'4'.repeat(64)}`);
      expect(compose).toContain('8088:80/tcp');
      await plans.discard(proposal.id, admin);

      const removal = await plans.create(
        {
          delete: [
            { kind: 'Policy', name: 'track' },
            { kind: 'NodeGroup', name: 'track-a' },
            { kind: 'NodeGroup', name: 'track-b' },
          ],
        },
        admin,
      );

      expect((await plans.apply(removal.id, admin)).status).toBe('applied');
    } finally {
      live.close();
      stream.end();
      client.close();
    }
  });

  it('rejects an agent whose node has left, and keeps the audit chain intact and append-only', async () => {
    expect((await api('POST', '/nodes/n2/leave')).json.lifecycle).toBe('left');

    // The removed node's certificate is still cryptographically valid, but its identity is revoked.
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n2Credentials);
    const failure = new Promise<{ code: number }>((resolve) => stream.on('error', (e: { code: number }) => resolve(e)));
    const messages: Envelope[] = [];

    stream.on('data', (env: Envelope) => messages.push(env));
    stream.write(agentMessage('hello', hello('n2', WG_KEYS[1])));

    expect((await failure).code).toBe(16); // UNAUTHENTICATED
    expect(messages).toEqual([]);
    client.close();

    const verification = await api('GET', '/cluster/audit/verify');

    expect(verification.json.ok).toBe(true);
    expect(verification.json.checked).toBeGreaterThan(5);

    const dataSource = app.get(DataSource);

    await expect(dataSource.query(`UPDATE lw_audit_events SET action = 'x'`)).rejects.toThrow('append-only');
    await expect(dataSource.query(`DELETE FROM lw_audit_events`)).rejects.toThrow('append-only');
  });

  it('alerts: custom and built-in rules, pending → firing → resolved, webhooks, silences, maintenance, acknowledgement', async () => {
    const dataSource = app.get(DataSource);
    const alerts = app.get(AlertService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- webhook envelopes are arbitrary JSON
    const received: any[] = [];
    const server = createHttpServer((req, res) => {
      let body = '';

      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    // The service's own 30 s tick may hold the lock for a moment.
    const tick = async (at: Date) => await waitFor(async () => ((await alerts.tick(at)) ? true : undefined));
    const open = async (rule: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- alert DTOs from the API
      ((await api('GET', '/alerts?state=all')).json as any[]).filter((a) => a.rule === rule);
    const t0 = Date.now();

    try {
      const hook = await api('POST', '/admin/webhooks', {
        name: 'alerts',
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`,
        httpMethod: 'POST',
        subscribedEvents: ['alert.firing', 'alert.resolved', 'alert.acknowledged'],
        authType: 'none',
      });

      expect(hook.status).toBe(201);

      // Node down, silenced from the start: it fires quietly and is sent once the silence ends.
      const [{ name: node }] = await dataSource.query(
        `SELECT name FROM lw_nodes WHERE lifecycle = 'active' ORDER BY name LIMIT 1`,
      );

      await dataSource.query(
        `UPDATE lw_nodes SET connected = false, last_seen_at = now() - INTERVAL '10 minutes' WHERE name = $1`,
        [node],
      );

      expect(
        (await api('POST', '/alerts/silences', { reason: 'no fields', endsAt: new Date(t0 + 3_600_000).toISOString() }))
          .status,
      ).toBe(400);

      const silence = await api('POST', '/alerts/silences', {
        rule: 'builtin:node-*',
        key: node,
        reason: 'hardware swap',
        endsAt: new Date(t0 + 3_600_000).toISOString(),
      });

      expect(silence.status).toBe(201);

      // A custom rule is a policy: plan / apply.
      const plan = await api('POST', '/plans', {
        documents: `
apiVersion: loadweaver.com/v1
kind: AlertRule
metadata: { name: hot-cpu }
spec:
  severity: critical
  condition:
    metric: { name: node.cpu_cores, groupBy: node, op: '>', threshold: 3, over: 5m }
  for: 1m
  repeatEvery: 1h
`,
      });

      expect(plan.status).toBe(201);
      expect((await api('POST', `/plans/${plan.json.id}/apply`)).json.status).toBe('applied');

      await dataSource.query(
        `INSERT INTO lw_metrics ("time", metric, node, entity, value) VALUES (now(), 'node.cpu_cores', 'n1', 'node', 3.5)`,
      );

      await tick(new Date(t0));
      expect(await open('rule:_/hot-cpu')).toEqual([
        expect.objectContaining({ key: 'n1', state: 'pending', severity: 'critical', value: 3.5 }),
      ]);

      await tick(new Date(t0 + 61_000));

      const [firing] = await open('rule:_/hot-cpu');

      expect(firing).toMatchObject({ state: 'firing', silenced: false });
      await waitFor(async () =>
        received.find((e) => e.type === 'alert.firing' && e.data?.object?.rule === 'rule:_/hot-cpu') ? true : undefined,
      );

      // Acknowledged alerts stop repeating.
      const acknowledged = await api('POST', `/alerts/${firing.id}/acknowledge`);

      expect(acknowledged.status).toBe(200);
      expect(acknowledged.json.acknowledgedBy).toBeTruthy();
      await waitFor(async () => (received.find((e) => e.type === 'alert.acknowledged') ? true : undefined));

      expect((await open('builtin:node-down')).find((a) => a.key === node)).toMatchObject({
        state: 'firing',
        silenced: true,
      });
      expect(
        received.some(
          (e) =>
            e.type === 'alert.firing' && e.data?.object?.rule === 'builtin:node-down' && e.data?.object?.key === node,
        ),
      ).toBe(false);

      expect((await api('DELETE', `/alerts/silences/${silence.json.id}`)).status).toBe(204);
      await tick(new Date(t0 + 122_000));
      await waitFor(async () =>
        received.find(
          (e) =>
            e.type === 'alert.firing' && e.data?.object?.rule === 'builtin:node-down' && e.data?.object?.key === node,
        )
          ? true
          : undefined,
      );

      // Planned drains are maintenance: findings on draining nodes are silenced automatically.
      await dataSource.query(`UPDATE lw_nodes SET lifecycle = 'draining' WHERE name = $1`, [node]);
      await tick(new Date(t0 + 183_000));
      expect((await open('builtin:node-down')).find((a) => a.key === node)).toMatchObject({ silenced: true });
      await dataSource.query(
        `UPDATE lw_nodes SET lifecycle = 'active', connected = true, last_seen_at = $2 WHERE name = $1`,
        [node, new Date(t0 + 240_000)],
      );

      // Gone findings resolve, and only what was sent announces its resolution.
      await dataSource.query(`DELETE FROM lw_metrics WHERE metric = 'node.cpu_cores'`);
      await tick(new Date(t0 + 244_000));
      expect((await open('rule:_/hot-cpu'))[0]).toMatchObject({ state: 'resolved' });
      expect((await open('builtin:node-down')).find((a) => a.key === node)).toMatchObject({ state: 'resolved' });
      // No agent stream is behind it: back to disconnected, so later applies don't wait for its report.
      await dataSource.query(`UPDATE lw_nodes SET connected = false WHERE name = $1`, [node]);
      await waitFor(async () =>
        received.find((e) => e.type === 'alert.resolved' && e.data?.object?.rule === 'rule:_/hot-cpu')
          ? true
          : undefined,
      );
      expect((await api('GET', '/alerts')).json.find((a: { id: string }) => a.id === firing.id)).toBeUndefined();

      // Acknowledging needs a firing alert; unknown ids are 404.
      expect((await api('POST', `/alerts/${firing.id}/acknowledge`)).status).toBe(400);
      expect((await api('POST', `/alerts/${randomUUID()}/acknowledge`)).status).toBe(404);
      expect((await api('GET', `/alerts/${firing.id}`)).json).toMatchObject({ id: firing.id });
      expect((await api('GET', `/alerts/${randomUUID()}`)).status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('exports: scoped audit search and export, Prometheus text, anchors and SIEM status in the API', async () => {
    const audit = await api('GET', '/audit?action=plan.*&limit=5');

    expect(audit.status).toBe(200);
    expect(audit.json.entries.length).toBeGreaterThan(0);
    audit.json.entries.forEach((e: { action: string }) => expect(e.action.startsWith('plan.')).toBe(true));
    expect((await api('GET', '/audit?before=abc')).status).toBe(400);

    const csv = await fetch(`${baseUrl}/api/audit/export?format=csv&action=alert.*`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(csv.status).toBe(200);
    expect((await csv.text()).split('\n')[0]).toBe(
      'seq,at,actorType,actorId,actorEmail,action,target,project,details,hash',
    );

    await app
      .get(DataSource)
      .query(
        `INSERT INTO lw_metrics ("time", metric, node, entity, value) VALUES (now(), 'node.memory_bytes', 'n1', 'node', 1024)`,
      );

    const prometheus = await fetch(`${baseUrl}/api/metrics/prometheus`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(prometheus.headers.get('content-type')).toContain('version=0.0.4');
    expect(await prometheus.text()).toContain('loadweaver_node_memory_bytes{node="n1",entity="node"} 1024 ');

    const alerts = await fetch(`${baseUrl}/api/alerts/export?format=csv`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(await alerts.text()).toContain('"rule:_/hot-cpu"');

    // Dashboards are resources; their widgets run through the query builder.
    const dashboard = await api('POST', '/plans', {
      documents: `
apiVersion: loadweaver.com/v1
kind: Dashboard
metadata: { name: capacity }
spec:
  title: Capacity
  widgets:
    - { title: Memory, type: line, query: { metrics: { metric: node.memory_bytes, groupBy: node } } }
    - { title: Denied, type: table, x: 6, query: { flows: { decision: denied } } }
`,
    });

    expect(dashboard.status).toBe(201);
    expect((await api('POST', `/plans/${dashboard.json.id}/apply`)).json.status).toBe('applied');
    expect(
      (
        await api('POST', '/plans', {
          documents: `apiVersion: loadweaver.com/v1\nkind: Dashboard\nmetadata: { name: bad }\nspec: { title: Bad, widgets: [{ title: W, type: logs, query: { metrics: { metric: node.memory_bytes } } }] }\n`,
        })
      ).status,
    ).toBe(400);

    const widget = (await api('GET', '/resources/Dashboard/capacity')).json.spec.widgets[0];
    const series = await api('POST', '/dashboards/query', { query: widget.query });

    expect(series.status).toBe(200);
    expect(series.json).toMatchObject({ kind: 'series', step: '10 seconds' });
    expect(series.json.series.find((s: { key: string }) => s.key === 'n1').points.at(-1)[1]).toBe(1024);
    expect((await api('POST', '/dashboards/query', { query: { flows: { decision: 'denied' } } })).json).toEqual({
      kind: 'flows',
      rows: [],
    });
    expect((await api('POST', '/dashboards/query', { query: { sql: 'SELECT 1' } })).status).toBe(400);

    // Grafana's SimpleJSON protocol on the same data.
    expect((await api('POST', '/grafana/search', {})).json).toContain('node.memory_bytes');

    const grafana = await api('POST', '/grafana/query', {
      range: { from: new Date(Date.now() - 600_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() },
      targets: [{ target: 'node.memory_bytes', payload: { groupBy: 'node' } }],
    });

    expect(grafana.json.find((t: { target: string }) => t.target === 'node.memory_bytes n1').datapoints.at(-1)[0]).toBe(
      1024,
    );

    // Without a log store there are no anchors to compare; the chain itself verifies.
    expect((await api('GET', '/cluster/audit/verify')).json).toMatchObject({
      ok: true,
      anchors: { available: false, checked: 0, mismatched: [] },
    });
    expect((await api('GET', '/cluster/siem')).json).toEqual([]);
  });

  it('health: explained tree with roll-ups, state-change events, history, overview headline and inbox, scoped', async () => {
    const dataSource = app.get(DataSource);
    const health = app.get(HealthService);
    const overview = app.get(OverviewService);
    const bea = {
      user: { id: '9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b03', email: 'bea@example.test', roles: [], amr: ['pwd'] },
    } as unknown as RequestWithUser;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- health DTOs from the API
    const entity = async (key: string) => ((await api('GET', '/health/tree')).json as any[]).find((e) => e.key === key);
    const [{ name: node }] = await dataSource.query(
      `SELECT name FROM lw_nodes WHERE lifecycle = 'active' AND NOT witness ORDER BY name LIMIT 1`,
    );

    // All active nodes report; the tree is evaluated.
    await dataSource.query(`UPDATE lw_nodes SET connected = true, last_seen_at = now() WHERE lifecycle <> 'left'`);
    await waitFor(async () => ((await health.tick()) ? true : undefined));
    expect(await entity(`node/${node}`)).toMatchObject({
      kind: 'node',
      state: 'healthy',
      parent: expect.stringMatching(/^site\//),
    });
    expect(await entity('cluster')).toBeDefined();

    // The node goes down: its replicas fail, the parents roll up with reasons, and the change is an event.
    await dataSource.query(`UPDATE lw_nodes SET connected = false WHERE name = $1`, [node]);
    await waitFor(async () => ((await health.tick()) ? true : undefined));

    const down = await entity(`node/${node}`);

    expect(down).toMatchObject({ state: 'failed', reasons: [{ code: 'node-down' }] });

    const cluster = await entity('cluster');

    expect(['degraded', 'at-risk', 'failed']).toContain(cluster.state);
    expect(cluster.reasons.length).toBeGreaterThan(0);

    const subtree = (await api('GET', `/health/tree?root=${encodeURIComponent(down.parent)}`)).json;

    expect(subtree[0].key).toBe(down.parent);
    expect(subtree.map((e: { key: string }) => e.key)).toContain(`node/${node}`);

    const history = (await api('GET', `/health/history?key=${encodeURIComponent(`node/${node}`)}`)).json;

    expect(history.changes.at(-1)).toMatchObject({ to: 'failed' });
    expect(history.durations.failed).toBeGreaterThanOrEqual(0);

    // The overview: headline with a reason, inbox items linking to where they are resolved.
    const view = (await api('GET', '/overview')).json;

    expect(view.headline.state).toBe(cluster.state);
    expect(view.headline.message).toContain(cluster.reasons[0].message);
    expect(
      view.inbox.some((i: { kind: string; link: string }) => i.kind === 'health' && i.link.startsWith('/health/')),
    ).toBe(true);
    expect(view.summary.nodes.total).toBeGreaterThan(0);
    // No service here defines an SLO.
    expect(view.summary.slos).toEqual({ total: 0, ok: 0, burning: 0, exhausted: 0 });
    expect((await api('GET', '/slos')).json).toEqual([]);
    expect(view.activity.some((e: { kind: string }) => e.kind === 'health')).toBe(true);

    // Project members see their projects only: no cluster, site or node entities.
    const scoped = await health.tree(bea);

    expect(scoped.every((e) => e.project === 'alpha' || e.project === 'beta')).toBe(true);
    expect((await overview.overview(bea)).summary.capacity).toBeNull();
    await expect(overview.overview(bea, 'other')).rejects.toThrow('project not found');

    await dataSource.query(`UPDATE lw_nodes SET connected = false WHERE lifecycle <> 'left'`);
  });

  it('status pages: a public page per hostname through the ingress, incident notes, nothing internal', async () => {
    const dataSource = app.get(DataSource);
    const [{ project, deployment, service }] = await dataSource.query(
      `SELECT project, deployment, service FROM lw_workload_placements WHERE cron_run IS NULL ORDER BY id LIMIT 1`,
    );
    const host = `status.${project}.example.test`;
    // Requests as the ingress forwards them: the page's hostname in Host, `/` rewritten to the API path.
    const get = (path: string, hostname = host) =>
      new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
        const url = new URL(`${baseUrl}${path}`);
        const req = httpGet(
          { host: url.hostname, port: url.port, path: url.pathname, headers: { host: hostname } },
          (res) => {
            let body = '';

            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
          },
        );

        req.on('error', reject);
      });

    const plan = await api('POST', '/plans', {
      documents: `apiVersion: loadweaver.com/v1
kind: StatusPage
metadata: { name: public, project: ${project} }
spec:
  host: ${host}
  title: Shop status
  services: [{ service: ${deployment}/${service}, name: Checkout }]
`,
    });

    expect(plan.status).toBe(201);
    expect((await api('POST', `/plans/${plan.json.id}/apply`)).json.status).toBe('applied');

    // Every ingress node routes the hostname to the API on the members.
    const states: {
      state: {
        ingress?: { sites: { host: string; routes: unknown[] }[]; upstreams: { name: string; endpoints: unknown[] }[] };
      };
    }[] = await dataSource.query(
      `SELECT d.state FROM lw_node_desired_states d JOIN lw_nodes n ON n.name = d.node_name WHERE n.lifecycle <> 'left'`,
    );
    const ingress = states.map((s) => s.state.ingress).filter((i) => !!i);

    expect(ingress.length).toBeGreaterThan(0);

    for (const i of ingress) {
      expect(i?.sites.find((x) => x.host === host)?.routes).toEqual([
        { prefix: '/', upstream: 'lw/_platform/status:3400', rewrite: '/api/public/status/' },
      ]);
      expect(i?.upstreams.find((u) => u.name === 'lw/_platform/status:3400')?.endpoints.length).toBeGreaterThan(0);
    }

    // Incident notes by operators.
    const incident = await api('POST', `/projects/${project}/incidents`, {
      title: 'Slow checkout',
      status: 'investigating',
      message: 'Payments take long <b>sometimes</b>',
    });

    expect(incident.status).toBe(201);
    expect(
      (
        await api('PUT', `/projects/${project}/incidents/${incident.json.id}`, {
          status: 'resolved',
          message: 'Fixed.',
        })
      ).json,
    ).toMatchObject({
      status: 'resolved',
      updates: [{ status: 'investigating' }, { status: 'resolved', message: 'Fixed.' }],
    });
    expect(
      (await api('POST', `/projects/${project}/incidents`, { title: 'x', status: 'unknown', message: 'y' })).status,
    ).toBe(400);

    // The public page: no login, no internals.
    const json = await get('/api/public/status/status.json');

    expect(json.status).toBe(200);

    const status = JSON.parse(json.body);

    expect(status).toMatchObject({ title: 'Shop status', services: [{ name: 'Checkout' }] });
    expect(['operational', 'degraded', 'outage', 'unknown']).toContain(status.services[0].status);
    expect(status.incidents[0]).toMatchObject({ title: 'Slow checkout', status: 'resolved' });
    expect(json.body).not.toContain(`${deployment}/${service}`);
    expect(json.body).not.toMatch(/node|reason|createdBy|"by"/);

    const page = await get('/api/public/status/');

    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.body).toContain('<h1>Shop status</h1>');
    expect(page.body).toContain('Payments take long &lt;b&gt;sometimes&lt;/b&gt;');
    expect((await get('/api/public/status/', 'nothing.example.test')).status).toBe(404);

    // A hostname belongs to one owner.
    const [exposed] = await dataSource.query(
      `SELECT s->>'host' AS host FROM lw_node_desired_states, jsonb_array_elements(state->'ingress'->'sites') s
       WHERE s->>'host' <> $1 LIMIT 1`,
      [host],
    );

    if (exposed)
      expect(
        (
          await api('POST', '/plans', {
            documents: `apiVersion: loadweaver.com/v1\nkind: StatusPage\nmetadata: { name: clash, project: ${project} }\nspec: { host: ${exposed.host}, title: X, services: [{ service: ${deployment}/${service}, name: X }] }\n`,
          })
        ).status,
      ).toBe(400);
  });

  it('search: every entity scoped by access, favourites and recent items first, command palette actions', async () => {
    const dataSource = app.get(DataSource);
    const [{ name: node }] = await dataSource.query(`SELECT name FROM lw_nodes WHERE lifecycle = 'active' LIMIT 1`);
    const search = async (q: string) => (await api('GET', `/search?q=${encodeURIComponent(q)}`)).json;

    // Without a log store, the same documents are matched in memory.
    const nodes = await search(node);

    expect(nodes.results.map((r: { id: string }) => r.id)).toContain(`Node:${node}`);

    const all = await search('status');

    expect(all.results.some((r: { kind: string }) => r.kind === 'StatusPage')).toBe(true);

    // Favourites first, then recent items.
    const target = all.results.at(-1).id;

    expect((await api('PUT', `/search/favorites/${encodeURIComponent(target)}`)).status).toBe(204);
    expect((await search('status')).results[0]).toMatchObject({ id: target, favourite: true });
    expect((await api('GET', '/search/favorites')).json).toEqual([target]);
    expect((await api('DELETE', `/search/favorites/${encodeURIComponent(target)}`)).status).toBe(204);
    expect((await api('POST', '/search/recent', { item: target })).status).toBe(204);
    expect((await search('status')).results[0].id).toBe(target);
    expect((await api('POST', '/search/recent', { item: 'not an item' })).status).toBe(400);

    // Actions for what the caller may do.
    expect((await search(`drain ${node}`)).actions).toContainEqual({
      title: `Drain node ${node}`,
      kind: 'api',
      request: { method: 'POST', path: `/nodes/${node}/drain` },
    });

    // Project members find their projects' entities only.
    const bea = {
      user: { id: '9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b03', email: 'bea@example.test', roles: [], amr: ['pwd'] },
    } as unknown as RequestWithUser;
    const scoped = await app.get(SearchService).search(bea, node);

    expect(scoped.results.some((r) => r.kind === 'Node')).toBe(false);
    expect(scoped.actions).toEqual([]);
    expect((await api('GET', '/search?q=')).status).toBe(400);
  });

  it('wallboard: read-only tokens that open only the kiosk view, cluster-wide or per project, revocable', async () => {
    const wallboards = app.get(WallboardService);
    const kiosk = async (token?: string) => {
      const res = await fetch(`${baseUrl}/api/public/wallboard`, {
        headers: token ? { authorization: `Wallboard ${token}` } : {},
      });

      return { status: res.status, json: res.status === 200 ? await res.json() : null };
    };
    const user = (id: string) =>
      ({ user: { id, email: `${id}@example.test`, roles: [], amr: ['pwd'] } }) as unknown as RequestWithUser;
    const paula = user('9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b04');
    const bea = user('9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b03');

    // Cluster-wide by a cluster admin; shown once.
    const cluster = await api('POST', '/wallboards', { name: 'NOC screen', expiresInDays: 30 });

    expect(cluster.status).toBe(201);
    expect(cluster.json.token).toMatch(/^lw_wb_[A-Za-z0-9_-]{43}$/);
    expect(
      (await api('GET', '/wallboards')).json.find((t: { id: string }) => t.id === cluster.json.id),
    ).not.toHaveProperty('token');

    const view = await kiosk(cluster.json.token);

    expect(view.status).toBe(200);
    expect(view.json.sections[0]).toMatchObject({ scope: 'cluster', headline: { state: expect.any(String) } });
    expect(view.json.sections.length).toBeGreaterThan(1);

    // Only the kiosk view: the token is no API credential.
    expect(
      (await fetch(`${baseUrl}/api/overview`, { headers: { authorization: `Bearer ${cluster.json.token}` } })).status,
    ).toBe(401);
    expect((await kiosk()).status).toBe(401);
    expect((await kiosk(`lw_wb_${'x'.repeat(43)}`)).status).toBe(401);

    // Project admins for their project; operators can't.
    const project = await wallboards.create(paula, { name: 'Team alpha', projects: ['alpha'] });

    await expect(wallboards.create(bea, { name: 'x', projects: ['beta'] })).rejects.toThrow(
      'project admin role required',
    );
    await expect(wallboards.create(paula, { name: 'x' })).rejects.toThrow('cluster admin role required');

    const scoped = await kiosk(project.token);

    expect(scoped.json.sections.map((s: { scope: string }) => s.scope)).toEqual(['alpha']);
    expect(scoped.json.sections[0].summary.capacity).toBeNull();

    // Revoked tokens stop working at once.
    await wallboards.revoke(paula, project.id);
    expect((await kiosk(project.token)).status).toBe(401);
    expect((await api('DELETE', `/wallboards/${cluster.json.id}`)).status).toBe(204);
    expect((await kiosk(cluster.json.token)).status).toBe(401);
  });

  it('reports: monthly per cluster and project, stored as files, browsed as a tree, downloaded or zipped, scoped', async () => {
    const reports = app.get(ReportsService);
    const dataSource = app.get(DataSource);
    const now = new Date();
    const last =
      now.getUTCMonth() === 0
        ? { year: now.getUTCFullYear() - 1, month: 12 }
        : { year: now.getUTCFullYear(), month: now.getUTCMonth() };
    const mm = String(last.month).padStart(2, '0');
    const [{ project }] = await dataSource.query(`SELECT project FROM lw_workload_placements ORDER BY id LIMIT 1`);

    // The unit job; a second run without force is skipped (idempotent).
    expect(await reports.generate({ scope: 'cluster', ...last, triggeredBy: 'test' })).toMatchObject({
      status: 'completed',
    });
    expect(await reports.generate({ scope: 'cluster', ...last, triggeredBy: 'test' })).toBeNull();

    // On demand, through the queue and its worker.
    expect((await api('POST', '/reports/run', { scope: project, ...last })).status).toBe(202);
    expect(
      (await api('POST', '/reports/run', { scope: project, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }))
        .status,
    ).toBe(400);
    await waitFor(
      async () =>
        (await api('GET', '/reports')).json.some(
          (r: { scope: string; status: string }) => r.scope === project && r.status === 'completed',
        )
          ? true
          : undefined,
      30_000,
    );

    // The tree from the database.
    expect((await api('GET', '/reports/files')).json.map((e: { name: string }) => e.name)).toEqual([
      'cluster',
      'projects',
    ]);
    expect((await api('GET', `/reports/files?path=cluster/${last.year}/${mm}`)).json).toEqual([
      expect.objectContaining({ name: 'report.html', type: 'file' }),
      expect.objectContaining({ name: 'report.json', type: 'file' }),
    ]);

    const json = await fetch(`${baseUrl}/api/reports/files/download?path=cluster/${last.year}/${mm}/report.json`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(json.headers.get('content-disposition')).toBe('attachment; filename="report.json"');

    const data = await json.json();

    expect(data).toMatchObject({
      scope: 'cluster',
      period: { year: last.year, month: last.month },
      notYet: ['upgrades'],
      backups: { backups: 0, failedBackups: 0, restoreTests: 0, failedRestoreTests: 0 },
    });
    expect(data.capacity.capacityBytes).toBeGreaterThan(0);

    const zip = await fetch(`${baseUrl}/api/reports/files/archive?path=projects/${project}`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    const bytes = Buffer.from(await zip.arrayBuffer());

    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(bytes.toString('latin1')).toContain(`${last.year}/${mm}/report.html`);
    expect((await api('GET', '/reports/files/download?path=../secrets')).status).toBe(400);
    expect((await api('GET', '/reports/files/download?path=cluster/nope.html')).status).toBe(404);

    // Project members see their project's reports, never the cluster's.
    const bea = {
      user: { id: '9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b03', email: 'bea@example.test', roles: [], amr: ['pwd'] },
    } as unknown as RequestWithUser;

    expect((await reports.list(bea)).some((r) => r.scope === 'cluster')).toBe(false);
    await expect(reports.download(bea, `cluster/${last.year}/${mm}/report.html`)).rejects.toThrow('file not found');
  });

  it('topology: the map scoped by access, flows live and on the timeline, plan overlay and a hostname trace', async () => {
    const dataSource = app.get(DataSource);
    const [placement] = await dataSource.query(
      `SELECT id, addresses FROM lw_workload_placements WHERE jsonb_array_length(addresses) > 0 ORDER BY id LIMIT 1`,
    );
    const address = (placement.addresses[0] as string).split('/')[0];

    await dataSource.query(
      `INSERT INTO lw_flows ("time", node, policy, src, dst, protocol, port, decision, packets, bytes)
         VALUES (now() - interval '10 seconds', 'n1', '', $1, '198.51.100.9', 'tcp', 443, 'deny', 4, 240)`,
      [address],
    );

    const map = (await api('GET', '/topology?flows=true')).json;
    const kinds = new Set(map.elements.map((e: { kind: string }) => e.kind));

    expect([...kinds]).toEqual(expect.arrayContaining(['site', 'node', 'replica']));
    expect(map.edges).toContainEqual(
      expect.objectContaining({
        kind: 'flow',
        source: `replica:${placement.id}`,
        target: 'external:198.51.100.9',
        data: expect.objectContaining({ decision: 'deny', packets: 4 }),
      }),
    );

    // The timeline: nothing an hour ago.
    const past = (await api('GET', `/topology?flows=true&at=${new Date(Date.now() - 3_600_000).toISOString()}`)).json;

    expect(past.edges.some((e: { kind: string }) => e.kind === 'flow')).toBe(false);
    // Beyond the raw retention, the hourly roll-up.
    expect(
      (await api('GET', `/topology?flows=true&at=${new Date(Date.now() - 40 * 86_400_000).toISOString()}`)).status,
    ).toBe(200);
    expect((await api('GET', '/topology?at=yesterday')).status).toBe(400);
    expect((await api('GET', `/topology?plan=${randomUUID()}`)).status).toBe(404);

    // Plan list filters (status, touched project) are applied in the query.
    const applied = (await api('GET', '/plans?status=applied&limit=200')).json as { status: string }[];

    expect(applied.length).toBeGreaterThan(0);
    expect(applied.every((p) => p.status === 'applied')).toBe(true);
    expect(
      ((await api('GET', '/plans?project=alpha')).json as { changes: { project: string | null }[] }[]).every((p) =>
        p.changes.some((c) => c.project === 'alpha'),
      ),
    ).toBe(true);
    expect((await api('GET', '/plans?status=bogus')).status).toBe(400);
    expect(Array.isArray((await api('GET', '/metrics/names')).json)).toBe(true);

    // Path trace for an exposed hostname.
    const hostname = map.elements.find((e: { kind: string }) => e.kind === 'hostname');

    if (hostname) {
      const trace = (await api('GET', `/topology/trace?host=${encodeURIComponent(hostname.label)}`)).json;

      expect(trace.steps[0]).toMatchObject({ kind: 'hostname', label: hostname.label });
    }

    expect((await api('GET', '/topology/trace?host=nowhere.example')).status).toBe(404);
    expect((await api('GET', '/topology/trace?host=bad%20host')).status).toBe(400);

    const bea = {
      user: { id: '9a1e0c52-1c1e-4c39-9a51-3a3c1e0d0b03', email: 'bea@example.test', roles: [], amr: ['pwd'] },
    } as unknown as RequestWithUser;
    const scoped = await app.get(TopologyService).topology(bea, { flows: true });

    // Members see their projects' groups and policies: no sites, nodes, addresses, and no traffic.
    expect(scoped.elements.some((e) => ['site', 'node', 'address'].includes(e.kind))).toBe(false);
    expect(scoped.edges.some((e) => e.kind === 'flow' || e.kind === 'tunnel')).toBe(false);

    // Live flows over the socket.
    const live = io(`${baseUrl}/socket/topology`, {
      transports: ['websocket'],
      auth: { Authorization: `Bearer ${API_KEY}` },
    });

    try {
      const flows = await new Promise<{ at: string; edges: { kind: string; target: string }[] }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no live flows')), 15_000);

        live.on('connect', () => live.emit('subscribe'));
        live.on('flows', (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

      expect(flows.edges.some((e) => e.kind === 'flow' && e.target === 'external:198.51.100.9')).toBe(true);
    } finally {
      live.close();
    }
  });

  it('live: terminals, files and tunnels over the node stream, access-checked, audited and recorded', async () => {
    const dataSource = app.get(DataSource);
    const [{ id: replica, project }] = await dataSource.query(
      `SELECT id, project FROM lw_workload_placements WHERE node = 'n1' AND cron_run IS NULL ORDER BY id LIMIT 1`,
    );
    const files = new Map<string, Buffer>([['/etc/app.conf', Buffer.from('listen 80;')]]);
    const seen: { type: string; payload: Record<string, unknown> }[] = [];
    // A node that runs the replica: a shell that echoes, a tiny filesystem, an echo port.
    const { client, stream } = openAgent(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, n1Credentials);
    const reply = (type: Parameters<typeof agentMessage>[0], payload: never, channel: string) =>
      stream.write(agentMessage(type, payload, { channel }));

    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok !== true || !env.channel) return;

      const { type, payload } = decoded.message as { type: string; payload: Record<string, unknown> };

      seen.push({ type, payload });

      if (type === 'execOpen')
        reply('execOutput', { data: Buffer.from('$ ').toString('base64') } as never, env.channel);
      else if (type === 'execInput') reply('execOutput', { data: payload['data'] } as never, env.channel);
      else if (type === 'execClose') reply('execExit', { code: 0 } as never, env.channel);
      else if (type === 'tunnelOpen') undefined;
      else if (type === 'tunnelData') reply('tunnelData', { data: payload['data'] } as never, env.channel);
      else if (type === 'fileRequest') {
        const r = payload as {
          op: string;
          path: string;
          offset?: number;
          length?: number;
          data?: string;
          truncate?: boolean;
        };
        const file = files.get(r.path);
        const entry = (path: string, f: Buffer) => ({
          name: path.split('/').at(-1),
          type: 'file',
          size: f.length,
          modifiedAt: new Date(0).toISOString(),
          mode: 0o644,
        });

        if (r.op === 'list')
          reply(
            'fileResponse',
            { ok: true, entries: [...files].map(([path, f]) => entry(path, f)) } as never,
            env.channel,
          );
        else if (r.op === 'stat')
          reply(
            'fileResponse',
            (file
              ? { ok: true, entry: entry(r.path, file) }
              : { ok: false, error: { code: 'not-found', message: 'no' } }) as never,
            env.channel,
          );
        else if (r.op === 'read')
          reply(
            'fileResponse',
            {
              ok: true,
              data: (file ?? Buffer.alloc(0)).subarray(r.offset, (r.offset ?? 0) + (r.length ?? 0)).toString('base64'),
            } as never,
            env.channel,
          );
        else if (r.op === 'write') {
          const before = r.truncate ? Buffer.alloc(0) : (files.get(r.path) ?? Buffer.alloc(0));

          files.set(r.path, Buffer.concat([before.subarray(0, r.offset), Buffer.from(r.data ?? '', 'base64')]));
          reply('fileResponse', { ok: true } as never, env.channel);
        } else if (r.op === 'move' && file) {
          files.set((r as { to?: string }).to as string, file);
          files.delete(r.path);
          reply('fileResponse', { ok: true } as never, env.channel);
        } else reply('fileResponse', { ok: true } as never, env.channel);
      }
    });
    stream.write(agentMessage('hello', hello('n1', WG_KEYS[0])));

    try {
      await waitFor(async () =>
        (await dataSource.query(`SELECT stream_owner FROM lw_nodes WHERE name = 'n1'`))[0]?.stream_owner
          ? true
          : undefined,
      );

      // Recording on for the project.
      expect((await api('PUT', `/projects/${project}/settings`, { recordTerminals: true })).status).toBe(200);

      const terminals = io(`${baseUrl}/socket/terminals`, {
        transports: ['websocket'],
        auth: { Authorization: `Bearer ${API_KEY}` },
      });
      const next = <T>(event: string) =>
        new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`no ${event}`)), 10_000);

          terminals.once(event, (value: T) => {
            clearTimeout(timer);
            resolve(value);
          });
        });

      try {
        const created = next<{ sessionId: string; recorded: boolean }>('terminalCreated');

        terminals.emit('createTerminal', { sessionId: 's1', target: { replica }, cols: 100, rows: 30 });
        expect(await created).toEqual({ sessionId: 's1', recorded: true });

        let output = '';

        terminals.on('terminalOutput', (m: { data: string }) => (output += m.data));
        terminals.emit('terminalInput', { sessionId: 's1', data: 'uptime\r' });
        await waitFor(async () => (output.includes('uptime') ? true : undefined));

        const closed = next<{ sessionId: string; exitCode: number }>('terminalClosed');

        terminals.emit('closeTerminal', { sessionId: 's1' });
        expect(await closed).toEqual({ sessionId: 's1', exitCode: 0 });
        expect(seen.find((m) => m.type === 'execOpen')?.payload).toMatchObject({
          target: { kind: 'replica', replica },
          cols: 100,
          rows: 30,
        });

        // Host shells: off by default.
        const refused = next<{ message: string }>('error');

        terminals.emit('createTerminal', { sessionId: 's2', target: { node: 'n1' } });
        expect((await refused).message).toBe('node shells are disabled for this cluster');
      } finally {
        terminals.close();
      }

      const sessions = await waitFor(async () => {
        const list = (await api('GET', `/live/sessions?project=${project}`)).json;

        return list[0]?.hasRecording ? list : undefined;
      });

      expect(sessions[0]).toMatchObject({ target: `replica/${replica}`, node: 'n1', recorded: true, exitCode: 0 });

      const cast = await fetch(`${baseUrl}/api/live/sessions/${sessions[0].id}/recording`, {
        headers: { authorization: `Bearer ${API_KEY}` },
      });

      expect((await cast.text()).split('\n')[0]).toContain('"version":2');

      // Files: listing, ranged reads, a chunked upload; container writes come with a warning.
      const target = `replica:${replica}`;

      expect(
        (await api('GET', `/live/files?target=${target}&path=/`)).json.map((e: { name: string }) => e.name),
      ).toEqual(['app.conf']);

      const ranged = await fetch(`${baseUrl}/api/live/files/content?target=${target}&path=/etc/app.conf`, {
        headers: { authorization: `Bearer ${API_KEY}`, range: 'bytes=7-' },
      });

      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('content-range')).toBe('bytes 7-9/10');
      expect(await ranged.text()).toBe('80;');

      const put = (body: string, range: string) =>
        fetch(`${baseUrl}/api/live/files/content?target=${target}&path=/etc/new.conf`, {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${API_KEY}`,
            'content-type': 'application/octet-stream',
            'content-range': range,
            'x-upload-id': 'u1',
          },
          body,
        });

      expect((await put('abc', 'bytes 0-2/6')).status).toBe(202);
      // Out of sequence: the next chunk starts where the temporary file ends; the target isn't touched meanwhile.
      expect((await put('ef', 'bytes 4-5/6')).status).toBe(400);
      expect(files.has('/etc/new.conf')).toBe(false);

      const done = await put('def', 'bytes 3-5/6');

      expect(done.status).toBe(204);
      expect(done.headers.get('x-loadweaver-warning')).toContain('lost on restart');
      expect(files.get('/etc/new.conf')?.toString()).toBe('abcdef');
      expect((await api('GET', `/live/files?target=volume:${project}/nope/data&path=/`)).status).toBe(404);

      // Tunnels.
      const tunnels = io(`${baseUrl}/socket/tunnels`, {
        transports: ['websocket'],
        auth: { Authorization: `Bearer ${API_KEY}` },
      });

      try {
        const opened = new Promise<{ tunnelId: string }>((resolve) => tunnels.once('tunnelOpened', resolve));

        tunnels.emit('openTunnel', { tunnelId: 't1', replica, port: 5432, ttlSeconds: 120 });
        expect((await opened).tunnelId).toBe('t1');
        expect((await api('GET', '/live/tunnels')).json).toEqual([
          expect.objectContaining({ replica, port: 5432, node: 'n1' }),
        ]);

        const echoed = new Promise<{ data: string }>((resolve) => tunnels.once('tunnelData', resolve));

        tunnels.emit('tunnelData', { tunnelId: 't1', data: Buffer.from('PING').toString('base64') });
        expect(Buffer.from((await echoed).data, 'base64').toString()).toBe('PING');

        const closed = new Promise<{ tunnelId: string }>((resolve) => tunnels.once('tunnelClosed', resolve));

        tunnels.emit('closeTunnel', { tunnelId: 't1' });
        await closed;
        expect((await api('GET', '/live/tunnels')).json).toEqual([]);
      } finally {
        tunnels.close();
      }

      // Everything is in the audit log.
      const actions = (await api('GET', '/audit?limit=50')).json.entries.map((e: { action: string }) => e.action);

      expect(actions).toEqual(
        expect.arrayContaining(['terminal.open', 'terminal.close', 'files.write', 'tunnel.open', 'tunnel.close']),
      );

      // A crashed replica's open records are closed at their last heartbeat.
      const [{ id: orphan }] = await dataSource.query(
        `INSERT INTO lw_terminal_sessions (target, node, seen_at) VALUES ('node/n1', 'n1', now() - INTERVAL '10 minutes') RETURNING id`,
      );

      expect(await app.get(LiveRecordsService).closeOrphans()).toBeGreaterThanOrEqual(1);
      expect(
        (
          await dataSource.query(`SELECT ended_at IS NOT NULL AS ended FROM lw_terminal_sessions WHERE id = $1`, [
            orphan,
          ])
        )[0].ended,
      ).toBe(true);
    } finally {
      stream.end();
      client.close();
    }
  });

  it('sent agents without protocol version only messages of the N-1 protocol (3.26)', () => {
    expect(protocolViolations).toEqual([]);
  });
});
