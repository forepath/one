import type { AddressInfo } from 'node:net';

// Agenstra's agent manager drives this control plane (Loadweaver plan, section 4): its client is the system under
// test, so the integration needs both products.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { LoadweaverClient, LoadweaverRuntime } from '@forepath/agenstra/backend/feature-agent-manager';
import {
  agentMessage,
  decodeControlPlaneMessage,
  openAgentStream,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_FEATURES,
  type DesiredState,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCsr, generateKeyPair } from '@forepath/loadweaver/shared/util-pki';
import { generateSealKeyPair } from '@forepath/loadweaver/shared/util-secrets';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Agenstra on Loadweaver (section 4, step 2) end to end against the control plane, in users mode with a personal
 * access token like a real agent manager: a project operator's PAT (exchanged for a machine session) creates an
 * environment as a deployment through plan + apply (source `api`), runs commands over the machine exec channel
 * (binary-safe, stdin / stdout / stderr / exit code, audited), writes and reads files through `/live/files`, and
 * deletes the environment again. The nodes are simulated agents advertising the current protocol features.
 */

// Users mode with PATs; set before the app module is loaded (it reads the method at import time).
Object.assign(process.env, {
  AUTHENTICATION_METHOD: 'users',
  JWT_SECRET: 'agenstra-runtime-integration-jwt-secret-0123456789',
  // No mail server in the test: password login without the forced e-mail second factor.
  DISABLE_FORCE_LOGIN_2FA: 'true',
});

const PROJECT = 'agenstra-ws';
const AGENT = '0123abcd-4567-89ef-0123-456789abcdef';
const IMAGE = `ghcr.io/forepath/agenstra-manager-worker@sha256:${'5'.repeat(64)}`;
const SCOPES = [
  'projects:read',
  'resources:read',
  'plans:create',
  'plans:apply',
  'secrets:write',
  'logs:read',
  'metrics:read',
  'live:access',
  'live:exec',
];

// Control-plane members hold master-key shares (the environment's env file is a project secret).
const SEAL: Record<string, { publicKey: string }> = { n1: generateSealKeyPair(), n2: generateSealKeyPair() };

const hello = (nodeName: string, key: string) => ({
  nodeName,
  agentVersion: '0.0.0-it',
  os: { id: 'debian', versionId: '13', kernel: '6.12.0', arch: 'amd64' as const },
  capabilities: {
    runtimes: ['runc' as const, 'sandboxed' as const],
    sandboxProbe: 'ready' as const,
    wireguard: true,
    nftables: true,
    bird: true,
    drbd: true,
    criu: false,
  },
  capacity: { cpuMillis: 8000, memoryBytes: 16_000_000_000, diskBytes: 200_000_000_000 },
  wireguardPublicKey: key,
  endpointHost: `${nodeName}.example.test`,
  sealPublicKey: SEAL[nodeName].publicKey,
  appliedRevision: 0,
  protocolVersion: PROTOCOL_VERSION,
  features: [...SUPPORTED_PROTOCOL_FEATURES],
});

const WG_KEYS = ['yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg='];

describe('Agenstra runtime on Loadweaver (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let session = '';
  const agents: { end(): void }[] = [];
  const execOpens: Record<string, unknown>[] = [];
  const files = new Map<string, Buffer>();

  const api = async (
    method: string,
    path: string,
    body?: unknown,
    token: string | null = session,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test helper returns arbitrary JSON response bodies
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();

    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  const waitFor = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> => {
    const start = Date.now();

    for (;;) {
      const value = await fn();

      if (value !== undefined) return value;

      if (Date.now() - start > timeoutMs) throw new Error(`timed out: ${fn.toString().slice(0, 200)}`);

      await new Promise((r) => setTimeout(r, 200));
    }
  };

  /**
   * A simulated node: applies every desired state, reports its workloads running, and runs machine exec (stdin
   * echoed to stdout once closed, `err` on stderr, exit code 7) and file requests on a tiny filesystem.
   */
  const startAgent = (
    name: string,
    key: string,
    tls: { caCertificatePem: string; certificatePem: string; privateKeyPem: string },
  ) => {
    const { client, stream } = openAgentStream(process.env['LOADWEAVER_GRPC_ENDPOINTS'] as string, tls);
    const stdin = new Map<string, Buffer[]>();
    const reply = (type: Parameters<typeof agentMessage>[0], payload: unknown, channel?: string) =>
      stream.write(agentMessage(type, payload as never, channel ? { channel } : {}));

    stream.on('error', () => undefined);
    stream.on('data', (env: Envelope) => {
      const decoded = decodeControlPlaneMessage(env);

      if (decoded.ok !== true) return;

      const { type, payload } = decoded.message as { type: string; payload: Record<string, unknown> };
      const channel = env.channel ?? '';

      if (type === 'desiredState') {
        const state = payload as unknown as DesiredState;

        reply('applyReport', { revision: state.revision, status: 'applied', steps: [] });
        reply('workloadStatus', {
          workloads: state.workloads.map((w) => ({ id: w.id, state: 'running', specHash: w.specHash })),
        });
      } else if (type === 'execOpen') {
        execOpens.push(payload);
        stdin.set(channel, []);
      } else if (type === 'execInput') {
        stdin.get(channel)?.push(Buffer.from(String(payload['data']), 'base64'));

        if (payload['eof']) {
          reply('execOutput', { data: Buffer.concat(stdin.get(channel) ?? []).toString('base64') }, channel);
          reply('execOutput', { data: Buffer.from('err').toString('base64'), stream: 'stderr' }, channel);
          reply('execExit', { code: 7 }, channel);
        }
      } else if (type === 'execClose') {
        reply('execExit', { code: null }, channel);
      } else if (type === 'fileRequest') {
        const r = payload as {
          op: string;
          path: string;
          offset?: number;
          length?: number;
          data?: string;
          truncate?: boolean;
        };
        const file = files.get(r.path);

        if (r.op === 'stat')
          reply(
            'fileResponse',
            file
              ? {
                  ok: true,
                  entry: {
                    name: r.path.split('/').at(-1),
                    type: 'file',
                    size: file.length,
                    modifiedAt: new Date(0).toISOString(),
                    mode: 0o644,
                  },
                }
              : { ok: false, error: { code: 'not-found', message: 'no' } },
            channel,
          );
        else if (r.op === 'read')
          reply(
            'fileResponse',
            {
              ok: true,
              data: (file ?? Buffer.alloc(0)).subarray(r.offset, (r.offset ?? 0) + (r.length ?? 0)).toString('base64'),
            },
            channel,
          );
        else if (r.op === 'write') {
          const before = r.truncate ? Buffer.alloc(0) : (files.get(r.path) ?? Buffer.alloc(0));

          files.set(r.path, Buffer.concat([before.subarray(0, r.offset), Buffer.from(r.data ?? '', 'base64')]));
          reply('fileResponse', { ok: true }, channel);
        } else reply('fileResponse', { ok: true }, channel);
      }
    });
    stream.write(agentMessage('hello', hello(name, key)));
    agents.push({ end: () => (stream.end(), client.close()) });
  };

  beforeAll(async () => {
    const { createApp } = await import('../bootstrap');

    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    // The first user is the global admin (an interactive session; its PATs get roles from memberships only).
    expect(
      (await api('POST', '/auth/register', { email: 'ops@example.test', password: 'Sup3r-Secret-Passw0rd!' }, null))
        .status,
    ).toBe(201);
    session = (
      await api('POST', '/auth/login', { email: 'ops@example.test', password: 'Sup3r-Secret-Passw0rd!' }, null)
    ).json.access_token;
    expect(session).toBeTruthy();

    // Two nodes (volumes need a sync replica).
    for (const [i, name] of ['n1', 'n2'].entries()) {
      const token = (await api('POST', '/join-tokens', { ttlMinutes: 10 })).json.token;
      const keys = await generateKeyPair();
      const joined = await api(
        'POST',
        '/nodes/join',
        { token, nodeName: name, csrPem: await createCsr(keys, name), hello: hello(name, WG_KEYS[i]) },
        null,
      );

      expect(joined.status).toBe(200);
      startAgent(name, WG_KEYS[i], {
        caCertificatePem: joined.json.caCertificatePem,
        certificatePem: joined.json.certificatePem,
        privateKeyPem: keys.privateKeyPem,
      });
    }

    const dataSource = app.get(DataSource);

    await waitFor(async () =>
      (await dataSource.query(`SELECT count(*)::int AS n FROM lw_nodes WHERE stream_owner IS NOT NULL`))[0].n === 2
        ? true
        : undefined,
    );

    // The workspace project, approval mode `risky`.
    const plan = await api('POST', '/plans', {
      documents: `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec: {}\n`,
    });

    expect((await api('POST', `/plans/${plan.json.id}/apply`, {})).json.status).toBe('applied');
    expect((await api('PUT', `/projects/${PROJECT}/settings`, { approvalMode: 'risky' })).status).toBe(200);

    // Another project the manager is no member of.
    const other = await api('POST', '/plans', {
      documents: `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: other }\nspec: {}\n`,
    });

    expect((await api('POST', `/plans/${other.json.id}/apply`, {})).json.status).toBe('applied');
  }, 180_000);

  afterAll(async () => {
    agents.forEach((a) => a.end());
    await app?.close();
  });

  it('runs an environment with a project operator PAT: plan + apply, machine exec, files, delete', async () => {
    const me = (await api('GET', '/auth/tokens')).status;

    expect(me).toBe(200);

    // The manager's identity: a PAT with exactly the manager's scopes; operator of the workspace project only.
    const userId = JSON.parse(Buffer.from(session.split('.')[1], 'base64url').toString()).sub as string;

    expect((await api('PUT', `/projects/${PROJECT}/members/${userId}`, { role: 'operator' })).status).toBeLessThan(300);

    const pat = await api('POST', '/auth/tokens', { name: 'agent-manager', scopes: SCOPES });

    expect(pat.status).toBe(201);

    const client = new LoadweaverClient({
      url: baseUrl,
      project: PROJECT,
      token: () => pat.json.token,
      volumeSize: '1g',
    });
    const runtime = new LoadweaverRuntime(client);

    try {
      const machine = await client.bearer();

      // The manager has only its project role, including for environment secrets.
      expect(
        (await api('PUT', `/projects/${PROJECT}/secrets/operator-check`, { value: 'private' }, machine)).status,
      ).toBe(200);
      expect((await api('DELETE', `/projects/${PROJECT}/secrets/operator-check`, undefined, machine)).status).toBe(204);
      expect((await api('PUT', `/projects/${PROJECT}/secrets/lw-reserved`, { value: 'private' }, machine)).status).toBe(
        403,
      );
      expect((await api('DELETE', `/projects/${PROJECT}/secrets/lw-reserved`, undefined, machine)).status).toBe(403);

      // Create: one plan (source api), the env file as a secret, the replica reported running.
      const id = await runtime.createContainer({
        name: `agenstra-worker-${AGENT}`,
        labels: { 'io.agenstra.agent-id': AGENT },
        image: IMAGE,
        env: { AGENT_NAME: 'it', OPENCODE_SERVER_PASSWORD: 'opencode-secret' },
        volumes: [{ hostPath: '/opt/agents/x', containerPath: '/app' }],
        runtime: 'runc',
      });
      const deployment = id.slice('lw:'.length);
      const plans = (await api('GET', `/plans?project=${PROJECT}`)).json as {
        source: { kind: string } | null;
        changes: { kind: string; name: string }[];
      }[];
      const created = plans.find((p) => p.changes.some((c) => c.kind === 'Deployment' && c.name === deployment));

      expect(created?.source).toMatchObject({ kind: 'api' });
      expect(JSON.stringify(created)).not.toContain('opencode-secret');
      expect(await runtime.getContainerStatus(id)).toEqual({ running: true });
      expect(await runtime.resolveContainerHttpBaseUrl(id, 4096)).toMatch(/^http:\/\/[0-9.]+:4096$/);

      // Its own project only: a plan in another project is refused.
      expect(
        (
          await api(
            'POST',
            '/plans',
            {
              documents: `apiVersion: loadweaver.com/v1\nkind: Deployment\nmetadata: { name: intruder, project: other }\nspec:\n  compose: |\n    services:\n      x: { image: '${IMAGE}' }\n`,
            },
            machine,
          )
        ).status,
      ).toBe(403);
      // Machine exec, binary-safe both ways, with the environment's variables and the requested user.
      const binary = Buffer.from([0, 1, 2, 0xff, 0xfe, 0x0a, 0x0d, 0x80]);
      const result = await client.exec(`${PROJECT}/${deployment}/worker/0`, ['cat'], {
        user: '1000:1000',
        stdin: binary,
      });

      expect(result.stdout).toEqual(binary);
      expect(result.stderr.toString()).toBe('err');
      expect(result.exitCode).toBe(7);
      expect(execOpens.at(-1)).toMatchObject({ tty: false, user: '1000:1000', command: ['cat'] });

      // The runtime's own command path (env from the env file it stored).
      await expect(runtime.sendCommandToContainer(id, 'cat', 'hello')).resolves.toBe('hello\nerr');
      expect(execOpens.at(-1)?.['env']).toEqual(
        expect.arrayContaining(['AGENT_NAME=it', 'OPENCODE_SERVER_PASSWORD=opencode-secret']),
      );

      // Changing the environment writes a new secret version with the same project-operator PAT.
      await runtime.updateContainer(id, { env: { AGENT_NAME: 'changed' } });
      await expect(runtime.sendCommandToContainer(id, 'cat', 'hello')).resolves.toBe('hello\nerr');
      expect(execOpens.at(-1)?.['env']).toContain('AGENT_NAME=changed');

      // Files through /live/files.
      await runtime.putFilesIntoContainer(id, '/etc/agenstra', [{ name: 'note.bin', content: binary }]);
      expect(files.get('/etc/agenstra/note.bin')).toEqual(binary);
      expect(await client.readFile(`replica:${PROJECT}/${deployment}/worker/0`, '/etc/agenstra/note.bin')).toEqual(
        binary,
      );

      // A PAT without live:exec can't open the channel.
      const narrow = await api('POST', '/auth/tokens', { name: 'narrow', scopes: ['resources:read'] });
      const narrowClient = new LoadweaverClient({
        url: baseUrl,
        project: PROJECT,
        token: () => narrow.json.token,
        volumeSize: '1g',
      });

      await expect(narrowClient.exec(`${PROJECT}/${deployment}/worker/0`, ['true'])).rejects.toThrow();
      narrowClient.close();

      // Audited, without arguments or data.
      const audit = (await api('GET', '/audit?limit=100')).json.entries as {
        action: string;
        details: Record<string, unknown>;
      }[];
      const runs = audit.filter((e) => e.action === 'exec.run');

      expect(runs.length).toBeGreaterThanOrEqual(2);
      expect(runs[0].details).toMatchObject({ command: 'cat', exitCode: 7 });

      // A PAT revoked while its exec socket is open: the next exec re-validates, ends the socket's open session and
      // disconnects the socket (M6 review M4) instead of running on the handshake's identity.
      const revocable = await api('POST', '/auth/tokens', { name: 'revocable', scopes: SCOPES });

      expect(revocable.status).toBe(201);

      const revocableClient = new LoadweaverClient({
        url: baseUrl,
        project: PROJECT,
        token: () => revocable.json.token,
        volumeSize: '1g',
      });

      try {
        expect((await revocableClient.exec(`${PROJECT}/${deployment}/worker/0`, ['cat'])).exitCode).toBe(7);

        const opensBefore = execOpens.length + 1;
        const open = await revocableClient.startExec(
          `${PROJECT}/${deployment}/worker/0`,
          ['cat'],
          {},
          { stdout: () => undefined, stderr: () => undefined },
        );

        // The open session reached the node.
        await waitFor(async () => (execOpens.length === opensBefore ? true : undefined));

        expect((await api('DELETE', `/auth/tokens/${revocable.json.id}`)).status).toBeLessThan(300);

        const refused = await revocableClient.exec(`${PROJECT}/${deployment}/worker/0`, ['true']);

        expect(refused).toMatchObject({ exitCode: null, error: 'connection to Loadweaver lost' });
        await expect(open.done).resolves.toMatchObject({ exitCode: null });
        // The refused command never reached the node.
        expect(execOpens.length).toBe(opensBefore);
        expect(
          (revocableClient as unknown as { socket: { connected: boolean } | null }).socket?.connected ?? false,
        ).toBe(false);
        // Reconnecting with the token exchanged from the revoked PAT is refused at the handshake.
        await expect(revocableClient.exec(`${PROJECT}/${deployment}/worker/0`, ['true'])).rejects.toThrow();
        expect(execOpens.length).toBe(opensBefore);
      } finally {
        revocableClient.close();
      }

      // Delete: the deployment and its secret are gone, with the project-operator PAT only.
      await runtime.deleteContainer(id);
      // The removed replica drains first (two-phase removal, default stop grace 10 s) and reports `draining` (M6
      // gate), then the status is gone.
      expect(
        (await client.deploymentStatus(deployment))?.replicas.map((r) => [
          r.id,
          r.state,
          typeof (r as { drainUntil?: string }).drainUntil,
        ]),
      ).toEqual([[`${PROJECT}/${deployment}/worker/0`, 'draining', 'string']]);
      await waitFor(async () => ((await client.deploymentStatus(deployment)) === null ? true : undefined), 30_000);
      expect((await api('GET', `/resources/Deployment/${deployment}?project=${PROJECT}`)).status).toBe(404);
    } finally {
      client.close();
    }
  }, 180_000);
});
