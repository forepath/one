import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';

import { io, type Socket } from 'socket.io-client';

/** Configuration of the Loadweaver runtime (agent manager environment). */
export interface LoadweaverRuntimeConfig {
  /** Control-plane API base URL, e.g. `https://lw.example.com` (the API lives under `/api`). */
  url: string;
  /** The workspace's project. */
  project: string;
  /** A personal access token (exchanged for a machine session), a bearer token or the static API key. */
  token: () => string;
  /** Size of a new environment's workspace volume (compose size, e.g. `20g`). */
  volumeSize: string;
}

/** Reads the configuration from `LOADWEAVER_URL`, `LOADWEAVER_PROJECT`, `LOADWEAVER_TOKEN_FILE` (or `LOADWEAVER_TOKEN`). */
export function loadweaverRuntimeConfig(env: NodeJS.ProcessEnv = process.env): LoadweaverRuntimeConfig {
  const url = env['LOADWEAVER_URL']?.trim().replace(/\/+$/, '');
  const project = env['LOADWEAVER_PROJECT']?.trim();
  const tokenFile = env['LOADWEAVER_TOKEN_FILE']?.trim();
  const inline = env['LOADWEAVER_TOKEN']?.trim();

  if (!url || !/^https?:\/\//.test(url))
    throw new Error('AGENT_RUNTIME=loadweaver needs LOADWEAVER_URL (http(s)://...)');

  if (!project || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(project))
    throw new Error('AGENT_RUNTIME=loadweaver needs LOADWEAVER_PROJECT (the workspace project)');

  if (!tokenFile && !inline)
    throw new Error('AGENT_RUNTIME=loadweaver needs LOADWEAVER_TOKEN_FILE (a secret file with the PAT)');

  return {
    url,
    project,
    // Read on use: a rotated token file takes effect without a restart.
    token: () => (tokenFile ? readFileSync(tokenFile, 'utf8').trim() : (inline as string)),
    volumeSize: env['LOADWEAVER_ENVIRONMENT_VOLUME_SIZE']?.trim() || '20g',
  };
}

export class LoadweaverApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export interface LoadweaverResourceRef {
  kind: string;
  name: string;
  project?: string;
}

export interface LoadweaverPlan {
  id: string;
  status: string;
  error?: string | null;
  changes: { action: string; kind: string; name: string; project?: string | null }[];
  warnings?: { message: string }[];
}

export interface LoadweaverDeploymentStatus {
  project: string;
  deployment: string;
  replicas: { id: string; service: string; node: string; addresses: string[]; state: string; message?: string }[];
  services: { name: string; addressV4: string | null; addressV6: string | null }[];
}

export interface LoadweaverLogLine {
  at: string;
  message: string;
  source: string;
  labels?: Record<string, string>;
  fields?: Record<string, unknown>;
}

/** State of one isolation level in the project's placement (control plane `GET /projects/:p/isolation-capabilities`). */
export interface LoadweaverIsolationLevelCapability {
  state: 'ready' | 'unsupported' | 'probe-failed' | 'disabled-by-admin';
  /** Schedulable nodes in the placement with the level ready. */
  nodes: number;
  reasonCode?: string;
  reason?: string;
}

export interface LoadweaverIsolationCapabilities {
  project: string;
  /** Schedulable nodes in the placement (lifecycle active, reachable, not a witness, matching the selector). */
  nodes: number;
  levels: Partial<Record<'runc' | 'sandboxed' | 'sandboxed-kvm' | 'microvm', LoadweaverIsolationLevelCapability>>;
}

export interface LoadweaverExecResult {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error?: string;
}

export interface LoadweaverExecHandle {
  write(data: Buffer | string): void;
  end(): void;
  kill(): void;
  /** Resolves with the exit code when the process ends (or the session fails). */
  done: Promise<{ exitCode: number | null; error?: string }>;
}

interface ExecListeners {
  onStdout(data: Buffer): void;
  onStderr(data: Buffer): void;
  onExit(exitCode: number | null, error?: string): void;
  started: () => void;
}

/** Personal access tokens of the ForePath products (shared platform authentication). */
const PAT_PREFIX = 'fp_pat_';

/** A JWT expiry (seconds since the epoch), or null. */
function jwtExpiry(token: string): number | null {
  const parts = token.split('.');

  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { exp?: unknown };

    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

const toBuffer = (data: unknown): Buffer =>
  Buffer.isBuffer(data)
    ? data
    : data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(data))
      : data instanceof Uint8Array
        ? Buffer.from(data)
        : Buffer.alloc(0);

/**
 * A thin client of the Loadweaver control-plane API for the agent manager: plans (create + apply, source `api`),
 * deployment status, project secrets, live files, logs, metrics, and machine exec over `socket/exec` (binary stdio).
 * A personal access token is exchanged for a short-lived machine session (`POST /auth/token`) and renewed before it
 * expires; a JWT or the static API key is used as it is.
 */
export class LoadweaverClient {
  private session: { token: string; expiresAt: number } | null = null;
  private socket: Socket | null = null;
  private readonly execs = new Map<string, ExecListeners>();
  /** Plans of this manager are serialized: two concurrent plans of one project would make each other stale. */
  private planQueue: Promise<unknown> = Promise.resolve();
  /**
   * `POST /plans/:id/apply` answers after a few seconds with the plan as it is then: a longer apply (an image pull, a
   * microVM boot) is still `applying` and is followed here until it settles (G5: such environments failed as
   * "ended applying" although Loadweaver went on to apply them).
   */
  planPollMs = 2_000;
  planSettleTimeoutMs = 30 * 60_000;

  constructor(
    readonly config: LoadweaverRuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get project(): string {
    return this.config.project;
  }

  /** The bearer for API calls (exchanging a PAT when needed). */
  async bearer(): Promise<string> {
    const raw = this.config.token();

    // A PAT (`fp_pat_...`) is exchanged; a JWT (session or machine token) or the API key is used directly.
    if (!raw.startsWith(PAT_PREFIX)) return raw;

    if (this.session && this.session.expiresAt - 60_000 > Date.now()) return this.session.token;

    const res = await this.fetchImpl(`${this.config.url}/api/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: raw }),
    });

    if (!res.ok) throw new LoadweaverApiError(`token exchange failed (${res.status})`, res.status, null);

    const { access_token: token } = (await res.json()) as { access_token: string };
    const exp = jwtExpiry(token);

    this.session = { token, expiresAt: exp ? exp * 1000 : Date.now() + 5 * 60_000 };

    return token;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { raw?: boolean; headers?: Record<string, string>; binary?: Buffer } = {},
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.config.url}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.bearer()}`,
        ...(options.binary ? { 'content-type': 'application/octet-stream' } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.binary ? new Uint8Array(options.binary) : body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let parsed: unknown = text;

      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // plain text
      }

      const issues = (parsed as { issues?: { message?: string }[] } | null)?.issues;
      const message =
        (issues?.length ? issues.map((i) => i.message).join('; ') : null) ??
        (parsed as { message?: string } | null)?.message ??
        (typeof parsed === 'string' && parsed ? parsed : res.statusText);

      throw new LoadweaverApiError(`Loadweaver ${method} ${path}: ${res.status} ${message}`, res.status, parsed);
    }

    if (options.raw) return Buffer.from(await res.arrayBuffer()) as unknown as T;

    const text = await res.text();

    return (text ? JSON.parse(text) : null) as T;
  }

  /**
   * Plans and applies a change (3.8). A plan that became stale while it was applied (another change in the cluster)
   * is planned again, a few times.
   */
  async applyChange(change: {
    documents?: string;
    delete?: LoadweaverResourceRef[];
    refresh?: LoadweaverResourceRef[];
  }): Promise<LoadweaverPlan> {
    const run = this.planQueue.then(async () => {
      for (let attempt = 1; ; attempt++) {
        const plan = await this.request<LoadweaverPlan>('POST', '/plans', change);

        if (plan.changes.length === 0 && plan.status !== 'pending') return plan;

        try {
          const applied = await this.settled(await this.request<LoadweaverPlan>('POST', `/plans/${plan.id}/apply`, {}));

          if (applied.status !== 'applied')
            throw new LoadweaverApiError(
              `plan ${plan.id} ended ${applied.status}${applied.error ? `: ${applied.error}` : ''}`,
              500,
              applied,
            );

          return applied;
        } catch (error) {
          await this.request('POST', `/plans/${plan.id}/discard`, {}).catch(() => undefined);

          if (error instanceof LoadweaverApiError && error.status === 409 && attempt < 4) continue;

          throw error;
        }
      }
    });

    this.planQueue = run.catch(() => undefined);

    return await run;
  }

  /** Follows an applying / rolling-back plan until it settles (or `planSettleTimeoutMs` passed: as it is then). */
  private async settled(plan: LoadweaverPlan): Promise<LoadweaverPlan> {
    const end = Date.now() + this.planSettleTimeoutMs;
    let current = plan;

    while (['applying', 'rolling-back'].includes(current.status) && Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, this.planPollMs));
      current = await this.request<LoadweaverPlan>('GET', `/plans/${plan.id}`);
    }

    return current;
  }

  async deploymentStatus(deployment: string): Promise<LoadweaverDeploymentStatus | null> {
    try {
      return await this.request<LoadweaverDeploymentStatus>(
        'GET',
        `/projects/${this.project}/deployments/${deployment}/status`,
      );
    } catch (error) {
      if (error instanceof LoadweaverApiError && error.status === 404) return null;

      throw error;
    }
  }

  async getResource<T = Record<string, unknown>>(kind: string, name: string): Promise<T | null> {
    try {
      return await this.request<T>('GET', `/resources/${kind}/${name}?project=${this.project}`);
    } catch (error) {
      if (error instanceof LoadweaverApiError && error.status === 404) return null;

      throw error;
    }
  }

  /** Resources of a kind in the workspace project. */
  async listResources(kind: string): Promise<{ kind: string; metadata: { name: string; project?: string } }[]> {
    const all = await this.request<{ kind: string; metadata: { name: string; project?: string } }[]>(
      'GET',
      `/resources?kind=${kind}`,
    );

    return all.filter((r) => r.metadata.project === this.project);
  }

  /** Stores a project secret (write-only, versioned); returns its version. */
  async putSecret(name: string, value: string): Promise<number> {
    const result = await this.request<{ version: number }>('PUT', `/projects/${this.project}/secrets/${name}`, {
      value,
    });

    return result.version;
  }

  async deleteSecret(name: string): Promise<void> {
    await this.request('DELETE', `/projects/${this.project}/secrets/${name}`).catch((error: unknown) => {
      if (!(error instanceof LoadweaverApiError && error.status === 404)) throw error;
    });
  }

  /**
   * The aggregated isolation capabilities of the project's placement (Loadweaver plan 3.35): per level whether at
   * least one schedulable node passed its probe. `selector`: `key=value[,key=value]` to narrow the placement.
   */
  async isolationCapabilities(selector?: string): Promise<LoadweaverIsolationCapabilities> {
    const query = selector ? `?selector=${encodeURIComponent(selector)}` : '';

    return await this.request<LoadweaverIsolationCapabilities>(
      'GET',
      `/projects/${this.project}/isolation-capabilities${query}`,
    );
  }

  async readFile(target: string, path: string): Promise<Buffer> {
    return await this.request<Buffer>(
      'GET',
      `/live/files/content?target=${encodeURIComponent(target)}&path=${encodeURIComponent(path)}`,
      undefined,
      { raw: true },
    );
  }

  async writeFile(target: string, path: string, content: Buffer): Promise<void> {
    await this.request(
      'PUT',
      `/live/files/content?target=${encodeURIComponent(target)}&path=${encodeURIComponent(path)}`,
      undefined,
      { binary: content },
    );
  }

  async logs(query: Record<string, string>): Promise<{ lines: LoadweaverLogLine[]; cursor: string | null }> {
    return await this.request('GET', `/logs?${new URLSearchParams(query).toString()}`);
  }

  async metrics(query: Record<string, string>): Promise<unknown> {
    return await this.request('GET', `/metrics/query?${new URLSearchParams(query).toString()}`);
  }

  // Machine exec (`socket/exec`).

  private async connect(): Promise<Socket> {
    if (this.socket?.connected) return this.socket;

    if (!this.socket) {
      const socket = io(`${this.config.url}/socket/exec`, {
        path: '/socket.io',
        transports: ['websocket'],
        // Fresh credentials on every (re)connect.
        auth: (cb: (data: Record<string, string>) => void) =>
          void this.bearer().then(
            (token) => cb({ Authorization: `Bearer ${token}` }),
            () => cb({}),
          ),
        reconnectionDelayMax: 10_000,
      });

      socket.on('started', (m: { execId: string }) => this.execs.get(m.execId)?.started());
      socket.on('stdout', (m: { execId: string; data: unknown }) =>
        this.execs.get(m.execId)?.onStdout(toBuffer(m.data)),
      );
      socket.on('stderr', (m: { execId: string; data: unknown }) =>
        this.execs.get(m.execId)?.onStderr(toBuffer(m.data)),
      );
      socket.on('exit', (m: { execId: string; exitCode: number | null; error?: string }) => {
        const listeners = this.execs.get(m.execId);

        this.execs.delete(m.execId);
        listeners?.onExit(m.exitCode, m.error);
      });
      socket.on('error', (m: { execId?: string; message?: string }) => {
        if (!m?.execId) return;

        const listeners = this.execs.get(m.execId);

        this.execs.delete(m.execId);
        listeners?.onExit(null, m.message ?? 'exec failed');
      });
      // Sessions don't survive a lost connection (the control plane ends them).
      socket.on('disconnect', () => {
        for (const [id, listeners] of [...this.execs]) {
          this.execs.delete(id);
          listeners.onExit(null, 'connection to Loadweaver lost');
        }
      });
      this.socket = socket;
    }

    const socket = this.socket;

    if (!socket.connected)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Loadweaver exec channel: connect timeout')), 15_000);

        socket.once('connect', () => (clearTimeout(timer), resolve()));
        socket.once('connect_error', (e: Error) => (clearTimeout(timer), reject(e)));
        socket.connect();
      });

    return socket;
  }

  /** Starts a command in a replica; output arrives through the callbacks. */
  async startExec(
    replica: string,
    command: string[],
    options: { user?: string; workingDir?: string; env?: string[] },
    output: { stdout(data: Buffer): void; stderr(data: Buffer): void },
  ): Promise<LoadweaverExecHandle> {
    const socket = await this.connect();
    const execId = randomUUID().replace(/-/g, '');
    let resolveDone!: (r: { exitCode: number | null; error?: string }) => void;
    const done = new Promise<{ exitCode: number | null; error?: string }>((resolve) => (resolveDone = resolve));
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));

    this.execs.set(execId, {
      onStdout: output.stdout,
      onStderr: output.stderr,
      onExit: (exitCode, error) => (started(), resolveDone({ exitCode, ...(error ? { error } : {}) })),
      started: () => started(),
    });
    socket.emit('exec', {
      execId,
      replica,
      command,
      ...(options.user ? { user: options.user } : {}),
      ...(options.workingDir ? { workingDir: options.workingDir } : {}),
      ...(options.env?.length ? { env: options.env } : {}),
    });
    await startedPromise;

    return {
      write: (data) => socket.emit('stdin', { execId, data: Buffer.isBuffer(data) ? data : Buffer.from(data) }),
      end: () => socket.emit('stdin', { execId, eof: true }),
      kill: () => socket.emit('kill', { execId }),
      done,
    };
  }

  /** Runs a command to its end, collecting stdout / stderr (binary-safe). */
  async exec(
    replica: string,
    command: string[],
    options: { user?: string; workingDir?: string; env?: string[]; stdin?: Buffer } = {},
  ): Promise<LoadweaverExecResult> {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const handle = await this.startExec(replica, command, options, {
      stdout: (d) => stdout.push(d),
      stderr: (d) => stderr.push(d),
    });

    if (options.stdin?.length) handle.write(options.stdin);

    handle.end();

    const result = await handle.done;

    return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
