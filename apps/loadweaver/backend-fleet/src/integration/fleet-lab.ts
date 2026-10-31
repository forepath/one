/**
 * Shared Docker lab of the fleet integration specs (P gate): one Postgres (fleet + cluster databases) and one Valkey
 * in a private network, control-plane containers from `ghcr.io/forepath/loadweaver-control-plane-api:latest`
 * (controllers that need nodes switched off) published on random loopback ports, every name with a random suffix.
 * The fleet itself runs in-process (`createApp`); {@link FleetLab.useForFleet} points it at the lab's Postgres /
 * Valkey.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import axios from 'axios';

const POSTGRES_IMAGE =
  'docker.io/library/postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297';
const VALKEY_IMAGE =
  'docker.io/valkey/valkey:9.0.6-alpine@sha256:187679e3bd4036959631e3f03983ab2ba503ab21e6fd0454d508e909db2ee989';
const CONTROL_PLANE_IMAGE =
  process.env['LW_IT_CONTROL_PLANE_IMAGE'] ?? 'ghcr.io/forepath/loadweaver-control-plane-api:latest';

export interface LabControlPlane {
  container: string;
  url: string;
}

export function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 180_000): Promise<void> {
  const until = Date.now() + timeoutMs;

  while (Date.now() < until) {
    if (await check().catch(() => false)) return;

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`timed out waiting for ${what}`);
}

export class FleetLab {
  readonly run = randomBytes(3).toString('hex');
  readonly network: string;
  readonly pg: string;
  readonly valkey: string;
  private readonly containers: string[] = [];

  constructor(private readonly prefix = 'lw-fleet-it') {
    this.network = `${prefix}-${this.run}`;
    this.pg = `${prefix}-pg-${this.run}`;
    this.valkey = `${prefix}-valkey-${this.run}`;
  }

  hostPort(container: string, port: number): number {
    return Number(
      docker(['port', container, `${port}/tcp`])
        .split('\n')[0]
        .split(':')
        .pop(),
    );
  }

  /** Network, Postgres (with the given databases) and Valkey. */
  async start(databases: readonly string[]): Promise<void> {
    docker(['network', 'create', this.network]);
    docker([
      'run',
      '-d',
      '--name',
      this.pg,
      '--memory',
      '512m',
      '--network',
      this.network,
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_PASSWORD=postgres',
      POSTGRES_IMAGE,
    ]);
    this.containers.push(this.pg);
    docker([
      'run',
      '-d',
      '--name',
      this.valkey,
      '--memory',
      '64m',
      '--network',
      this.network,
      '-p',
      '127.0.0.1::6379',
      VALKEY_IMAGE,
    ]);
    this.containers.push(this.valkey);
    await waitFor('postgres', async () => {
      docker(['exec', this.pg, 'pg_isready', '-U', 'postgres']);

      return true;
    });

    for (const db of databases) docker(['exec', this.pg, 'psql', '-U', 'postgres', '-qc', `CREATE DATABASE ${db}`]);
  }

  /** One SQL statement in a lab database; rows as `|`-separated text lines. */
  sql(database: string, statement: string): string {
    return docker(['exec', this.pg, 'psql', '-U', 'postgres', '-d', database, '-tAc', statement]);
  }

  /**
   * A control plane (`env` adds to / overrides the defaults, e.g. the auth mode); waits for `/api/health` and prints
   * the container's log when it doesn't come up.
   */
  async startControlPlane(name: string, database: string, env: Record<string, string>): Promise<LabControlPlane> {
    const container = `${this.prefix}-${name}-${this.run}`;
    const defaults: Record<string, string> = {
      NODE_ENV: 'development',
      PORT: '3400',
      DB_HOST: this.pg,
      DB_DATABASE: database,
      DB_SSL_MODE: 'disable',
      // The identity module is loaded for every auth mode and refuses to start without a JWT secret outside tests.
      JWT_SECRET: `fleet-it-${name}-${this.run}-jwt-secret`,
      ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
      LOADWEAVER_CLUSTER_NAME: name,
      VALKEY_HOST: this.valkey,
      VALKEY_KEY_PREFIX: name,
      LOADWEAVER_GRPC_ENABLED: 'false',
      LOADWEAVER_WORKLOAD_CONTROLLER: 'off',
      LOADWEAVER_ROLLOUT_CONTROLLER: 'off',
      LOADWEAVER_UPDATE_POLICY: 'off',
      LOADWEAVER_UPDATE_CHECK: 'off',
      LOADWEAVER_OBJECT_STORE: 'off',
      LOADWEAVER_BACKUPS: 'off',
      LOADWEAVER_GIT_SYNC: 'off',
      LOADWEAVER_AUTOSCALER: 'off',
      OPENSEARCH_ENABLED: 'false',
      FILE_STORAGE_PROVIDER: 'local',
      FILE_STORAGE_ROOT: '/tmp/files',
      RATE_LIMIT_ENABLED: 'false',
      VERSION: '1.0.0',
    };

    docker([
      'run',
      '-d',
      '--name',
      container,
      '--memory',
      '768m',
      '--network',
      this.network,
      '-p',
      '127.0.0.1::3400',
      ...Object.entries({ ...defaults, ...env }).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      CONTROL_PLANE_IMAGE,
    ]);
    this.containers.push(container);

    const cp = { container, url: `http://127.0.0.1:${this.hostPort(container, 3400)}` };

    await waitFor(
      `control plane ${container}`,
      async () => (await axios.get(`${cp.url}/api/health`)).status === 200,
    ).catch((error: unknown) => {
      // The container's own output is the only clue when a control plane doesn't come up.
      process.stderr.write(`[fleet-it] ${container} logs:\n${this.logs(container)}\n`);
      throw error;
    });

    return cp;
  }

  logs(container: string, tail = 80): string {
    const logs = spawnSync('docker', ['logs', '--tail', String(tail), container], { encoding: 'utf8' });

    return `${logs.stdout}${logs.stderr}`;
  }

  /** Points the in-process fleet at the lab's Postgres (`database`) and Valkey (before `createApp`). */
  useForFleet(database: string): void {
    Object.assign(process.env, {
      DB_HOST: '127.0.0.1',
      DB_PORT: String(this.hostPort(this.pg, 5432)),
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_DATABASE: database,
      VALKEY_HOST: '127.0.0.1',
      VALKEY_PORT: String(this.hostPort(this.valkey, 6379)),
      VALKEY_KEY_PREFIX: `fleet-${this.run}`,
    });
  }

  /** Removes every container (with its anonymous volumes) and the network; safe to call after failures. */
  teardown(): void {
    for (const c of this.containers.reverse()) {
      try {
        docker(['rm', '-f', '-v', c]);
      } catch {
        // already gone
      }
    }

    try {
      docker(['network', 'rm', this.network]);
    } catch {
      // already gone
    }
  }
}
