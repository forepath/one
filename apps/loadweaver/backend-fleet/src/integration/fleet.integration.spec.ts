/**
 * Fleet service against two real control planes (P gate, needs Docker and the control-plane image
 * `ghcr.io/forepath/loadweaver-control-plane-api:latest` from `nx run loadweaver-backend-control-plane:api-container-image`).
 *
 * Lab: one Postgres (fleet + two cluster databases) and one Valkey in a private network, two control-plane
 * containers (api-key auth, controllers that need nodes switched off) published on random host ports, the fleet
 * in-process (`createApp`). Covers registration with the connection test, health, cards / inbox / sites / compare,
 * the REST relay (allow-list, credential swap, streaming), read-only grace via the Cloud teardown hook and the
 * final-backup operation reaching both cluster-side endpoints.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

const POSTGRES_IMAGE =
  'docker.io/library/postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297';
const VALKEY_IMAGE =
  'docker.io/valkey/valkey:9.0.6-alpine@sha256:187679e3bd4036959631e3f03983ab2ba503ab21e6fd0454d508e909db2ee989';
const CONTROL_PLANE_IMAGE =
  process.env['LW_IT_CONTROL_PLANE_IMAGE'] ?? 'ghcr.io/forepath/loadweaver-control-plane-api:latest';

const run = randomBytes(3).toString('hex');
const network = `lw-fleet-it-${run}`;
const containers: string[] = [];

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function hostPort(container: string, port: number): number {
  return Number(
    docker(['port', container, `${port}/tcp`])
      .split('\n')[0]
      .split(':')
      .pop(),
  );
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 180_000): Promise<void> {
  const until = Date.now() + timeoutMs;

  while (Date.now() < until) {
    if (await check().catch(() => false)) return;

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`timed out waiting for ${what}`);
}

function startControlPlane(name: string, database: string, apiKey: string): { container: string; url: string } {
  const container = `lw-fleet-it-${name}-${run}`;

  docker([
    'run',
    '-d',
    '--name',
    container,
    '--memory',
    '768m',
    '--network',
    network,
    '-p',
    '127.0.0.1::3400',
    '-e',
    'NODE_ENV=development',
    '-e',
    'PORT=3400',
    '-e',
    `DB_HOST=lw-fleet-it-pg-${run}`,
    '-e',
    `DB_DATABASE=${database}`,
    '-e',
    'DB_SSL_MODE=disable',
    '-e',
    'AUTHENTICATION_METHOD=api-key',
    '-e',
    `STATIC_API_KEY=${apiKey}`,
    // The identity module is loaded for every auth mode and refuses to start without a JWT secret outside tests.
    '-e',
    `JWT_SECRET=fleet-it-${name}-${run}-jwt-secret`,
    '-e',
    'ENCRYPTION_KEY=MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
    '-e',
    `LOADWEAVER_CLUSTER_NAME=${name}`,
    '-e',
    `REDIS_HOST=lw-fleet-it-valkey-${run}`,
    '-e',
    `REDIS_KEY_PREFIX=${name}`,
    '-e',
    'LOADWEAVER_GRPC_ENABLED=false',
    '-e',
    'LOADWEAVER_WORKLOAD_CONTROLLER=off',
    '-e',
    'LOADWEAVER_ROLLOUT_CONTROLLER=off',
    '-e',
    'LOADWEAVER_UPDATE_POLICY=off',
    '-e',
    'LOADWEAVER_UPDATE_CHECK=off',
    '-e',
    'LOADWEAVER_OBJECT_STORE=off',
    '-e',
    'LOADWEAVER_BACKUPS=off',
    '-e',
    'LOADWEAVER_GIT_SYNC=off',
    '-e',
    'LOADWEAVER_AUTOSCALER=off',
    '-e',
    'OPENSEARCH_ENABLED=false',
    '-e',
    'FILE_STORAGE_PROVIDER=local',
    '-e',
    'FILE_STORAGE_ROOT=/tmp/files',
    '-e',
    'RATE_LIMIT_ENABLED=false',
    '-e',
    'VERSION=1.0.0',
    CONTROL_PLANE_IMAGE,
  ]);
  containers.push(container);

  return { container, url: `http://127.0.0.1:${hostPort(container, 3400)}` };
}

describe('fleet service with two control planes (3.24, P gate)', () => {
  let app: INestApplication;
  let fleet: AxiosInstance;
  let eu: { container: string; url: string };
  let us: { container: string; url: string };
  const euKey = 'eu-cluster-api-key-0123456789';
  const usKey = 'us-cluster-api-key-0123456789';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    docker(['network', 'create', network]);

    const pg = `lw-fleet-it-pg-${run}`;

    docker([
      'run',
      '-d',
      '--name',
      pg,
      '--memory',
      '512m',
      '--network',
      network,
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_PASSWORD=postgres',
      POSTGRES_IMAGE,
    ]);
    containers.push(pg);
    docker([
      'run',
      '-d',
      '--name',
      `lw-fleet-it-valkey-${run}`,
      '--memory',
      '64m',
      '--network',
      network,
      '-p',
      '127.0.0.1::6379',
      VALKEY_IMAGE,
    ]);
    containers.push(`lw-fleet-it-valkey-${run}`);
    await waitFor('postgres', async () => {
      docker(['exec', pg, 'pg_isready', '-U', 'postgres']);

      return true;
    });

    for (const db of ['fleet', 'cluster_eu', 'cluster_us'])
      docker(['exec', pg, 'psql', '-U', 'postgres', '-qc', `CREATE DATABASE ${db}`]);

    eu = startControlPlane('eu', 'cluster_eu', euKey);
    us = startControlPlane('us', 'cluster_us', usKey);

    for (const cp of [eu, us])
      await waitFor(
        `control plane ${cp.container}`,
        async () => (await axios.get(`${cp.url}/api/health`)).status === 200,
      ).catch((error: unknown) => {
        // The container's own output is the only clue when a control plane doesn't come up.
        const logs = spawnSync('docker', ['logs', '--tail', '80', cp.container], { encoding: 'utf8' });

        process.stderr.write(`[fleet-it] ${cp.container} logs:\n${logs.stdout}${logs.stderr}\n`);
        throw error;
      });

    Object.assign(process.env, {
      DB_HOST: '127.0.0.1',
      DB_PORT: String(hostPort(pg, 5432)),
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_DATABASE: 'fleet',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(hostPort(`lw-fleet-it-valkey-${run}`, 6379)),
      REDIS_KEY_PREFIX: `fleet-${run}`,
    });

    const { createApp } = await import('../bootstrap');

    app = await createApp();
    await app.listen(0);

    const address = app.getHttpServer().address() as { port: number };

    fleet = axios.create({
      baseURL: `http://127.0.0.1:${address.port}/api`,
      headers: { Authorization: `Bearer ${process.env['STATIC_API_KEY']}` },
      validateStatus: () => true,
    });
  }, 600_000);

  afterAll(async () => {
    await app?.close();

    for (const c of containers.reverse()) {
      try {
        docker(['rm', '-f', '-v', c]);
      } catch {
        // already gone
      }
    }

    try {
      docker(['network', 'rm', network]);
    } catch {
      // already gone
    }
  });

  it('refuses a wrong credential and registers both clusters after the connection test', async () => {
    const wrong = await fleet.post('/clusters', {
      name: 'eu',
      endpoint: eu.url,
      credential: 'wrong-credential-0123456789',
    });

    expect(wrong.status).toBe(400);

    for (const [name, cp, key] of [
      ['eu', eu, euKey],
      ['us', us, usKey],
    ] as const) {
      const res = await fleet.post('/clusters', { name, endpoint: `${cp.url}/api`, credential: key });

      expect(res.status).toBe(201);
      expect(res.data).toMatchObject({
        name,
        endpoint: cp.url,
        health: { state: expect.stringMatching(/healthy|degraded/) },
      });
      expect(JSON.stringify(res.data)).not.toContain(key);
      ids[name] = res.data.id;
    }
  });

  it('aggregates cards, inbox, sites and a comparison', async () => {
    const cards = await fleet.get('/fleet/cards');

    expect(cards.status).toBe(200);
    expect(cards.data.map((c: { name: string }) => c.name).sort()).toEqual(['eu', 'us']);
    expect(cards.data[0]).toMatchObject({ limited: false, link: expect.stringMatching(/^\/clusters\/.+\/overview$/) });

    expect((await fleet.get('/fleet/inbox')).status).toBe(200);
    expect((await fleet.get('/fleet/sites')).data).toHaveProperty('withoutLocation');

    const compare = await fleet.get('/fleet/compare', { params: { clusters: `${ids['eu']},${ids['us']}` } });

    expect(compare.status).toBe(200);
    expect(compare.data.policyDrift).toMatchObject({ different: 0 });
  });

  it('relays allowed calls with the service credential and refuses the rest', async () => {
    const overview = await fleet.get(`/clusters/${ids['eu']}/api/overview`);

    expect(overview.status).toBe(200);
    expect(overview.data).toHaveProperty('headline');

    const plan = await fleet.post(`/clusters/${ids['us']}/api/plans`, {
      documents: JSON.stringify({
        apiVersion: 'loadweaver.com/v1',
        kind: 'Project',
        metadata: { name: 'fleet-it' },
        spec: {},
      }),
    });

    expect([200, 201]).toContain(plan.status);
    expect(
      (await axios.get(`${us.url}/api/plans/${plan.data.id}`, { headers: { Authorization: `Bearer ${usKey}` } }))
        .status,
    ).toBe(200);

    expect((await fleet.get(`/clusters/${ids['eu']}/api/projects/x/secrets`)).status).toBe(404);
    expect((await fleet.get(`/clusters/${ids['eu']}/api/plans/..%2Fcluster`)).status).toBe(400);
  });

  it('switches a Cloud cluster to read-only grace and starts its final backup', async () => {
    await fleet.delete(`/clusters/${ids['us']}`);

    const registered = await fleet.post('/cloud/clusters', {
      name: 'us-cloud',
      endpoint: us.url,
      credential: usKey,
      reference: 'decabill:sub-it:item-it',
    });

    expect(registered.status).toBe(201);

    const teardown = await fleet.put(`/cloud/clusters/${encodeURIComponent('decabill:sub-it:item-it')}/teardown`, {
      readOnlyUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(teardown.status).toBe(200);
    expect(teardown.data.cluster).toMatchObject({ state: 'teardown', access: { readOnly: false } });
    expect(teardown.data.finalBackup).toMatchObject({ kind: 'final-backup' });

    const id = registered.data.id;

    expect((await fleet.get(`/clusters/${id}/api/overview`)).status).toBe(200);
    expect((await fleet.post(`/clusters/${id}/api/plans`, { documents: '' })).status).toBe(403);

    // The worker runs the steps against the cluster (platform backups are off there → skipped / failed, volumes none).
    await waitFor(
      'final backup',
      async () => {
        const op = await fleet.get(`/operations/${teardown.data.finalBackup.id}`);

        return ['succeeded', 'failed'].includes(op.data.status);
      },
      120_000,
    );

    const again = await fleet.put(`/cloud/clusters/${encodeURIComponent('decabill:sub-it:item-it')}/teardown`, {
      readOnlyUntil: teardown.data.cluster.readOnlyUntil,
    });

    expect(again.data.finalBackup.id).toBe(teardown.data.finalBackup.id);
  });
});
