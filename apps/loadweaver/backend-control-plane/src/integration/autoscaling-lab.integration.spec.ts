import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';

import { AutoscalerService } from '@forepath/loadweaver/backend/feature-control-plane';
import { CommandRunner, MetricsCollectorService } from '@forepath/loadweaver/backend/feature-node-agent';
import {
  agentMessage,
  decodeControlPlaneMessage,
  openAgentStream,
  type DesiredState,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCsr, generateKeyPair } from '@forepath/loadweaver/shared/util-pki';
import type { INestApplication } from '@nestjs/common';
import Docker from 'dockerode';
import { DataSource } from 'typeorm';

import { createApp } from '../bootstrap';

/**
 * Autoscaling lab (3.23): a real container burns CPU on this machine's Docker, the node agent's metrics collector
 * measures it (`replica.cpu_cores` from `docker stats`), the report goes over the agent stream into the control
 * plane's metrics store, and the autoscaler adds a second replica. Only the container runtime of the agent is
 * simulated (the replica container is started by the test, labelled like the agent labels workloads).
 */

const API_KEY = 'integration-test-api-key';
const ALPINE =
  'docker.io/library/alpine:3.10.9@sha256:451eee8bedcb2f029756dc3e9d73bab0e7943c1ac55cff3a4861c52a0fdd3e98';

const hello = {
  nodeName: 'n1',
  agentVersion: '0.0.0-it',
  os: { id: 'debian', versionId: '13', kernel: '6.12.0', arch: 'amd64' as const },
  capabilities: {
    runtimes: ['runc' as const],
    sandboxProbe: 'missing' as const,
    wireguard: true,
    nftables: true,
    bird: true,
    drbd: false,
    criu: false,
  },
  capacity: { cpuMillis: 8000, memoryBytes: 16_000_000_000, diskBytes: 100_000_000_000 },
  wireguardPublicKey: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=',
  endpointHost: 'n1.example.test',
  appliedRevision: 0,
};

describe('autoscaling lab: real CPU load → metric → second replica', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let close: () => void = () => undefined;
  let send: (env: Envelope) => void = () => undefined;
  const container = `lw-autoscale-lab-${process.pid}-${Date.now()}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary JSON response bodies
  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();

    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> => {
    const start = Date.now();

    for (;;) {
      const value = await fn();

      if (value !== undefined) return value;

      if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${fn.toString().slice(0, 300)}`);

      await sleep(250);
    }
  };

  beforeAll(async () => {
    execFileSync('docker', ['pull', '-q', ALPINE], { stdio: 'ignore' });
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    dataSource = app.get(DataSource);

    const token = (await api('POST', '/join-tokens', {})).json.token as string;
    const keys = await generateKeyPair();
    const res = await api('POST', '/nodes/join', { token, nodeName: 'n1', csrPem: await createCsr(keys, 'n1'), hello });

    expect(res.status).toBe(200);

    const { client, stream } = openAgentStream(process.env.LOADWEAVER_GRPC_ENDPOINTS as string, {
      caCertificatePem: res.json.caCertificatePem,
      certificatePem: res.json.certificatePem,
      privateKeyPem: keys.privateKeyPem,
    });
    let applied = 0;
    const heartbeat = setInterval(
      () =>
        stream.write(
          agentMessage('heartbeat', {
            appliedRevision: applied,
            usage: { cpuMillis: 100, memoryBytes: 1_000_000, diskBytes: 1_000_000 },
            at: new Date().toISOString(),
          }),
        ),
      3_000,
    );

    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok === false || decoded.message.type !== 'desiredState') return;

      applied = (decoded.message.payload as DesiredState).revision;
      stream.write(agentMessage('applyReport', { revision: applied, status: 'applied', steps: [] }));
    });
    stream.write(agentMessage('hello', hello));
    send = (env) => stream.write(env);
    close = () => {
      clearInterval(heartbeat);
      stream.end();
      client.close();
    };

    await waitFor(async () =>
      ((await dataSource.query(`SELECT count(*)::int AS n FROM lw_nodes WHERE connected`)) as { n: number }[])[0].n ===
      1
        ? true
        : undefined,
    );
  }, 180_000);

  afterAll(async () => {
    try {
      execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
    } catch {
      // gone
    }

    close();
    await app?.close();
  });

  it('scales a CPU-bound service from one to two replicas', async () => {
    const plan = await api('POST', '/plans', {
      documents: `apiVersion: loadweaver.com/v1
kind: Project
metadata: { name: lab }
spec: {}
---
apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: web, project: lab }
spec:
  compose: |
    services:
      api:
        image: ${ALPINE}
        command: ["sh", "-c", "while :; do :; done"]
        deploy:
          resources:
            reservations: { cpus: '0.25', memory: 32m }
        x-loadweaver:
          autoscale: { min: 1, max: 2, metric: cpu, target: 50 }
`,
    });

    expect(plan.status).toBeLessThan(300);
    expect((await api('POST', `/plans/${plan.json.id}/apply`, { confirm: true })).status).toBeLessThan(300);
    await waitFor(async () =>
      (await api('GET', `/plans/${plan.json.id}`)).json.status === 'applied' ? true : undefined,
    );

    // The replica the control plane placed on n1, run by "the agent": a real container burning a CPU core.
    execFileSync('docker', [
      'run',
      '-d',
      '--name',
      container,
      '--cpus',
      '1',
      '--label',
      'loadweaver.com/managed=true',
      '--label',
      'loadweaver.com/workload=lab/web/api/0',
      ALPINE,
      'sh',
      '-c',
      'while :; do :; done',
    ]);

    // The agent's collector: CPU is the change between two readings of `docker stats`.
    const collector = new MetricsCollectorService(new Docker(), new CommandRunner(), {
      usage: async () => null,
    } as never);
    let cores = 0;

    await collector.collect();

    for (let i = 0; i < 3; i++) {
      await sleep(2_000);

      const report = await collector.collect();

      cores = report.samples.find((s) => s.metric === 'replica.cpu_cores' && s.entity === 'lab/web/api/0')?.value ?? 0;
      send(agentMessage('metrics', report));
    }

    // A busy loop uses about one core (four times the 0.25 request), whatever else this machine runs.
    expect(cores).toBeGreaterThan(0.3);

    const ingested = await waitFor(async () => {
      const [row] = await dataSource.query(
        `SELECT count(*)::int AS n FROM lw_metrics WHERE metric = 'replica.cpu_cores' AND entity = 'lab/web/api/0'`,
      );

      return row.n >= 3 ? row.n : undefined;
    });

    expect(ingested).toBeGreaterThanOrEqual(3);

    const [action] = await app.get(AutoscalerService).tick();

    expect(action).toMatchObject({ service: 'lab/web/api', from: 1, to: 2 });
    expect(action.reason).toMatch(/^1 → 2: cpu \d+(\.\d+)? % \/ target 50 %/);
    expect(
      (
        (await dataSource.query(`SELECT id FROM lw_workload_placements WHERE project = 'lab' ORDER BY id`)) as {
          id: string;
        }[]
      ).map((r) => r.id),
    ).toEqual(['lab/web/api/0', 'lab/web/api/1']);
  });
});
