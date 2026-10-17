import {
  normalizeEffectiveEgressPolicy,
  resolveEffectiveEgressPolicy,
} from '@forepath/agenstra/shared/util-opencode-config';
import { NotFoundException } from '@nestjs/common';
import { parse, parseAllDocuments } from 'yaml';

import { parseEnvironmentFile } from '../../utils/agent-environment-file.utils';

import { environmentCompose, environmentDeployment, parseEnvironmentCompose } from './environment-compose';
import { LoadweaverClient } from './loadweaver-client';
import { LoadweaverRuntime } from './loadweaver.runtime';

const AGENT = '0123abcd-4567-89ef-0123-456789abcdef';
const DEPLOYMENT = environmentDeployment(AGENT);
const ID = `lw:${DEPLOYMENT}`;

function mockClient() {
  const resources = new Map<string, { spec: { compose: string } }>();
  const policies: string[] = [];
  const client = {
    project: 'agenstra-ws',
    config: { volumeSize: '20g' },
    putSecret: jest.fn<Promise<number>, [string, string]>(async () => 7),
    deleteSecret: jest.fn(async () => undefined),
    applyChange: jest.fn(async (change: { documents?: string; delete?: { kind: string; name: string }[] }) => {
      for (const doc of parseAllDocuments(change.documents ?? '').map((d) => d.toJS())) {
        if (doc?.kind === 'Deployment') resources.set(doc.metadata.name, { spec: doc.spec });

        if (doc?.kind === 'Policy' && !policies.includes(doc.metadata.name)) policies.push(doc.metadata.name);
      }

      for (const ref of change.delete ?? []) {
        if (ref.kind === 'Deployment') resources.delete(ref.name);
        else policies.splice(policies.indexOf(ref.name), 1);
      }

      return { id: 'plan-1', status: 'applied', changes: [] };
    }),
    getResource: jest.fn(async (_kind: string, name: string) => resources.get(name) ?? null),
    listResources: jest.fn(async () =>
      policies.map((name) => ({ kind: 'Policy', metadata: { name, project: 'agenstra-ws' } })),
    ),
    deploymentStatus: jest.fn(async (deployment: string) =>
      resources.has(deployment)
        ? {
            project: 'agenstra-ws',
            deployment,
            replicas: [
              {
                id: `agenstra-ws/${deployment}/worker/0`,
                service: 'worker',
                node: 'n1',
                addresses: ['10.88.1.5'],
                state: 'running',
              },
            ],
            services: [{ name: 'worker', addressV4: '10.43.0.9', addressV6: null }],
          }
        : null,
    ),
    exec: jest.fn(),
    startExec: jest.fn(),
    logs: jest.fn(),
    metrics: jest.fn(),
    writeFile: jest.fn(),
    close: jest.fn(),
  };

  return { client, resources, policies };
}

/** A startExec double: emits the given output and exit code. */
function execReturning(
  chunks: { stream: 'stdout' | 'stderr'; data: string | Buffer }[],
  exitCode: number | null,
  error?: string,
) {
  return jest.fn(
    async (
      _replica: string,
      _argv: string[],
      _options: unknown,
      out: { stdout(d: Buffer): void; stderr(d: Buffer): void },
    ) => {
      const written: Buffer[] = [];

      return {
        write: (d: Buffer | string) => void written.push(Buffer.from(d)),
        end: () => undefined,
        kill: () => undefined,
        written,
        done: Promise.resolve().then(() => {
          for (const c of chunks) out[c.stream](Buffer.from(c.data));

          return { exitCode, ...(error ? { error } : {}) };
        }),
      };
    },
  );
}

describe('LoadweaverRuntime', () => {
  const create = async (runtime: LoadweaverRuntime, extra: Record<string, unknown> = {}) =>
    await runtime.createContainer({
      name: `agenstra-worker-${AGENT}`,
      labels: { 'io.agenstra.agent-id': AGENT, 'io.agenstra.worker': '1' },
      image: 'ghcr.io/forepath/agenstra-manager-worker:1.2.3',
      env: { AGENT_NAME: 'a', OPENCODE_SERVER_PASSWORD: 's3cret', REMOVED: undefined, 'bad name': 'x' },
      volumes: [
        { hostPath: '/opt/agents/x', containerPath: '/app' },
        { hostPath: '/opt/agents', containerPath: '/opt/workspace', readOnly: true },
      ],
      runtime: 'runsc-systrap',
      ...extra,
    });

  it('creates an environment as a deployment with its egress policies in one plan; secrets only in the env secret', async () => {
    const { client } = mockClient();
    const runtime = new LoadweaverRuntime(client as unknown as LoadweaverClient);
    const policy = normalizeEffectiveEgressPolicy({
      ...resolveEffectiveEgressPolicy([]),
      mode: 'enforce',
      allowHosts: [{ value: 'github.com', source: 'global' }],
    });

    expect(await create(runtime, { egressPolicy: policy })).toBe(ID);

    const [secretName, secret] = client.putSecret.mock.calls[0] as unknown as [string, string];

    expect(secretName).toBe(`${DEPLOYMENT}-env`);
    expect(parseEnvironmentFile(secret)).toEqual({ AGENT_NAME: 'a', OPENCODE_SERVER_PASSWORD: 's3cret' });
    expect(client.applyChange).toHaveBeenCalledTimes(1);

    const plan = (client.applyChange.mock.calls[0][0] as { documents: string }).documents;
    const docs = parseAllDocuments(plan).map((d) => d.toJS());

    expect(plan).not.toContain('s3cret');
    expect(docs.map((d) => `${d.kind}/${d.metadata.name}`)).toEqual([
      `Deployment/${DEPLOYMENT}`,
      `Policy/${DEPLOYMENT}-egress`,
      `Policy/${DEPLOYMENT}-egress-allow`,
    ]);

    const compose = parse(docs[0].spec.compose);

    expect(compose.services.worker).toMatchObject({
      image: 'ghcr.io/forepath/agenstra-manager-worker:1.2.3',
      volumes: ['workspace:/app'],
      secrets: [{ source: 'environment', target: '/etc/agenstra/environment/environment' }],
      labels: {
        'agenstra.io/role': 'environment',
        'agenstra.io/egress-network': 'filtered',
        'io.agenstra.agent-id': AGENT,
      },
      'x-loadweaver': { replicas: 1, runtime: 'sandboxed' },
    });
    expect(compose.secrets.environment['x-loadweaver-ref']).toBe(`secret://agenstra-ws/${DEPLOYMENT}-env@7`);
  });

  it('refuses egress policies Loadweaver cannot express, before anything is created', async () => {
    const { client } = mockClient();
    const runtime = new LoadweaverRuntime(client as unknown as LoadweaverClient);
    const policy = normalizeEffectiveEgressPolicy({
      ...resolveEffectiveEgressPolicy([]),
      mode: 'enforce',
      allowHosts: [{ value: 'a_b.example', source: 'global' }],
    });

    await expect(create(runtime, { egressPolicy: policy })).rejects.toThrow("'a_b.example'");
    expect(client.putSecret).not.toHaveBeenCalled();
  });

  it('runs commands over machine exec with the environment, like docker exec', async () => {
    const { client } = mockClient();
    const runtime = new LoadweaverRuntime(client as unknown as LoadweaverClient);

    await create(runtime);
    client.startExec = execReturning(
      [
        { stream: 'stdout', data: 'one\n' },
        { stream: 'stderr', data: 'two\n' },
      ],
      0,
    );

    expect(
      await runtime.sendCommandToContainer(ID, `sh -c "echo 'a b'"`, 'line1\\nline2', true, {
        user: '0',
        env: ['X=1'],
      }),
    ).toBe('one\ntwo');

    const [replica, argv, options] = client.startExec.mock.calls[0] as unknown as [
      string,
      string[],
      { user: string; env: string[] },
    ];
    const handle = await (client.startExec.mock.results[0].value as Promise<{ written: Buffer[] }>);

    expect(replica).toBe(`agenstra-ws/${DEPLOYMENT}/worker/0`);
    expect(argv).toEqual(['sh', '-c', "echo 'a b'"]);
    expect(options.user).toBe('0');
    expect(options.env).toEqual(['AGENT_NAME=a', 'OPENCODE_SERVER_PASSWORD=s3cret', 'X=1']);
    expect(Buffer.concat(handle.written).toString()).toBe('line1\nline2\n');

    client.startExec = execReturning([{ stream: 'stderr', data: 'boom' }], 2);
    await expect(runtime.sendCommandToContainer(ID, ['false'], undefined, true)).rejects.toThrow('boom');

    client.startExec = execReturning([], null, 'replica not found');
    await expect(runtime.sendCommandToContainer(ID, ['ls'])).rejects.toBeInstanceOf(NotFoundException);
    await expect(runtime.sendCommandToContainer('abc123', ['ls'])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads files binary-safe as the user, refusing files over the limit', async () => {
    const { client } = mockClient();
    const runtime = new LoadweaverRuntime(client as unknown as LoadweaverClient);

    await create(runtime);
    client.exec.mockResolvedValueOnce({ exitCode: 0, stdout: Buffer.from([0, 255, 1]), stderr: Buffer.alloc(0) });
    expect(await runtime.readFileBytesFromContainer(ID, '/app/x.bin', { user: 'agenstra', maxBytes: 3 })).toEqual(
      Buffer.from([0, 255, 1]),
    );
    expect(client.exec.mock.calls[0][1]).toEqual(expect.arrayContaining(['/app/x.bin', '4']));

    client.exec.mockResolvedValueOnce({ exitCode: 0, stdout: Buffer.alloc(4), stderr: Buffer.alloc(0) });
    await expect(runtime.readFileBytesFromContainer(ID, '/x', { user: 'agenstra', maxBytes: 3 })).rejects.toThrow(
      'exceeds',
    );

    client.exec.mockResolvedValueOnce({
      exitCode: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from('cat: /y: No such file or directory'),
    });
    await expect(
      runtime.readFileBytesFromContainer(ID, '/y', { user: 'agenstra', maxBytes: 3 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reaches OpenCode through the service address and reports status', async () => {
    const { client } = mockClient();
    const runtime = new LoadweaverRuntime(client as unknown as LoadweaverClient);

    await create(runtime);
    expect(await runtime.resolveContainerHttpBaseUrl(ID, 4096)).toBe('http://10.43.0.9:4096');
    expect(await runtime.getContainerStatus(ID)).toEqual({ running: true });
    expect(await runtime.getEnvironmentApplyStrategy(ID)).toBe('recreate');
  });

  it('updates the environment through a new secret version and a plan; stops and starts by replicas', async () => {
    const { client, resources } = mockClient();
    const runtime = new LoadweaverRuntime(client as unknown as LoadweaverClient);

    await create(runtime);
    client.putSecret.mockResolvedValueOnce(8);
    await runtime.updateContainer(ID, { env: { AGENT_NAME: undefined, NEW: 'v' } });
    expect(parseEnvironmentFile(client.putSecret.mock.calls[1][1] as unknown as string)).toEqual({
      OPENCODE_SERVER_PASSWORD: 's3cret',
      NEW: 'v',
    });
    expect(parseEnvironmentCompose(resources.get(DEPLOYMENT)?.spec.compose ?? '', '20g')?.secretVersion).toBe(8);

    await runtime.stopContainer(ID);
    expect(parseEnvironmentCompose(resources.get(DEPLOYMENT)?.spec.compose ?? '', '20g')?.replicas).toBe(0);
    await runtime.startContainer(ID);
    expect(parseEnvironmentCompose(resources.get(DEPLOYMENT)?.spec.compose ?? '', '20g')?.replicas).toBe(1);
  });

  it('applies egress policies: stale ones deleted, the egress class label changed in the same plan', async () => {
    const { client, policies, resources } = mockClient();
    const runtime = new LoadweaverRuntime(client as unknown as LoadweaverClient);
    const base = resolveEffectiveEgressPolicy([]);

    await create(runtime, {
      egressPolicy: normalizeEffectiveEgressPolicy({
        ...base,
        mode: 'enforce',
        denyHosts: [{ value: 'evil.example', source: 'global' }],
      }),
    });
    expect(policies).toEqual([`${DEPLOYMENT}-egress`, `${DEPLOYMENT}-egress-deny`]);

    await runtime.egress.applyPolicy(ID, normalizeEffectiveEgressPolicy({ ...base, mode: 'monitor' }));

    const change = client.applyChange.mock.calls.at(-1)?.[0] as { documents: string; delete: { name: string }[] };

    expect(change.delete.map((d) => d.name)).toEqual([`${DEPLOYMENT}-egress-deny`]);
    expect(change.documents).toContain('kind: Deployment');
    expect(parseEnvironmentCompose(resources.get(DEPLOYMENT)?.spec.compose ?? '', '20g')?.network).toBe('open');
  });

  it("collects the environment's egress decisions from the logs API", async () => {
    const { client } = mockClient();
    const runtime = new LoadweaverRuntime(client as unknown as LoadweaverClient);
    const line = (at: string, fields: Record<string, string>) => ({
      at,
      source: 'proxy',
      message: JSON.stringify({ kind: 'egress-http', method: 'GET', status: '403' }),
      fields,
    });

    client.logs.mockResolvedValueOnce({
      lines: [
        line('2026-10-19T10:00:00.000Z', {
          egressDecision: 'blocked',
          egressRule: 'deny_host',
          egressHost: 'evil.example',
        }),
        line('2026-10-19T10:00:01.000Z', { egressDecision: 'allowed', egressHost: 'github.com' }),
        { at: '2026-10-19T10:00:02.000Z', source: 'proxy', message: 'other' },
      ],
      cursor: null,
    });

    const { observations, cursor } = await runtime.egress.collectEvents(ID, '2026-10-19T09:59:59.000Z');

    expect(client.logs.mock.calls[0][0]).toMatchObject({
      sources: 'proxy',
      project: 'agenstra-ws',
      deployment: DEPLOYMENT,
    });
    expect(observations).toEqual([
      expect.objectContaining({
        kind: 'web',
        decision: 'blocked',
        rule: 'deny_host',
        host: 'evil.example',
        method: 'GET',
        httpStatus: 403,
      }),
      expect.objectContaining({ decision: 'allowed', host: 'github.com', rule: null }),
    ]);
    expect(cursor).toBe('2026-10-19T10:00:02.000Z');
  });

  it('deletes the deployment, its policies and its secret', async () => {
    const { client, policies, resources } = mockClient();
    const runtime = new LoadweaverRuntime(client as unknown as LoadweaverClient);

    await create(runtime, {
      egressPolicy: normalizeEffectiveEgressPolicy({ ...resolveEffectiveEgressPolicy([]), mode: 'offline' }),
    });
    await runtime.deleteContainer(ID);
    expect(resources.size).toBe(0);
    expect(policies).toEqual([]);
    expect(client.deleteSecret).toHaveBeenCalledWith(`${DEPLOYMENT}-env`);
  });

  it('keeps the compose file readable back', () => {
    const spec = {
      image: 'i',
      workspacePath: '/work',
      runtime: 'runc' as const,
      labels: { a: 'b' },
      network: 'filtered' as const,
      capDrop: ['NET_RAW'],
      secretVersion: 3,
      replicas: 0 as const,
      volumeSize: '5g',
    };

    expect(parseEnvironmentCompose(environmentCompose('p', 'env-x', spec), '20g')).toEqual(spec);
  });
});
