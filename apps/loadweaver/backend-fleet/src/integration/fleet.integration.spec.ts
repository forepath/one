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
import type { INestApplication } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

import { FleetLab, waitFor, type LabControlPlane } from './fleet-lab';

const lab = new FleetLab();

function startControlPlane(name: string, database: string, apiKey: string): Promise<LabControlPlane> {
  return lab.startControlPlane(name, database, { AUTHENTICATION_METHOD: 'api-key', STATIC_API_KEY: apiKey });
}

describe('fleet service with two control planes (3.24, P gate)', () => {
  let app: INestApplication;
  let fleet: AxiosInstance;
  let eu: LabControlPlane;
  let us: LabControlPlane;
  const euKey = 'eu-cluster-api-key-0123456789';
  const usKey = 'us-cluster-api-key-0123456789';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await lab.start(['fleet', 'cluster_eu', 'cluster_us']);
    eu = await startControlPlane('eu', 'cluster_eu', euKey);
    us = await startControlPlane('us', 'cluster_us', usKey);
    lab.useForFleet('fleet');

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
    lab.teardown();
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
