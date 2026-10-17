/**
 * VM lab driver for the node agent's backup side (bundled with esbuild by the VM lab global setup and copied into
 * the VMs). Runs the real classes on a real kernel — `BackupService` (LVM thin snapshots under LUKS, read-only
 * mounts, Kopia client containers, hooks, restores), `BackupJobs`, `KopiaServerManager` (repository servers from
 * `backupServer`), `ManagedContainers`, `WorkloadManager` (hook replicas), `VolumeManager` + `VolumePluginServer`
 * (DRBD) — behind a small control API on a unix socket: the VMs can't reach the test process, so the test plays the
 * control plane and sends the protocol messages itself. Only the secret broker is replaced by a key file.
 *
 * usage: node backup-agent.js serve
 * env: LOADWEAVER_STATE_DIR, LW_LAB_KEY_FILE (LUKS key material, default /etc/loadweaver/lab-volume.key),
 *      LW_LAB_CONTROL_SOCKET (default /run/lw-bk-lab.sock)
 *
 * API (JSON over HTTP on the unix socket):
 *   POST /apply    { node, volumes: VolumeAssignment[] }
 *   POST /servers  BackupServerRole (desired state `backupServer`)
 *   POST /message  { type: backupRun | restoreRun, payload }
 *   GET  /progress → BackupProgress[] (every report so far)
 */
import { readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  backupServerRoleSchema,
  decodeAgentMessage,
  volumeAssignmentSchema,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import Docker from 'dockerode';

import { BackupJobs } from '../../lib/backups/backup-jobs';
import { BackupService, type BackupCommandType } from '../../lib/backups/backup.manager';
import { KopiaServerManager } from '../../lib/backups/kopia-server.manager';
import { CommandRunner } from '../../lib/host/command-runner';
import { ManagedContainers } from '../../lib/host/managed-containers';
import { MigrationSessions } from '../../lib/migration/migration-sessions';
import { AgentStateStore } from '../../lib/state/agent-state.store';
import { VolumePluginServer } from '../../lib/volumes/volume-plugin.server';
import { VolumeManager } from '../../lib/volumes/volume.manager';
import type { SecretBroker } from '../../lib/workloads/secret-broker.service';
import { WorkloadManager } from '../../lib/workloads/workload.manager';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) chunks.push(chunk as Buffer);

  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'serve') throw new Error('usage: backup-agent.js serve');

  const socket = process.env['LW_LAB_CONTROL_SOCKET'] || '/run/lw-bk-lab.sock';
  const keyFile = process.env['LW_LAB_KEY_FILE'] || '/etc/loadweaver/lab-volume.key';
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  const commands = new CommandRunner();
  const state = new AgentStateStore();
  const secrets = { fetch: async () => await readFile(keyFile) } as unknown as SecretBroker;
  const scanner = { track: () => undefined, scan: async () => null } as never;
  const sessions = new MigrationSessions();
  const volumes = new VolumeManager(commands, secrets);
  const plugin = new VolumePluginServer(volumes);
  const workloads = new WorkloadManager(docker, secrets, scanner, sessions);
  const containers = new ManagedContainers(docker);
  const servers = new KopiaServerManager(containers, state);
  const backups = new BackupService(
    commands,
    volumes,
    secrets,
    workloads,
    new BackupJobs(docker, containers),
    state,
    sessions,
  );
  const progress: unknown[] = [];

  backups.attach((envelope: Envelope) => {
    const decoded = decodeAgentMessage(envelope);
    const payload = decoded.ok ? decoded.message.payload : { invalid: decoded.error };

    progress.push(payload);
    process.stdout.write(`progress ${JSON.stringify(payload)}\n`);

    return true;
  });
  await plugin.start();
  await backups.recover();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };

    try {
      if (req.method === 'GET' && req.url === '/progress') return reply(200, progress);

      if (req.method === 'POST' && req.url === '/message') {
        const { type, payload } = (await body(req)) as { type: BackupCommandType; payload: unknown };

        await backups.handle(type, payload);

        return reply(200, { ok: true });
      }

      if (req.method === 'POST' && req.url === '/servers')
        return reply(200, { changed: await servers.apply(backupServerRoleSchema.parse(await body(req))) });

      if (req.method === 'POST' && req.url === '/apply') {
        const input = await body(req);
        const changed = await volumes.apply(
          String(input['node']),
          volumeAssignmentSchema.array().parse(input['volumes'] ?? []),
        );

        return reply(200, { changed });
      }

      reply(404, { error: 'unknown endpoint' });
    } catch (error) {
      reply(500, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  await rm(socket, { force: true });

  const server = createServer((req, res) => void handle(req, res));

  await new Promise<void>((resolve) => server.listen(socket, () => resolve()));
  process.stdout.write('ready\n');
  await new Promise<void>((resolve) => process.once('SIGTERM', () => resolve()));
  server.close();
  await backups.idle();
  plugin.onModuleDestroy();
  workloads.onModuleDestroy();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
