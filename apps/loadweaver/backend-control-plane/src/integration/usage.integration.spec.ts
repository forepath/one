import type { AddressInfo } from 'node:net';

import { UsageService } from '@forepath/loadweaver/backend/feature-control-plane';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';

/**
 * Usage metering (3.24, P2) on the real schema: replica minutes in `lw_metrics_1m` and the control plane's allocation
 * samples (a replicated volume, a project egress address) roll up into final hourly buckets with the project's
 * Decabill mapping; the REST API answers by hour (with idempotency keys) and day, exports CSV, scopes by role, and
 * final buckets never change again.
 */

const API_KEY = 'integration-test-api-key';
const SUB = '6f1c1d5e-6a43-4c38-9a59-7f6d4f0e2a10';
const GIB = 1024 ** 3;

describe('usage metering (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let usage: UsageService;
  // The current hour: the app's own timers treat it as open, so only the explicit roll-ups below finalize it.
  const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const after = new Date(hour.getTime() + 80 * 60_000);

  const api = async (path: string, token = API_KEY): Promise<{ status: number; text: string }> => {
    const res = await fetch(`${baseUrl}/api${path}`, { headers: { authorization: `Bearer ${token}` } });

    return { status: res.status, text: await res.text() };
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = app.get(DataSource);
    usage = app.get(UsageService);

    await dataSource.query(
      `INSERT INTO lw_resources (id, kind, project, project_key, name, spec) VALUES (gen_random_uuid(), 'Project', NULL, '', 'shop', $1)`,
      [JSON.stringify({ billing: { decabillSubscriptionId: SUB } })],
    );
    await dataSource.query(
      `INSERT INTO lw_resources (id, kind, project, project_key, name, spec) VALUES (gen_random_uuid(), 'Project', NULL, '', 'blog', '{}')`,
    );

    // One replica the whole hour: 0.5 cores, 2 GiB, 1 MB/s in, 0.5 MB/s out. The first half hour from an agent with
    // integrated samples, one tick skipped every minute (5 samples covering 60 s; its instantaneous samples alone
    // would bill 50 s and are ignored); the second half from an N-1 agent (instantaneous samples × 10 s, 6 a minute).
    for (let m = 0; m < 60; m++) {
      const bucket = new Date(hour.getTime() + m * 60_000);
      const rows: (readonly [string, number, number])[] = [
        ['replica.cpu_cores', 0.5, m < 30 ? 5 : 6],
        ['replica.memory_bytes', 2 * GIB, m < 30 ? 5 : 6],
        ['replica.net_rx_bytes_per_s', 1e6, m < 30 ? 5 : 6],
        ['replica.net_tx_bytes_per_s', 5e5, m < 30 ? 5 : 6],
      ];

      if (m < 30)
        rows.push(
          ['replica.cpu_seconds', (0.5 * 60) / 5, 5],
          ['replica.memory_byte_seconds', (2 * GIB * 60) / 5, 5],
          ['replica.net_rx_bytes', (1e6 * 60) / 5, 5],
          ['replica.net_tx_bytes', (5e5 * 60) / 5, 5],
        );

      for (const [metric, avg, samples] of rows)
        await dataSource.query(
          `INSERT INTO lw_metrics_1m (bucket, metric, node, project, entity, avg, min, max, samples) VALUES ($1, $2, 'n1', 'shop', 'shop/web/api/0', $3, $3, $3, $4)`,
          [bucket, metric, avg, samples],
        );
    }

    // A 10 GiB volume with one synchronous and one remote replica; one project egress address and one cluster address.
    await dataSource.query(
      `INSERT INTO lw_volume_placements (id, primary_node, sync_replicas, remote_replicas, size_bytes, cross_site, drbd_minor, drbd_port) VALUES ('shop/web/data', 'n1', '["n2"]', '["n3"]', $1, 'async', 4242, 7942)`,
      [10 * GIB],
    );
    await dataSource.query(
      `INSERT INTO lw_public_addresses (address, pool, purpose, owner, state) VALUES ('203.0.113.10', 'public', 'egress', 'egress/shop/outbound/0', 'assigned'), ('203.0.113.11', 'public', 'ingress', 'ingress/0', 'assigned')`,
    );

    for (let slot = 0; slot < 12; slot++) await usage.sample(new Date(hour.getTime() + slot * 5 * 60_000 + 30_000));

    await usage.rollup(after);
    // The API reports a bucket final only once its end is past the settle time of the real clock: from here on the
    // clock reads 20 minutes after the explicit roll-up (only `Date` is faked; timers and I/O stay real).
    jest.useFakeTimers({
      now: after.getTime() + 20 * 60_000,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  }, 120_000);

  afterAll(async () => {
    jest.useRealTimers();
    await app?.close();
  });

  it('rolls up final hourly buckets per meter with the billing mapping', async () => {
    const res = await api(
      `/usage?granularity=hour&finalOnly=true&billingSubscription=${SUB}&from=${hour.toISOString()}&to=${after.toISOString()}`,
    );

    expect(res.status).toBe(200);

    const body = JSON.parse(res.text);
    const values = Object.fromEntries(
      body.rows.map((r: { meter: string; value: number }) => [r.meter, r.value] as const),
    );

    expect(values).toEqual({
      cpu_core_hours: 0.5,
      memory_gib_hours: 2,
      storage_gib_hours: 10,
      storage_replica_gib_hours: 30,
      traffic_in_gb: 3.6,
      traffic_out_gb: 1.8,
      public_ip_hours: 1,
    });

    for (const r of body.rows as {
      meter: string;
      final: boolean;
      project: string;
      billingSubscription: string;
      idempotencyKey: string;
    }[])
      expect(r).toMatchObject({
        final: true,
        project: 'shop',
        billingSubscription: SUB,
        idempotencyKey: `loadweaver:${body.cluster}:shop:${r.meter}:${hour.toISOString()}`,
      });
  });

  it('never changes a final bucket and keeps the mapping it had', async () => {
    await dataSource.query(
      `INSERT INTO lw_metrics_1m (bucket, metric, node, project, entity, avg, min, max, samples) VALUES ($1, 'replica.cpu_cores', 'n2', 'shop', 'shop/web/api/1', 4, 4, 4, 6)`,
      [new Date(hour.getTime() + 30 * 60_000)],
    );
    await dataSource.query(`UPDATE lw_resources SET spec = '{}' WHERE kind = 'Project' AND name = 'shop'`);
    await usage.rollup(new Date(after.getTime() + 5 * 60_000));

    const [row] = await dataSource.query(
      `SELECT value, final, billing_subscription FROM lw_usage_1h WHERE project = 'shop' AND meter = 'cpu_core_hours' AND bucket = $1`,
      [hour],
    );

    expect(Number(row.value)).toBeCloseTo(0.5, 9);
    expect(row).toMatchObject({ final: true, billing_subscription: SUB });
  });

  it('answers by day for the project and exports CSV', async () => {
    const day = await api(`/projects/shop/usage?granularity=day&from=${hour.toISOString()}&to=${after.toISOString()}`);

    expect(day.status).toBe(200);
    expect(JSON.parse(day.text).totals).toEqual(
      expect.arrayContaining([{ project: 'shop', meter: 'storage_gib_hours', value: 10 }]),
    );

    const csv = await api(`/usage/export?granularity=hour&from=${hour.toISOString()}&to=${after.toISOString()}`);

    expect(csv.status).toBe(200);
    expect(csv.text.split('\n')[0]).toBe('project,bucket,granularity,meter,unit,value,final,idempotency_key');
    expect(csv.text).toContain('"shop","' + hour.toISOString() + '","hour","public_ip_hours","IP-hours",1,"true"');
    // Cluster addresses (ingress) belong to no project.
    expect(csv.text).not.toContain('ingress');
  });

  it('rejects invalid ranges and unauthenticated callers', async () => {
    expect((await api('/usage?granularity=hour&from=2020-01-01T00:00:00Z&to=2020-12-01T00:00:00Z')).status).toBe(400);
    expect((await api('/usage?granularity=week')).status).toBe(400);
    expect([401, 403]).toContain((await api('/usage', 'not-a-token')).status);
  });
});
