import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LabRecorder, type Tunnel } from '@forepath/shared/backend/util-vm-lab';

import { WORKSPACE } from '../vm-lab.global-setup';
import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import { startCluster, type LabCluster } from './m7-cluster';
import {
  AGENSTRA_MICROVM_IMAGE,
  AGENSTRA_WORKER_IMAGE,
  CP_IMAGE,
  eventually,
  IMAGE_HINTS,
  LAUNCHER_IMAGE,
  log,
  nestedDescribe,
  requireImages,
  requireNested,
} from './m7-lab';

/**
 * Agenstra on Loadweaver with all four isolation levels (M7 W11, M7.5): Agenstra's real `LoadweaverRuntime` +
 * `LoadweaverClient` (bundled at test time with esbuild — cross-domain imports are not allowed here) in the test
 * process, against a single-node cluster with nested KVM (control plane of this tree, real agent), reached through a
 * forwarded port. The environment images are the isolation lab's small worker / microVM images, pushed into the
 * cluster registry.
 *
 * (a) the capability view (`GET /api/projects/:p/isolation-capabilities`) and the runtime's probes report all four
 *     levels ready; (b) an environment at each level runs at exactly that level on the node (`runc`, `runsc-systrap`,
 *     `runsc-kvm`, the bundled microVM launcher); (c) the microVM environment: commands through the node's `vm-exec`
 *     rewrite (`sendCommandToContainer`), the environment file, the workspace volume at `/guest/app` in the launcher,
 *     the CPU reservation (F2) in the stored compose; (d) the node opted out of KVM (`virtualization.kvm: disabled`)
 *     is reported `disabled-by-admin` for the KVM levels.
 * Not here: OpenCode / VNC through the service address (the lab images run no OpenCode).
 */

const PROJECT = 'agenstra-lab';

interface AgenstraBundle {
  LoadweaverClient: new (config: { url: string; project: string; token: () => string; volumeSize: string }) => {
    isolationCapabilities(selector?: string): Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    close(): void;
  };
  LoadweaverRuntime: new (client: unknown) => {
    createContainer(options: Record<string, unknown>): Promise<string>;
    deleteContainer(id: string): Promise<void>;
    sendCommandToContainer(id: string, command: string | string[]): Promise<string>;
    getContainerEnvironmentMap(id: string): Promise<Record<string, string>>;
    getDockerHostInfo(): Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    runIsolationProbe(options: {
      runtime?: string;
      image: string;
      timeoutMs: number;
    }): Promise<{ ok: boolean; reasonCode?: string }>;
    runMicrovmProbe(): Promise<{ ok: boolean; reasonCode?: string }>;
    onModuleDestroy(): void;
  };
}

const AGENSTRA_LOADWEAVER = 'libs/domains/agenstra/backend/feature-agent-manager/src/lib/runtime/loadweaver';

nestedDescribe('Agenstra on Loadweaver')('Agenstra on Loadweaver with all four levels (VM lab, M7 W11)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let cluster: LabCluster;
  let nested = false;
  let api: Tunnel;
  let agenstra: AgenstraBundle;
  let runtime: InstanceType<AgenstraBundle['LoadweaverRuntime']>;
  let client: InstanceType<AgenstraBundle['LoadweaverClient']>;
  let local = '';
  const created: string[] = [];
  const rec = new LabRecorder('m7-agenstra-on-loadweaver');
  const LEVELS = [
    { level: 'standard', runtime: 'runc', microvm: false, docker: /^runc$/ },
    { level: 'sandboxed', runtime: 'runsc-systrap', microvm: false, docker: /^runsc-systrap$/ },
    { level: 'sandboxed-kvm', runtime: 'runsc-kvm', microvm: false, docker: /^runsc-kvm$/ },
    { level: 'microvm', runtime: 'runc', microvm: true, docker: /^runc$/ },
  ] as const;

  beforeAll(async () => {
    await requireImages({
      [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE],
      [CP_IMAGE]: IMAGE_HINTS[CP_IMAGE],
      [AGENSTRA_MICROVM_IMAGE]: IMAGE_HINTS[AGENSTRA_MICROVM_IMAGE],
      [AGENSTRA_WORKER_IMAGE]: IMAGE_HINTS[AGENSTRA_WORKER_IMAGE],
    });
    local = mkdtempSync(join(tmpdir(), 'lw-vmlab-agenstra-'));
    // Agenstra's runtime, bundled (esbuild) instead of imported: cross-domain imports are not allowed here.
    writeFileSync(
      join(local, 'entry.ts'),
      [
        `export { LoadweaverClient } from ${JSON.stringify(join(WORKSPACE, AGENSTRA_LOADWEAVER, 'loadweaver-client'))};`,
        `export { LoadweaverRuntime } from ${JSON.stringify(join(WORKSPACE, AGENSTRA_LOADWEAVER, 'loadweaver.runtime'))};`,
      ].join('\n'),
    );
    execFileSync(
      join(WORKSPACE, 'node_modules/.bin/esbuild'),
      [
        join(local, 'entry.ts'),
        '--bundle',
        '--platform=node',
        '--format=cjs',
        '--target=node24',
        `--tsconfig=${join(WORKSPACE, 'tsconfig.base.json')}`,
        `--outfile=${join(local, 'agenstra-loadweaver.cjs')}`,
        '--external:cpu-features',
        '--external:*.node',
        '--external:@nestjs/microservices',
        '--external:@nestjs/websockets',
        '--external:@nestjs/platform-express',
        '--external:class-transformer',
        '--external:class-validator',
        '--log-level=error',
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- bundled at test time (see above)
    agenstra = require(join(local, 'agenstra-loadweaver.cjs')) as AgenstraBundle;

    lab = await rec.time('lab up', () =>
      startVmLab({
        vms: [{ name: 'vm1', site: 'a', memoryMb: 3584, cpus: 4, nested: true, dataDiskGb: 10, rootDiskGb: 24 }],
        packages: ['attr'],
        log,
      }),
    );
    ({ vm1 } = lab.vms as Record<'vm1', Vm>);
    nested = await requireNested(vm1, 'Agenstra on Loadweaver');

    if (!nested) return;

    cluster = await rec.time('cluster up', () => startCluster([{ vm: vm1, name: 'n1' }]));
    await cluster.apply(`apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec: {}\n`);

    const worker = await rec.time('push worker image', () =>
      cluster.pushImage(AGENSTRA_WORKER_IMAGE, PROJECT, 'worker', 'lab'),
    );
    const microvm = await rec.time('push microVM image', () =>
      cluster.pushImage(AGENSTRA_MICROVM_IMAGE, PROJECT, 'worker-microvm', 'lab'),
    );

    api = await vm1.forward(3400);
    // The manager's settings for the lab's sizes (read when the runtime is constructed).
    process.env['AGENT_MICROVM_IMAGE'] = microvm;
    process.env['AGENT_DEFAULT_IMAGE'] = worker;
    process.env['LOADWEAVER_ENVIRONMENT_MICROVM_CPUS'] = '1';
    process.env['LOADWEAVER_ENVIRONMENT_MICROVM_MEMORY'] = '768m';
    process.env['LOADWEAVER_ENVIRONMENT_MICROVM_CPU_RESERVATION'] = '0.5';
    client = new agenstra.LoadweaverClient({
      url: `http://${api.address}`,
      project: PROJECT,
      token: () => cluster.token,
      volumeSize: '1g',
    });
    runtime = new agenstra.LoadweaverRuntime(client);
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();

    for (const id of created) await runtime?.deleteContainer(id).catch(() => undefined);

    runtime?.onModuleDestroy();
    api?.close();
    await lab?.stop();

    if (local) rmSync(local, { recursive: true, force: true });
  }, 600_000);

  it('(a) reports all four levels ready in the capability view and the runtime probes', async () => {
    if (!nested) return;

    const view = await eventually(
      'all four levels ready',
      async () => {
        const v = await client.isolationCapabilities();

        return Object.values(v['levels'] as Record<string, { state: string }>).every((l) => l.state === 'ready')
          ? v
          : undefined;
      },
      600_000,
      10_000,
    );

    rec.note('capability view', view);
    expect(view['strongest']).toBe('microvm');

    const host = await runtime.getDockerHostInfo();

    expect(JSON.stringify(host)).toMatch(/runsc-kvm/);

    for (const l of LEVELS.filter((x) => !x.microvm))
      expect(await runtime.runIsolationProbe({ runtime: l.runtime, image: 'unused', timeoutMs: 60_000 })).toMatchObject(
        { ok: true },
      );

    expect(await runtime.runMicrovmProbe()).toMatchObject({ ok: true });
  });

  it('(b) creates an environment at each level, running at exactly that level', async () => {
    if (!nested) return;

    for (const l of LEVELS) {
      const id = await rec.time(`create ${l.level} environment`, () =>
        runtime.createContainer({
          // The manager derives the environment's deployment from the agent id (a uuid).
          name: `agenstra-worker-${randomUUID()}`,
          runtime: l.runtime,
          microvm: l.microvm,
          env: { LAB_LEVEL: l.level },
          volumes: [{ hostPath: `ws-${l.level}`, containerPath: '/app' }],
        }),
      );

      created.push(id);

      const deployment = id.replace(/^lw:/, '');
      const container = (
        await vm1.exec(`docker ps -q --filter label=loadweaver.com/deployment=${deployment} | head -n1`)
      ).trim();
      const dockerRuntime = (await vm1.exec(`docker inspect -f '{{.HostConfig.Runtime}}' ${container}`)).trim();

      rec.note(`${l.level} environment`, { id, deployment, dockerRuntime });
      expect(dockerRuntime).toMatch(l.docker);

      if (l.microvm)
        expect(
          await vm1.exec(`docker inspect -f '{{index .Config.Labels "loadweaver.com/microvm"}}' ${container}`),
        ).toContain('bundled');
    }
  });

  it('(c) runs commands, reads the environment and mounts the workspace in the microVM environment', async () => {
    if (!nested) return;

    const id = created[created.length - 1];
    const out = await runtime.sendCommandToContainer(id, [
      'sh',
      '-c',
      'echo from-guest-$(uname -r); id -un; ls -d /app',
    ]);

    expect(out).toMatch(/from-guest-/);
    expect(out).toContain('/app');
    expect(out).not.toContain((await vm1.exec('uname -r')).trim());
    expect(await runtime.getContainerEnvironmentMap(id)).toMatchObject({ LAB_LEVEL: 'microvm' });

    const deployment = id.replace(/^lw:/, '');
    const mounts = await vm1.exec(
      `docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' $(docker ps -q --filter label=loadweaver.com/deployment=${deployment} | head -n1)`,
    );

    expect(mounts).toContain('/guest/app');

    const compose = JSON.stringify(
      await cluster.ok('GET', `/projects/${PROJECT}/resources/Deployment/${deployment}`).catch(() => ({})),
    );

    rec.note('microVM environment compose', compose.slice(0, 2000));
    expect(compose).toMatch(/reservations/);
  });

  it('(d) reports the KVM levels disabled-by-admin for a node opted out of KVM', async () => {
    if (!nested) return;

    for (const id of created.splice(created.length - 2)) await runtime.deleteContainer(id);

    const site = (await cluster.ok('GET', '/nodes/n1'))['site'] ?? 'default';

    await cluster.apply(
      `apiVersion: loadweaver.com/v1\nkind: Node\nmetadata: { name: n1 }\nspec:\n  site: ${site}\n  virtualization: { kvm: disabled }\n`,
    );

    const view = await eventually(
      'KVM levels disabled-by-admin',
      async () => {
        const v = await client.isolationCapabilities();
        const levels = v['levels'] as Record<string, { state: string; reasonCode?: string }>;

        return levels['microvm'].state === 'disabled-by-admin' && levels['sandboxed-kvm'].state === 'disabled-by-admin'
          ? v
          : undefined;
      },
      600_000,
      10_000,
    );

    rec.note('capability view after the opt-out', view);
    expect(view['strongest']).toBe('sandboxed');
    expect(await runtime.runMicrovmProbe()).toMatchObject({ ok: false });
    await cluster.apply(
      `apiVersion: loadweaver.com/v1\nkind: Node\nmetadata: { name: n1 }\nspec:\n  site: ${site}\n  virtualization: { kvm: auto }\n`,
    );
  });
});
