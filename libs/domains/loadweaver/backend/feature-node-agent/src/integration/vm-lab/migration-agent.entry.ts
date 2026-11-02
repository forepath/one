/**
 * VM lab driver for the node agent's live-migration side (bundled with esbuild by the VM lab global setup and copied
 * into the VMs). Runs the real classes on a real kernel — `MigrationService`, `CheckpointManager` (runc / CRIU),
 * `RestoredRuntime`, `TransferService` (mutual TLS with node certificates issued by a lab CA), `KeptAddressPlugin`
 * (Docker network + IPAM plugin), `WorkloadManager`, `PodNetworkManager`, `DockerForwardManager`, `VolumeManager` +
 * `VolumePluginServer` (DRBD) — and exposes a small control API on a unix socket, so the test process can play the
 * control plane: the VMs can't reach the test process (they sit behind the lab switch), and a full control plane
 * (Postgres, etcd, the gRPC stream) inside a VM would not fit the lab's memory guard. The test sends exactly the
 * protocol messages the control plane's session state machine sends (`migration-state.utils.ts`) and reads the
 * agent's `migrationProgress` reports back.
 *
 * usage: node migration-agent.js serve
 * env: LOADWEAVER_STATE_DIR (identity.json, node.key / node.crt / ca.crt, applied-state.json written by the test),
 *      LW_LAB_KEY_FILE (LUKS key for volumes), LW_LAB_CONTROL_SOCKET (default /run/lw-mig-lab.sock)
 *
 * API (JSON over HTTP on the unix socket):
 *   POST /apply    { node, network?: NodeNetworkConfig-like, volumes?: VolumeAssignment[], workloads, dnsServers? }
 *   POST /message  { type: migrationPrepare | …, payload }
 *   GET  /progress → MigrationProgress[] (every report so far)
 *   GET  /status   → WorkloadStatus
 */
import { readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  decodeAgentMessage,
  volumeAssignmentSchema,
  workloadSpecSchema,
  type Envelope,
  type NodeNetworkConfig,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import Docker from 'dockerode';

import { CommandRunner } from '../../lib/host/command-runner';
import { MigrationService, type MigrationCommandType } from '../../lib/migration/migration.service';
import { MigrationSessions } from '../../lib/migration/migration-sessions';
import { TransferService } from '../../lib/migration/transfer.service';
import { DockerForwardManager } from '../../lib/network/docker-forward.manager';
import { KeptAddressPlugin } from '../../lib/network/kept-address.plugin';
import { PodNetworkManager } from '../../lib/network/pod-network.manager';
import { AgentStateStore } from '../../lib/state/agent-state.store';
import { VolumePluginServer } from '../../lib/volumes/volume-plugin.server';
import { VolumeManager } from '../../lib/volumes/volume.manager';
import { CheckpointManager } from '../../lib/workloads/checkpoint.manager';
import { RestoredRuntime } from '../../lib/workloads/restored-runtime';
import type { SecretBroker } from '../../lib/workloads/secret-broker.service';
import { WorkloadManager } from '../../lib/workloads/workload.manager';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) chunks.push(chunk as Buffer);

  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'serve') throw new Error('usage: migration-agent.js serve');

  const socket = process.env['LW_LAB_CONTROL_SOCKET'] || '/run/lw-mig-lab.sock';
  const keyFile = process.env['LW_LAB_KEY_FILE'] || '/etc/loadweaver/lab-volume.key';
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  const commands = new CommandRunner();
  const state = new AgentStateStore();
  const secrets = { fetch: async () => await readFile(keyFile) } as unknown as SecretBroker;
  const scanner = { track: () => undefined, scan: async () => null } as never;
  const sessions = new MigrationSessions();
  const restored = new RestoredRuntime(commands, docker);
  const kept = new KeptAddressPlugin(commands, docker);
  const checkpoints = new CheckpointManager(commands, docker);
  const transfer = new TransferService();
  const volumes = new VolumeManager(commands, secrets);
  const plugin = new VolumePluginServer(volumes);
  const workloads = new WorkloadManager(docker, secrets, scanner, sessions, restored, kept);
  const podNetwork = new PodNetworkManager(docker);
  const forward = new DockerForwardManager(commands);
  const migrations = new MigrationService(
    state,
    commands,
    workloads,
    checkpoints,
    restored,
    transfer,
    sessions,
    volumes,
    kept,
  );
  const progress: unknown[] = [];

  migrations.attach((envelope: Envelope) => {
    const decoded = decodeAgentMessage(envelope);
    const payload = decoded.ok ? decoded.message.payload : { invalid: decoded.error };

    progress.push(payload);
    process.stdout.write(`progress ${JSON.stringify(payload)}\n`);

    return true;
  });
  await plugin.start();
  await migrations.recover();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };

    try {
      if (req.method === 'GET' && req.url === '/progress') return reply(200, progress);

      if (req.method === 'GET' && req.url === '/status') return reply(200, await workloads.status());

      if (req.method === 'POST' && req.url === '/message') {
        const { type, payload } = (await body(req)) as { type: MigrationCommandType; payload: never };

        await migrations.handle(type, payload);

        return reply(200, { ok: true });
      }

      if (req.method === 'POST' && req.url === '/apply') {
        const input = await body(req);
        const node = String(input['node']);
        const network = input['network'] as NodeNetworkConfig | undefined;
        let gateways: string[] = [];

        if (network) {
          gateways = (await podNetwork.apply(network)).spec.gateways;
          await forward.apply();
        }

        await volumes.apply(node, volumeAssignmentSchema.array().parse(input['volumes'] ?? []));

        const changed = await workloads.apply(
          workloadSpecSchema.array().parse(input['workloads'] ?? []),
          (input['dnsServers'] as string[] | undefined) ?? gateways,
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
  plugin.onModuleDestroy();
  kept.onModuleDestroy();
  workloads.onModuleDestroy();
  await transfer.onModuleDestroy();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
