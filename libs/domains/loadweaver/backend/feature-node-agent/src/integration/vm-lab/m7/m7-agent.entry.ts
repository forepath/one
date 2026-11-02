/**
 * VM lab driver for the node agent's M7 side (isolation levels, microVMs, full VMs, consoles, QEMU live migration),
 * bundled with decorator metadata by the M7 global setup and copied into the VMs. It is the agent's real Nest module
 * (`NodeAgentModule`, every provider as the agent wires it — no hand-made constructors), without the control-plane
 * stream: the test process plays the control plane through a small control API on a unix socket, sending exactly the
 * protocol messages the control plane sends and reading the agent's messages back. A full control plane per node
 * doesn't fit the lab's memory guard next to nested guests (the cluster specs use the real one).
 *
 * Lab changes (nothing else): secrets come from a file instead of the stream (`SecretBroker.fetch`), and the agent's
 * outgoing messages (live output, migration progress, VM events) are collected instead of sent.
 *
 * usage: node m7-agent.js serve
 * env: LOADWEAVER_STATE_DIR (identity.json, node.key / node.crt / ca.crt, applied-state.json written by the test),
 *      LW_LAB_SECRETS_FILE (JSON `{ "<secret ref>": "<value>" }`, default /etc/loadweaver/lab-secrets.json),
 *      LW_LAB_KEY_FILE (LUKS key for every volume, default /etc/loadweaver/lab-volume.key),
 *      LW_LAB_CONTROL_SOCKET (default /run/lw-m7-lab.sock), LOADWEAVER_MICROVM_LAUNCHER_IMAGE (the lab's launcher)
 *
 * API (JSON over HTTP on the unix socket):
 *   GET  /isolation[?fresh=1]   → IsolationReport (fresh: a new probe now)
 *   POST /host                  { kvm?: 'auto' | 'disabled', probeNonce? } → desiredState.host applied
 *   GET  /capabilities          → NodeCapabilities (what the hello would carry)
 *   POST /apply                 { node, network?, volumes?, workloads, dnsServers? } → { changed }
 *   GET  /status                → WorkloadStatus (with the VM annotations)
 *   POST /vm                    { type: vmPower | vmImageImport, payload }
 *   POST /migration             { type: vmMigration* | migration* , payload }
 *   POST /live                  { op: terminal | input | resize | close | console | file, channel, payload }
 *   GET  /messages?since=<seq>  → [{ seq, type, channel, payload }] (the agent's outgoing messages)
 *
 * Any other command (e.g. the internal `unpack-layer` the rootfs cache spawns) runs the real agent CLI.
 */
import { readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { NestFactory } from '@nestjs/core';
import {
  decodeAgentMessage,
  volumeAssignmentSchema,
  workloadSpecSchema,
  type ConsoleOpen,
  type Envelope,
  type ExecOpen,
  type FileRequest,
  type NodeNetworkConfig,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { HostInfoService } from '../../../lib/host/host-info.service';
import { IsolationProbeService } from '../../../lib/host/isolation-probe.service';
import { LiveSessionsService } from '../../../lib/live/live-sessions.service';
import { runAgentCli } from '../../../lib/join/agent-cli';
import { MigrationService, type MigrationCommandType } from '../../../lib/migration/migration.service';
import { VmMigrationService } from '../../../lib/migration/vm-migration.service';
import { DockerForwardManager } from '../../../lib/network/docker-forward.manager';
import { PodNetworkManager } from '../../../lib/network/pod-network.manager';
import { NodeAgentModule } from '../../../lib/node-agent.module';
import { VmSupport, type VmMessageType } from '../../../lib/vm/vm-support.service';
import { VolumePluginServer } from '../../../lib/volumes/volume-plugin.server';
import { VolumeManager } from '../../../lib/volumes/volume.manager';
import { SecretBroker } from '../../../lib/workloads/secret-broker.service';
import { WorkloadManager } from '../../../lib/workloads/workload.manager';

const SECRETS_FILE = process.env['LW_LAB_SECRETS_FILE'] || '/etc/loadweaver/lab-secrets.json';
const KEY_FILE = process.env['LW_LAB_KEY_FILE'] || '/etc/loadweaver/lab-volume.key';

// Secrets from the lab's file (the control plane would deliver them over the stream). Volume keys: one lab key.
SecretBroker.prototype.fetch = async function (_workload: string, ref: string): Promise<Buffer> {
  if (/^secret:\/\/[a-z0-9-]+\/lw-volume-/.test(ref)) return await readFile(KEY_FILE);

  const secrets = JSON.parse(await readFile(SECRETS_FILE, 'utf8').catch(() => '{}')) as Record<string, string>;
  const value = secrets[ref] ?? secrets[ref.replace(/@\d+$/, '')];

  if (value === undefined) throw new Error(`secret request refused: ${ref} (not in the lab's secrets file)`);

  return Buffer.from(value, 'utf8');
};

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) chunks.push(chunk as Buffer);

  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
}

interface Message {
  seq: number;
  type: string;
  channel?: string;
  payload: unknown;
}

async function main(): Promise<void> {
  // The agent re-executes its own entry for internal commands (`unpack-layer` under `unshare` for the microVM rootfs
  // cache): those go to the real agent CLI, as in `loadweaver-agent`.
  if (process.argv[2] !== 'serve') return await runAgentCli(process.argv.slice(2), 'usage: m7-agent.js serve');

  const socket = process.env['LW_LAB_CONTROL_SOCKET'] || '/run/lw-m7-lab.sock';
  const app = await NestFactory.createApplicationContext(NodeAgentModule, { logger: ['log', 'warn', 'error'] });
  const isolation = app.get(IsolationProbeService);
  const hostInfo = app.get(HostInfoService);
  const workloads = app.get(WorkloadManager);
  const volumes = app.get(VolumeManager);
  const plugin = app.get(VolumePluginServer);
  const podNetwork = app.get(PodNetworkManager);
  const forward = app.get(DockerForwardManager);
  const vms = app.get(VmSupport);
  const vmMigrations = app.get(VmMigrationService);
  const migrations = app.get(MigrationService);
  const live = app.get(LiveSessionsService);
  const messages: Message[] = [];
  let seq = 0;
  const collect = (envelope: Envelope) => {
    const decoded = decodeAgentMessage(envelope);
    const message: Message = decoded.ok
      ? { seq: ++seq, type: decoded.message.type, channel: envelope.channel, payload: decoded.message.payload }
      : { seq: ++seq, type: envelope.type, channel: envelope.channel, payload: { invalid: decoded.error } };

    messages.push(message);

    // Live output is chatty: only the rest goes to the journal.
    if (!/^(execOutput|fileResult)$/.test(message.type))
      process.stdout.write(`message ${JSON.stringify(message).slice(0, 2000)}\n`);

    return true;
  };

  migrations.attach(collect);
  vmMigrations.attach(collect);
  vms.attach(collect);
  live.attach(collect);
  await plugin.start();
  await migrations.recover();
  await vmMigrations.recover();
  await vms.watch();
  await live.watchConsoles();
  workloads.watchStarts();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const url = new URL(req.url ?? '/', 'http://lab');

    try {
      if (req.method === 'GET' && url.pathname === '/isolation')
        return reply(200, url.searchParams.get('fresh') ? await isolation.reprobe('lab') : await isolation.current());

      if (req.method === 'POST' && url.pathname === '/host') {
        await isolation.applyHost((await body(req)) as never);

        return reply(200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/capabilities') return reply(200, await hostInfo.capabilities());

      if (req.method === 'GET' && url.pathname === '/status')
        return reply(200, await vms.annotate(await workloads.status()));

      if (req.method === 'GET' && url.pathname === '/messages') {
        const since = Number(url.searchParams.get('since') ?? 0);

        return reply(
          200,
          messages.filter((m) => m.seq > since),
        );
      }

      if (req.method === 'POST' && url.pathname === '/apply') {
        const input = await body(req);
        const node = String(input['node']);
        const network = input['network'] as NodeNetworkConfig | undefined;
        let gateways: string[] = [];

        if (network) {
          gateways = (await podNetwork.apply(network)).spec.gateways;
          await forward.apply();
        }

        // As the reconciler: replicas that go away first, then volumes, then the remaining workloads.
        await workloads.removeUndesired(workloadSpecSchema.array().parse(input['workloads'] ?? []));
        await volumes.apply(node, volumeAssignmentSchema.array().parse(input['volumes'] ?? []));

        const changed = await workloads.apply(
          workloadSpecSchema.array().parse(input['workloads'] ?? []),
          (input['dnsServers'] as string[] | undefined) ?? gateways,
        );

        return reply(200, { changed });
      }

      if (req.method === 'POST' && url.pathname === '/vm') {
        const { type, payload } = (await body(req)) as { type: VmMessageType; payload: unknown };

        await vms.handle(type, payload);

        return reply(200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/migration') {
        const { type, payload } = (await body(req)) as {
          type: string;
          payload: { migration: string; attempt: number; role?: 'source' | 'target' };
        };
        const vmSession =
          type.startsWith('vmMigration') ||
          ((type === 'migrationCommit' || type === 'migrationAbort') &&
            vmMigrations.owns(payload.role ?? 'source', payload.migration, payload.attempt));

        if (vmSession) await vmMigrations.handle(type as never, payload as never);
        else await migrations.handle(type as MigrationCommandType, payload as never);

        return reply(200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/live') {
        const { op, channel, payload } = (await body(req)) as { op: string; channel: string; payload: unknown };

        switch (op) {
          case 'terminal':
            await live.openTerminal(channel, payload as ExecOpen);
            break;
          case 'input': {
            const p = payload as { data: string; eof?: boolean };

            live.input(channel, p.data, p.eof === true);
            break;
          }
          case 'resize': {
            const p = payload as { cols: number; rows: number };

            await live.resize(channel, p.cols, p.rows);
            break;
          }
          case 'close':
            await live.closeTerminal(channel);
            break;
          case 'console':
            await live.openConsole(channel, payload as ConsoleOpen);
            break;
          case 'file':
            await live.file(channel, payload as FileRequest);
            break;
          default:
            return reply(400, { error: `unknown live op ${op}` });
        }

        return reply(200, { ok: true });
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
  await app.close();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
