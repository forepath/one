/**
 * VM lab driver for the node agent's update side (3.26, bundled with esbuild by the VM lab global setup and copied
 * into the VMs). Runs the real `UpdatesService` — release verification with the agent's trust rules, the self-update
 * (download by checksum, transient-unit swap, rollback timer, confirmation), host updates from the cluster-local apt
 * snapshot (transient unit, pinned packages, DRBD for the next kernel), reboots on a token and the component report —
 * as a systemd service, and exposes a control API on a unix socket so the test can play the control plane (the VMs
 * can't reach the test process).
 *
 * usage: node updates-agent.js serve   (started by systemd through /usr/local/bin/loadweaver-agent)
 * env: LOADWEAVER_STATE_DIR (identity.json with the lab's "control plane" URL), LOADWEAVER_AGENT_VERSION,
 *      LOADWEAVER_RELEASE_DEV_KEYS, LOADWEAVER_SELF_UPDATE_CONFIRM_SECONDS, LW_LAB_CONTROL_SOCKET
 *
 * API (JSON over HTTP on the unix socket):
 *   GET  /version      → { version, pid }
 *   POST /apply        { components?, role, address } → { changed }   (the reconciler's `components` layer)
 *   POST /after-apply  { components? } → {}                             (after an applied desired state)
 *   GET  /report       → ComponentVersions
 */
import { rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { ControlPlaneRole, DesiredState, NodeComponents } from '@forepath/loadweaver/shared/util-agent-protocol';
import Docker from 'dockerode';

import { CommandRunner } from '../../lib/host/command-runner';
import { HostInfoService } from '../../lib/host/host-info.service';
import { AgentStateStore } from '../../lib/state/agent-state.store';
import { AGENT_VERSION } from '../../lib/updates/agent-version';
import { UpdatesService } from '../../lib/updates/updates.service';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) chunks.push(chunk as Buffer);

  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'serve') throw new Error('usage: updates-agent.js serve');

  const socket = process.env['LW_LAB_CONTROL_SOCKET'] || '/run/lw-updates-lab.sock';
  const commands = new CommandRunner();
  const updates = new UpdatesService(
    new AgentStateStore(),
    commands,
    new HostInfoService(commands),
    new Docker({ socketPath: '/var/run/docker.sock' }),
  );
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };

  await rm(socket, { force: true });
  createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'GET' && req.url === '/version')
          return json(res, 200, { version: AGENT_VERSION, pid: process.pid });

        if (req.method === 'GET' && req.url === '/report') return json(res, 200, await updates.report());

        const input = await body(req);

        if (req.method === 'POST' && req.url === '/apply') {
          const changed = await updates.apply(
            input['components'] as NodeComponents | undefined,
            input['role'] as ControlPlaneRole,
            input['address'] as string,
          );

          // The lab has no reconciler: the apply is complete once the components layer ran.
          await updates.confirmApplied((input['components'] as NodeComponents | undefined)?.release);

          return json(res, 200, { changed });
        }

        if (req.method === 'POST' && req.url === '/after-apply') {
          await updates.afterApply({ components: input['components'] } as DesiredState);

          return json(res, 200, {});
        }

        json(res, 404, { error: 'not found' });
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  }).listen(socket, () => process.stderr.write(`updates-agent ${AGENT_VERSION} listening on ${socket}\n`));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
