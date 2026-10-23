/**
 * VM lab driver for the import of existing Docker hosts and former nodes (3.21; bundled with esbuild by the VM lab
 * global setup and copied into the VMs). Runs the real classes on a real Debian host: `DiscoveryService` (the
 * agent's `discover` command), `ImportExecutor` (component script, rsync pre-copy / final pass, stop / restart of the
 * source, handover check, identity wipe), `VolumeManager` + `VolumePluginServer` (DRBD 9), `PodNetworkManager`,
 * `DockerForwardManager`, `WorkloadManager` and `IngressManager` (Envoy). The test plays the control plane over a
 * small control API on a unix socket, sending the join plan's steps in order (the control plane and its stream don't
 * fit the lab's memory guard, and the VMs can't reach the test process).
 *
 * usage: node import-agent.js discover            (read-only, prints the report; nothing is started)
 *        node import-agent.js serve
 * env: LOADWEAVER_STATE_DIR, LW_LAB_KEY_FILE (LUKS key for volumes), LW_LAB_CONTROL_SOCKET (default /run/lw-import-lab.sock)
 *
 * API (JSON over HTTP on the unix socket):
 *   POST /apply { node, network?, volumes?, workloads?, ingress? }   the desired-state layers the import touches
 *   POST /step  ImportStepCommand                                    → ImportProgress (final)
 *   GET  /status                                                     → WorkloadStatus
 */
import { readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  importStepCommandSchema,
  ingressSchema,
  volumeAssignmentSchema,
  workloadSpecSchema,
  type NodeNetworkConfig,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import Docker from 'dockerode';

import { CommandRunner } from '../../lib/host/command-runner';
import { ManagedContainers } from '../../lib/host/managed-containers';
import { DiscoveryService } from '../../lib/import/discovery.service';
import { ImportExecutor } from '../../lib/import/import-executor.service';
import { IngressManager } from '../../lib/ingress/ingress.manager';
import { MigrationSessions } from '../../lib/migration/migration-sessions';
import { DockerForwardManager } from '../../lib/network/docker-forward.manager';
import { KeptAddressPlugin } from '../../lib/network/kept-address.plugin';
import { PodNetworkManager } from '../../lib/network/pod-network.manager';
import { AgentStateStore } from '../../lib/state/agent-state.store';
import { VolumePluginServer } from '../../lib/volumes/volume-plugin.server';
import { VolumeManager } from '../../lib/volumes/volume.manager';
import { RestoredRuntime } from '../../lib/workloads/restored-runtime';
import type { SecretBroker } from '../../lib/workloads/secret-broker.service';
import { WorkloadManager } from '../../lib/workloads/workload.manager';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) chunks.push(chunk as Buffer);

  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  const commands = new CommandRunner();

  if (process.argv[2] === 'discover') {
    // Exactly what `loadweaver-agent discover` does: nothing else is constructed or started.
    process.stdout.write(`${JSON.stringify(await new DiscoveryService(commands, docker).discover())}\n`);

    return;
  }

  if (process.argv[2] !== 'serve') throw new Error('usage: import-agent.js discover | serve');

  const socket = process.env['LW_LAB_CONTROL_SOCKET'] || '/run/lw-import-lab.sock';
  const keyFile = process.env['LW_LAB_KEY_FILE'] || '/etc/loadweaver/lab-volume.key';
  const state = new AgentStateStore();
  const secrets = { fetch: async () => await readFile(keyFile) } as unknown as SecretBroker;
  const scanner = { track: () => undefined, scan: async () => null } as never;
  const kept = new KeptAddressPlugin(commands, docker);
  const volumes = new VolumeManager(commands, secrets);
  const plugin = new VolumePluginServer(volumes);
  const workloads = new WorkloadManager(
    docker,
    secrets,
    scanner,
    new MigrationSessions(),
    new RestoredRuntime(commands, docker),
    kept,
  );
  const podNetwork = new PodNetworkManager(docker);
  const forward = new DockerForwardManager(commands);
  const ingress = new IngressManager(new ManagedContainers(docker), state, docker);
  const executor = new ImportExecutor(commands, docker, volumes, state);

  await plugin.start();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };

    try {
      if (req.method === 'GET' && req.url === '/status') return reply(200, await workloads.status());

      if (req.method === 'POST' && req.url === '/step')
        return reply(200, await executor.handle(importStepCommandSchema.parse(await body(req))));

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

        const changed = await workloads.apply(workloadSpecSchema.array().parse(input['workloads'] ?? []), gateways);

        if (input['ingress'] !== undefined) await ingress.apply(node, ingressSchema.parse(input['ingress']));

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
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
