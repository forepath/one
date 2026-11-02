import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type Socket as NetSocket } from 'node:net';
import { stdin, stdout } from 'node:process';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

import { generateWireguardKeyPair } from '@forepath/loadweaver/shared/util-pki';
import { io, type Socket } from 'socket.io-client';

import { Api, ApiError } from './api';
import { loadConfig, saveConfig, writePrivateFile, type CliConfig } from './config';
import {
  FINAL_STATUSES,
  isLogin2faRequired,
  isPersonalAccessToken,
  parsePortMapping,
  parseReplica,
  progressLine,
  withPrivateKey,
} from './format.utils';

type Out = (line: string) => void;

/** Packets queued in the socket.io client before a local connection is paused until they are flushed. */
export const MAX_QUEUED_PACKETS = 64;
/** Bytes queued for a local connection before it is closed (the remote side of a tunnel can't be paused). */
export const MAX_LOCAL_BUFFER = 16 * 1024 * 1024;

export async function client(): Promise<Api> {
  const config = await loadConfig();

  if (!config.url) throw new Error('not logged in: run `loadweaver login --url <control plane>`');

  return new Api({ ...config, url: config.url });
}

/** Sockets refuse personal access tokens (interactive sessions only), so fail before connecting. */
function requireSession(api: Api, command: string): void {
  if (api.config.token && isPersonalAccessToken(api.config.token))
    throw new Error(
      `${command} needs an interactive login: loadweaver login --email <email> (sockets refuse personal access tokens)`,
    );
}

function connect(api: Api, namespace: 'plans' | 'tunnels'): Socket {
  return io(`${api.base}/socket/${namespace}`, {
    transports: ['websocket'],
    auth: { Authorization: `Bearer ${api.config.token}` },
  });
}

/** Rejects on the socket's first `connect_error` (e.g. refused authentication), so the CLI exits with an error. */
function failure(socket: Socket, namespace: string): Promise<never> {
  const failed = new Promise<never>((_, reject) =>
    socket.on('connect_error', (error: Error) => {
      socket.close();
      reject(new Error(`socket/${namespace}: ${error.message}`));
    }),
  );

  failed.catch(() => undefined);

  return failed;
}

/** Asks on the terminal; a hidden answer isn't echoed, the question still is. */
export async function ask(
  question: string,
  hidden = false,
  input: NodeJS.ReadableStream = stdin,
  output: NodeJS.WritableStream = stdout,
): Promise<string> {
  // The callback interface: it still routes echo through the overridable `_writeToOutput` (the promises one doesn't).
  const rl = createInterface({ input, output, terminal: true });

  // Readline redraws "<prompt><line>" through `_writeToOutput`; keep the prompt, drop what is typed.
  if (hidden)
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.startsWith(question)) output.write(question);
    };

  try {
    return await new Promise<string>((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
  } finally {
    rl.close();
    if (hidden) output.write('\n');
  }
}

/** Reads a token piped into the CLI (`--token -`). */
async function readToken(input: NodeJS.ReadableStream): Promise<string> {
  let text = '';

  for await (const chunk of input) text += chunk.toString();

  const token = text.trim();

  if (!token) throw new Error('--token -: no token on stdin');

  return token;
}

/**
 * `login --url <cp> [--token <PAT>|-] [--email <e>]`: stores a token (from `--token`, stdin with `--token -` or
 * `LOADWEAVER_TOKEN`), or signs in with email + password (+ 2FA code) for an interactive session (needed for
 * sockets and VPN enrollment, 3.31).
 */
export async function login(
  args: { url?: string; token?: string; email?: string },
  out: Out,
  terminal: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = { input: stdin, output: stdout },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const current = await loadConfig(env);
  const url = args.url ?? current.url;

  if (!url) throw new Error('--url is required the first time');

  const api = new Api({ url });
  let token =
    args.token === '-'
      ? await readToken(terminal.input)
      : (args.token ?? (args.email ? undefined : env['LOADWEAVER_TOKEN'] || undefined));

  if (!token) {
    const email = args.email ?? (await ask('Email: ', false, terminal.input, terminal.output));
    const password = await ask('Password: ', true, terminal.input, terminal.output);
    let code: string | undefined;

    for (;;) {
      try {
        token = (
          await api.request<{ access_token: string }>('POST', '/auth/login', {
            email,
            password,
            ...(code ? { code } : {}),
          })
        ).access_token;
        break;
      } catch (error) {
        if (!code && error instanceof ApiError && isLogin2faRequired(error.body)) {
          code = await ask('Second-factor code: ', false, terminal.input, terminal.output);
          continue;
        }

        throw error;
      }
    }
  }

  // Checks the token right away with a call every authenticated user may make (scoped per caller).
  await api.request('GET', '/overview', undefined, token);
  await saveConfig({ url, token } satisfies CliConfig, env);
  out(`Logged in to ${url}`);
}

/** `plan -f <file>... [--apply] [--watch]`: plans YAML documents (and optionally applies them). */
export async function plan(args: { files: string[]; apply?: boolean; watch?: boolean }, out: Out): Promise<void> {
  if (args.files.length === 0) throw new Error('give one or more -f <file.yaml>');

  const api = await client();

  if (args.apply && args.watch) requireSession(api, '--watch');

  const documents = (await Promise.all(args.files.map((f) => readFile(f, 'utf8')))).join('\n---\n');
  const created = await api.request<{
    id: string;
    status: string;
    changes: { action: string; kind: string; name: string; project?: string | null }[];
    warnings?: unknown[];
  }>('POST', '/plans', { documents });

  out(`Plan ${created.id}`);

  for (const c of created.changes.filter((x) => x.action !== 'unchanged'))
    out(`  ${c.action.padEnd(7)} ${c.kind} ${c.project ? `${c.project}/` : ''}${c.name}`);

  if (args.apply) await apply({ id: created.id, watch: args.watch }, out);
}

/** `apply <plan> [--watch]`: applies and, with `--watch`, follows the progress until it settles. */
export async function apply(args: { id: string; watch?: boolean }, out: Out): Promise<void> {
  const api = await client();

  if (args.watch) requireSession(api, '--watch');

  const applied = await api.request<{
    id: string;
    status: string;
    progress?: { step?: string; percent?: number } | null;
  }>('POST', `/plans/${encodeURIComponent(args.id)}/apply`, {});

  out(progressLine(applied));

  if (args.watch && !FINAL_STATUSES.has(applied.status)) await watch({ id: args.id }, out);
}

/** Follows a plan over the live plans channel (3.19) until it reaches a final status. */
export async function watch(args: { id: string }, out: Out): Promise<void> {
  const api = await client();

  requireSession(api, 'watch');

  const socket = connect(api, 'plans');
  const failed = failure(socket, 'plans');

  await Promise.race([
    failed,
    new Promise<void>((resolve) => {
      let last = '';
      const show = (p: { id: string; status: string; progress?: { step?: string; percent?: number } | null }) => {
        if (p.id !== args.id) return;

        const line = progressLine(p);

        if (line !== last) out((last = line));

        if (FINAL_STATUSES.has(p.status)) {
          socket.close();
          resolve();
        }
      };

      socket.on('plansSnapshot', (s: { plans: { id: string; status: string }[] }) => s.plans.forEach(show));
      socket.on('planPatch', show);
    }),
  ]);
}

/** Resolves on Ctrl+C (or when the given signal aborts, e.g. in tests). */
function interrupted(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) process.once('SIGINT', () => resolve());
    else if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** `port-forward <project/deployment/service[/n]> <[local:]remote> [--ttl s]`: a local port through a debug tunnel. */
export async function portForward(
  args: { replica: string; ports: string; ttl?: number; signal?: AbortSignal },
  out: Out,
): Promise<void> {
  const api = await client();

  requireSession(api, 'port-forward');

  const replica = parseReplica(args.replica);
  const { local, remote } = parsePortMapping(args.ports);
  const socket = connect(api, 'tunnels');
  const failed = failure(socket, 'tunnels');
  const connections = new Map<string, NetSocket>();
  let next = 0;

  socket.on('tunnelOpened', (m: { tunnelId: string }) => connections.get(m.tunnelId)?.resume());
  socket.on('tunnelData', (m: { tunnelId: string; data: string }) => {
    const conn = connections.get(m.tunnelId);

    if (!conn) return;

    conn.write(Buffer.from(m.data, 'base64'));

    // The node can't be paused: bound what piles up for a local client that doesn't read.
    if (conn.writableLength > MAX_LOCAL_BUFFER) {
      out(`tunnel: the local client of ${m.tunnelId} doesn't keep up, closing the connection`);
      conn.destroy();
    }
  });
  socket.on('tunnelClosed', (m: { tunnelId: string; reason?: string }) => {
    connections.get(m.tunnelId)?.end();
    connections.delete(m.tunnelId);
  });
  socket.on('tunnelError', (m: { tunnelId?: string; message: string }) => {
    out(`tunnel: ${m.message}`);
    if (m.tunnelId) connections.get(m.tunnelId)?.destroy();
  });

  const server = createServer((conn) => {
    const tunnelId = `c${next++}`;

    connections.set(tunnelId, conn);
    conn.pause(); // until `tunnelOpened` for this tunnel
    socket.emit('openTunnel', { tunnelId, replica, port: remote, ttlSeconds: args.ttl ?? 3600 });
    conn.on('data', (chunk: Buffer) => {
      socket.emit('tunnelData', { tunnelId, data: chunk.toString('base64') });

      // Backpressure: stop reading while the socket.io client has too much queued, resume once it is flushed.
      const engine = socket.io.engine;

      if (engine && engine.writeBuffer.length > MAX_QUEUED_PACKETS && !conn.isPaused()) {
        conn.pause();
        engine.once('drain', () => conn.resume());
      }
    });
    conn.on('error', () => undefined); // e.g. ECONNRESET; `close` follows
    conn.on('close', () => {
      if (connections.delete(tunnelId)) socket.emit('closeTunnel', { tunnelId });
    });
  });

  try {
    await Promise.race([
      failed,
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(local, '127.0.0.1', resolve);
      }),
    ]);
    out(`Forwarding 127.0.0.1:${local} → ${replica}:${remote} (Ctrl+C to stop)`);
    await Promise.race([failed, interrupted(args.signal)]);
  } finally {
    server.close();
    for (const conn of connections.values()) conn.destroy();
    socket.close();
  }
}

/** `vpn enroll --name <device> [--out <file>]`: a device key generated here, enrolled with an interactive session. */
export async function vpnEnroll(args: { name: string; out?: string }, out: Out): Promise<void> {
  const api = await client();
  const keys = generateWireguardKeyPair();
  const enrolled = await api.request<{ client: { id: string }; config: string }>('POST', '/vpn/devices', {
    name: args.name,
    publicKey: keys.publicKey,
  });
  const file = args.out ?? `loadweaver-${args.name}.conf`;

  await writePrivateFile(file, withPrivateKey(enrolled.config, keys.privateKey));
  out(`Enrolled ${args.name} (${enrolled.client.id}); WireGuard configuration written to ${file} (keep it private)`);
}

export async function whoami(out: Out): Promise<void> {
  const api = await client();
  const me = await api.request<{
    userId: string | null;
    clusterRole: string | null;
    projects: Record<string, string>;
  }>('GET', '/access/me');
  const projects = Object.entries(me.projects).map(([project, role]) => `${project} (${role})`);

  out(`${api.base}: ${me.userId ?? 'API key'}`);
  out(`cluster role: ${me.clusterRole ?? 'none'}`);
  out(`projects: ${projects.length ? projects.join(', ') : 'none'}`);
}

interface RolloutView {
  id: string;
  status: string;
  kind: string;
  fromVersion: string | null;
  toVersion: string;
  pauseReason: string | null;
  warnings: string[];
  notes: string[];
  diff: { node: string; component: string; from: string | null; to: string | null; method: string }[];
  progress: { done: number; total: number; currentWave: number | null };
  steps: { index: number; wave: number; phase: string; node: string; state: string; error: string | null }[];
}

function rolloutLines(r: RolloutView, details = false): string[] {
  const lines = [
    `Update ${r.id}: ${r.fromVersion ?? '?'} → ${r.toVersion} (${r.kind}) ${r.status} ${r.progress.done}/${r.progress.total}` +
      (r.pauseReason ? ` — ${r.pauseReason}` : ''),
  ];

  if (!details) return lines;

  for (const note of r.notes) lines.push(`  note: ${note}`);

  for (const warning of r.warnings) lines.push(`  warning: ${warning}`);

  for (const d of r.diff)
    lines.push(`  ${d.node.padEnd(16)} ${d.component.padEnd(22)} ${d.from ?? '-'} → ${d.to ?? '-'}`);

  for (const s of r.steps)
    lines.push(
      `  wave ${String(s.wave).padStart(2)} ${s.phase.padEnd(13)} ${s.node.padEnd(16)} ${s.state}${s.error ? ` (${s.error})` : ''}`,
    );

  return lines;
}

const ROLLOUT_ACTIONS = new Set(['approve', 'pause', 'resume', 'rollback', 'cancel']);
const ROLLOUT_FINAL = new Set(['completed', 'rolled-back', 'rollback-failed', 'cancelled', 'superseded']);

/**
 * `updates …` (3.26): `status`, `releases`, `download <version>`, `upload <bundle.tar>` (air-gapped), `plan [<version>]
 * [--host] [--os-upgrade]`, `show <id>`, `approve <id> [--emergency]`, `pause|resume|rollback|cancel <id>`, `watch <id>`.
 */
export async function updates(
  args: {
    action?: string;
    target?: string;
    /** `upload`: the bundle, or its parts in order. */
    files?: string[];
    host?: boolean;
    osUpgrade?: boolean;
    emergency?: boolean;
    interval?: number;
  },
  out: Out,
): Promise<void> {
  const api = await client();

  switch (args.action) {
    case 'status': {
      const s = await api.request<{
        clusterVersion: string | null;
        controlPlaneVersion: string | null;
        latestAvailable: string | null;
        activeRollout: string | null;
        policy: { policy: string; channel: string; source: string };
        nodes: {
          name: string;
          agentVersion: string | null;
          release: string | null;
          target: string | null;
          rebootRequired: boolean;
        }[];
      }>('GET', '/updates/status');

      out(
        `cluster ${s.clusterVersion ?? 'unknown'} (control plane ${s.controlPlaneVersion ?? 'unknown'}), policy ${s.policy.policy}, channel ${s.policy.channel}, source ${s.policy.source}`,
      );

      if (s.latestAvailable) out(`available: ${s.latestAvailable}`);

      if (s.activeRollout) out(`running update: ${s.activeRollout}`);

      for (const n of s.nodes)
        out(
          `  ${n.name.padEnd(16)} agent ${n.agentVersion ?? '?'} release ${n.release ?? '-'}${n.target && n.target !== n.release ? ` → ${n.target}` : ''}${n.rebootRequired ? ' (reboot pending)' : ''}`,
        );

      return;
    }
    case 'releases': {
      const releases = await api.request<
        { version: string; channel: string; status: string; signed: boolean; error: string | null }[]
      >('GET', '/updates/releases');

      for (const r of releases)
        out(
          `${r.version.padEnd(18)} ${r.channel.padEnd(6)} ${r.status}${r.status === 'available' && !r.signed ? ' (unsigned)' : ''}${r.error ? ` — ${r.error}` : ''}`,
        );

      return;
    }
    case 'download': {
      if (!args.target) throw new Error('updates download <version>');

      await api.request('POST', `/updates/releases/${encodeURIComponent(args.target)}/download`, {});
      out(`Downloading ${args.target}; see \`loadweaver updates releases\``);

      return;
    }
    case 'upload': {
      const files = args.files ?? (args.target ? [args.target] : []);

      if (!files.length) throw new Error('updates upload <bundle.tar> | <bundle.tar.part000> <bundle.tar.part001> …');

      // Parts of a split bundle are sent as one stream, in the given order.
      const imported = await api.upload<{ version: string; status: string; signed: boolean }>(
        '/updates/bundles',
        Readable.from(
          (async function* () {
            for (const file of files) for await (const chunk of createReadStream(file)) yield chunk as Buffer;
          })(),
        ),
        'application/x-tar',
      );

      out(`Imported ${imported.version} (${imported.status}${imported.signed ? ', signed' : ', UNSIGNED'})`);

      return;
    }
    case 'plan': {
      const created = await api.request<RolloutView>('POST', '/updates/rollouts', {
        ...(args.target ? { version: args.target } : {}),
        ...(args.host !== undefined ? { host: args.host } : {}),
        ...(args.osUpgrade !== undefined ? { osUpgrade: args.osUpgrade } : {}),
      });

      rolloutLines(created, true).forEach(out);

      return;
    }
    case 'show':
      if (!args.target) throw new Error('updates show <id>');

      rolloutLines(
        await api.request<RolloutView>('GET', `/updates/rollouts/${encodeURIComponent(args.target)}`),
        true,
      ).forEach(out);

      return;
    case 'watch': {
      if (!args.target) throw new Error('updates watch <id>');

      let last = '';

      for (;;) {
        const r = await api.request<RolloutView>('GET', `/updates/rollouts/${encodeURIComponent(args.target)}`);
        const line = rolloutLines(r)[0];

        if (line !== last) out((last = line));

        if (ROLLOUT_FINAL.has(r.status)) return;

        await new Promise((resolve) => setTimeout(resolve, args.interval ?? 5_000));
      }
    }
    default:
      if (args.action && ROLLOUT_ACTIONS.has(args.action)) {
        if (!args.target) throw new Error(`updates ${args.action} <id>`);

        const r = await api.request<RolloutView>(
          'POST',
          `/updates/rollouts/${encodeURIComponent(args.target)}/${args.action}`,
          args.action === 'approve' ? { ...(args.emergency ? { emergency: true } : {}) } : undefined,
        );

        rolloutLines(r).forEach(out);

        return;
      }

      throw new Error('updates status|releases|download|upload|plan|show|watch|approve|pause|resume|rollback|cancel');
  }
}

/** `version`: the CLI's version and, if a control plane is configured, its version (from the public installer route). */
export async function version(out: Out, cli: string): Promise<void> {
  out(`loadweaver CLI ${cli}`);

  const config = await loadConfig();

  if (!config.url) return;

  try {
    const res = await fetch(`${config.url.replace(/\/+$/, '')}/api/install/loadweaver-agent.service`, {
      method: 'GET',
    });
    const cluster = res.headers.get('x-loadweaver-version');

    out(`control plane ${cluster ?? 'unknown'} (${config.url})`);
  } catch {
    out(`control plane unreachable (${config.url})`);
  }
}
