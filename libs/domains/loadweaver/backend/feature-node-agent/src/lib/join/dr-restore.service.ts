import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { ControlPlaneRoleManager } from '../control-plane/control-plane-role.manager';
import { controlPlaneImages } from '../control-plane/control-plane-containers';
import { writeScopeMarker } from '../control-plane/postgres-cutover';
import { DOCKER } from '../host/docker.provider';
import { ManagedContainers } from '../host/managed-containers';
import { AgentStateStore } from '../state/agent-state.store';
import {
  drToolRequest,
  etcdRestoreArgs,
  postgresRestoreScript,
  recoveryIdentity,
  restoredEnvironment,
  type DrToolResult,
  type RestoreOptions,
} from './dr-restore.utils';
import { JoinService, randomJoinToken } from './join.service';

const API = 'http://127.0.0.1:3400';
const SECRET_HEADER = 'x-loadweaver-dr-secret';

export interface DrRestoreSummary {
  clusterId: string;
  backup: string;
  postgresScope: string;
  backupFinishedAt: string | null;
  previousNodes: string[];
  timings: Record<string, number>;
}

/**
 * Whole-cluster disaster recovery on a fresh node (3.20): `loadweaver-agent bootstrap --restore`.
 * 1. The control-plane image's DR tool unlocks the backup key (recovery kit shares or KMS escrow), finds the newest
 *    complete control-plane backup on the external target, decrypts it (base backup, WAL, etcd snapshot) into the
 *    state directory and opens its DR envelope (environment, master key).
 * 2. etcd is restored from its snapshot (`etcdutl`), Patroni's old keys removed (the members are gone).
 * 3. Postgres: WAL-G fetches the base backup, Postgres replays the WAL (to the end, or the target time) and promotes.
 * 4. The control plane starts on this node as its only member with the restored environment; the node joins it and
 *    hands over the master key; the API marks the previous nodes lost, forms the object store anew, re-seeds the backup
 *    repositories from the external target and restores the volumes (`DrRecoveryService`).
 * The decrypted staging data is removed at the end.
 */
@Injectable()
export class DrRestoreService {
  private readonly logger = new Logger(DrRestoreService.name);

  constructor(
    private readonly state: AgentStateStore,
    private readonly controlPlane: ControlPlaneRoleManager,
    private readonly join: JoinService,
    private readonly containers: ManagedContainers,
    @Inject(DOCKER) private readonly docker: Docker,
  ) {}

  /** Runs a one-shot container, streams its output to the log, fails on a non-zero exit. */
  private async oneShot(
    name: string,
    spec: {
      image: string;
      entrypoint?: string[];
      cmd: string[];
      binds: string[];
      network: 'host' | 'none';
      user?: string;
      env?: Record<string, string>;
    },
    onLine: (line: string) => void,
  ): Promise<void> {
    const image = await this.containers.pull(spec.image);

    await this.docker
      .getContainer(name)
      .remove({ force: true })
      .catch(() => undefined);

    const container = await this.docker.createContainer({
      name,
      Image: image,
      ...(spec.entrypoint ? { Entrypoint: spec.entrypoint } : {}),
      Cmd: spec.cmd,
      ...(spec.user ? { User: spec.user } : {}),
      ...(spec.env ? { Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`) } : {}),
      Labels: { 'loadweaver.com/component': 'dr-restore' },
      HostConfig: { Binds: spec.binds, NetworkMode: spec.network, AutoRemove: false },
    });

    try {
      const stream = await container.attach({ stream: true, stdout: true, stderr: true });
      let buffer = '';
      const out = {
        write: (chunk: Buffer) => {
          buffer += chunk.toString('utf8');

          let index: number;

          while ((index = buffer.indexOf('\n')) >= 0) {
            onLine(buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
          }

          return true;
        },
      };

      this.docker.modem.demuxStream(stream, out as never, out as never);
      await container.start();

      const { StatusCode } = (await container.wait()) as { StatusCode: number };

      if (buffer) onLine(buffer);

      if (StatusCode !== 0) throw new Error(`${name} exited with ${StatusCode}`);
    } finally {
      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  async restore(
    options: RestoreOptions,
    progress: (line: string) => void = (l) => this.logger.log(l),
  ): Promise<DrRestoreSummary> {
    if (await this.state.credentials()) throw new Error('this node already belongs to a cluster');

    if (!options.key) throw new Error('the recovery kit shares or a KMS are needed');

    const timings: Record<string, number> = {};
    const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const started = Date.now();

      progress(`[restore] ${label} …`);

      const result = await fn();

      timings[label] = Math.round((Date.now() - started) / 100) / 10;
      progress(`[restore] ${label} done (${timings[label]} s)`);

      return result;
    };
    const stateDir = this.state.dir;
    const staging = join(stateDir, 'dr');
    // The request carries kit shares and target credentials: tmpfs, 0600, removed right after the tool read it.
    const requestDir = join('/run/loadweaver', `dr-${process.pid}`);
    const images = controlPlaneImages();

    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true, mode: 0o700 });

    try {
      // 1. Key, newest complete backup, download + decrypt (the control-plane image's DR tool).
      const result = await step('fetch the control-plane backup from the external target', async () => {
        await mkdir(requestDir, { recursive: true, mode: 0o700 });
        await writeFile(join(requestDir, 'request.json'), JSON.stringify(drToolRequest(options, '/dr')), {
          mode: 0o600,
        });

        try {
          await this.oneShot(
            'lw-dr-tool',
            {
              image: images.controlPlane,
              entrypoint: ['bash', '-c', '. "$NVM_DIR/nvm.sh" && exec node main.js dr /dr-request/request.json'],
              cmd: [],
              binds: [`${requestDir}:/dr-request:ro`, `${staging}:/dr`],
              network: 'host',
              user: '0',
              // The image's modules check auth settings when they load; the tool uses none of them.
              env: { JWT_SECRET: randomBytes(32).toString('base64url'), NODE_ENV: 'production' },
            },
            (line) => progress(`  ${line}`),
          );
        } finally {
          await rm(requestDir, { recursive: true, force: true });
        }

        const raw = await readFile(join(staging, 'result.json'), 'utf8');

        await rm(join(staging, 'result.json'), { force: true });

        return JSON.parse(raw) as DrToolResult;
      });

      progress(
        `[restore] cluster ${result.clusterId}: base backup ${result.backup} (finished ${result.backupFinishedAt ?? '?'}), scope ${result.postgresScope}, ${result.objects} objects`,
      );

      // 2. etcd from its snapshot, this node as the only member; Patroni's keys of the lost members removed.
      if (result.etcdSnapshot) {
        const snapshot = result.etcdSnapshot;

        await step('restore etcd', async () => {
          await rm(join(stateDir, 'etcd'), { recursive: true, force: true });
          await rm(join(stateDir, 'etcd-restore'), { recursive: true, force: true });
          await this.oneShot(
            'lw-dr-etcdutl',
            {
              image: images.etcd,
              cmd: etcdRestoreArgs({
                snapshot: `/dr/${snapshot}`,
                node: options.nodeName,
                clusterId: result.clusterId,
                dataDir: '/state/etcd-restore',
              }),
              binds: [`${staging}:/dr:ro`, `${stateDir}:/state`],
              network: 'none',
            },
            (line) => progress(`  ${line}`),
          );
          await mkdir(join(stateDir, 'etcd'), { recursive: true, mode: 0o700 });
          await rename(join(stateDir, 'etcd-restore', 'member'), join(stateDir, 'etcd', 'member'));
          await rm(join(stateDir, 'etcd-restore'), { recursive: true, force: true });
          await this.dropPatroniKeys(images.etcd, stateDir, options.nodeName);
        });
      }

      // 3. Postgres: base backup + WAL replay, promoted; Patroni adopts it when Spilo starts.
      await step('restore the control-plane database', async () => {
        await rm(join(stateDir, 'postgres'), { recursive: true, force: true });
        await mkdir(join(stateDir, 'postgres'), { recursive: true, mode: 0o700 });
        await writeFile(
          join(staging, 'pg-restore.sh'),
          postgresRestoreScript({
            walgPrefix: result.walgPrefix,
            backup: result.backup,
            ...(options.targetTime ? { targetTime: options.targetTime } : {}),
          }),
          { mode: 0o755 },
        );
        await this.oneShot(
          'lw-dr-postgres',
          {
            image: images.postgres,
            entrypoint: ['bash'],
            cmd: ['/dr/pg-restore.sh'],
            binds: [`${staging}:/dr`, `${join(stateDir, 'postgres')}:/home/postgres/pgdata`],
            network: 'none',
          },
          (line) => progress(`  ${line}`),
        );
        await writeScopeMarker(stateDir, result.postgresScope);
      });

      // 4. The control plane on this node, then join and hand over the master key.
      const joinToken = randomJoinToken();
      const recovery = recoveryIdentity(joinToken);
      const environment = restoredEnvironment(result, options, recovery);

      await step('start the control plane', async () => {
        await this.controlPlane.apply(options.nodeName, '127.0.0.1', {
          role: 'member',
          members: [{ name: options.nodeName, address: '127.0.0.1', witness: false }],
          automaticFailover: false,
          scope: result.clusterId,
          ...(result.postgresScope !== result.clusterId ? { postgresScope: result.postgresScope } : {}),
          environment,
        });
        await this.waitFor(`${API}/api/health`, 10 * 60_000);
      });

      await step('join the restored cluster', async () => {
        await this.join.join({
          server: API,
          token: joinToken,
          nodeName: options.nodeName,
          endpointHost: options.publicHost,
        });
      });

      const status = await step('hand over the master key', async () => {
        const value = Buffer.from(result.masterKey.value, 'base64');

        result.masterKey.value = '';

        const res = await fetch(`${API}/api/dr/master-key`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [SECRET_HEADER]: recovery.secret },
          body: JSON.stringify({ keyId: result.masterKey.id, masterKey: value.toString('base64') }),
          signal: AbortSignal.timeout(60_000),
        });

        value.fill(0);

        if (!res.ok)
          throw new Error(`the control plane refused the master key (HTTP ${res.status}: ${await res.text()})`);

        // Sealed to this node's key with the next membership change (join → recompile → re-share).
        const deadline = Date.now() + 5 * 60_000;

        for (;;) {
          const current = (await (
            await fetch(`${API}/api/dr/status`, {
              headers: { [SECRET_HEADER]: recovery.secret },
              signal: AbortSignal.timeout(10_000),
            })
          ).json()) as { masterKeyResealed: boolean; previousNodes: string[] };

          if (current.masterKeyResealed) return current;

          if (Date.now() > deadline) throw new Error('the master key was not re-sealed to this node in time');

          await sleep(2_000);
        }
      });

      return {
        clusterId: result.clusterId,
        backup: result.backup,
        postgresScope: result.postgresScope,
        backupFinishedAt: result.backupFinishedAt,
        previousNodes: status.previousNodes,
        timings,
      };
    } finally {
      if (!options.keepStaging) await rm(staging, { recursive: true, force: true });

      await rm(requestDir, { recursive: true, force: true });
    }
  }

  /** Patroni's keys of the lost cluster (`/service/…`) would make it wait for members that are gone. */
  private async dropPatroniKeys(image: string, stateDir: string, node: string): Promise<void> {
    const name = 'lw-dr-etcd';
    const port = 23799;

    await this.docker
      .getContainer(name)
      .remove({ force: true })
      .catch(() => undefined);

    const container = await this.docker.createContainer({
      name,
      Image: await this.containers.pull(image),
      Cmd: [
        'etcd',
        '--name',
        node,
        '--data-dir',
        '/var/lib/etcd',
        '--listen-client-urls',
        `http://127.0.0.1:${port}`,
        '--advertise-client-urls',
        `http://127.0.0.1:${port}`,
        '--listen-peer-urls',
        'http://127.0.0.1:23800',
      ],
      HostConfig: { Binds: [`${stateDir}/etcd:/var/lib/etcd`], NetworkMode: 'host' },
    });

    try {
      await container.start();

      const url = `http://127.0.0.1:${port}/v3/kv/deleterange`;
      const body = JSON.stringify({
        key: Buffer.from('/service/').toString('base64'),
        range_end: Buffer.from('/service0').toString('base64'),
      });
      const deadline = Date.now() + 60_000;

      for (;;) {
        const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(5_000) }).catch(() => null);

        if (res?.ok) break;

        if (Date.now() > deadline) throw new Error('the restored etcd did not start');

        await sleep(1_000);
      }
    } finally {
      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  private async waitFor(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const ok = await fetch(url, { signal: AbortSignal.timeout(2_000) })
        .then((r) => r.ok)
        .catch(() => false);

      if (ok) return;

      if (Date.now() > deadline) throw new Error(`${url} did not become healthy`);

      await sleep(2_000);
    }
  }
}
