import * as path from 'path';

import {
  type DockerService,
  EGRESS_GUARD_PROXY_URL,
  IsolationCapabilitiesService,
} from '@forepath/agenstra/backend/feature-agent-manager';

import {
  buildIsolationLabMicrovmScenarios,
  ISOLATION_LAB_AGENT_NETWORK,
  ISOLATION_LAB_LABEL,
  type IsolationLabMicrovmScenario,
} from '../lib/isolation-lab.config';

import { REPO_ROOT, requireLabKvm, runHostScript } from './harness/lab-host';
import {
  applyLabGuardPolicy,
  createLabDockerService,
  execInLabContainer,
  LAB_EGRESS_GUARD_IMAGE,
  waitForLabGuard,
} from './harness/manager';
import { buildLabMicrovmImages, LAB_MICROVM_GUEST_IMAGE, LAB_MICROVM_IMAGE } from './harness/microvm';
import { docker as hostDocker } from './harness/process';
import { type LabVm, startLabVm } from './harness/vm';

const VM_BOOT_TIMEOUT = 90 * 60_000;
const SCENARIO_TIMEOUT = 20 * 60_000;
const ALLOWED_HOST = 'example.com';
/** Not allowlisted; serves plain HTTP 200 (no redirect) and HTTPS. */
const DENIED_HOST = 'example.org';
const CONTEXT_PORT = 18080;
const LABELS = { [ISOLATION_LAB_LABEL]: 'run' };
/** Capabilities dropped from guarded workers (mirrors EGRESS_GUARDED_AGENT_CAP_DROP of AgentEgressService). */
const GUARDED_WORKER_CAP_DROP = ['NET_ADMIN', 'NET_RAW'];
const AGENT_UID = '10001';

class LabIsolationCapabilitiesService extends IsolationCapabilitiesService {
  constructor(
    docker: DockerService,
    private readonly labEnv: NodeJS.ProcessEnv,
  ) {
    super(docker);
  }

  protected override get env(): NodeJS.ProcessEnv {
    return this.labEnv;
  }
}

/** HTTP(S) request with Python's urllib (honours HTTP(S)_PROXY); `proxy=false` uses the transparent path. */
function fetch(url: string, proxy = true): string {
  const opener = proxy ? 'u.build_opener()' : 'u.build_opener(u.ProxyHandler({}))';

  return `python3 -c "import urllib.request as u; ${opener}.open(u.Request('${url}', headers={'User-Agent': 'agenstra-isolation-lab'}), timeout=10).read(64)"`;
}

/**
 * The microvm level on a real host with nested KVM: the manager's real probe, a microVM worker created by the
 * manager's DockerService (launcher hardening, own guest kernel, exec bridge, volumes, logs, environment
 * updates, recreation) and the same networking matrix as the other levels, behind the real egress guard.
 */
describe('isolation lab: microvm level', () => {
  let vm: LabVm;
  let docker: DockerService;
  let kvm = false;
  let contextIp = '';
  let hostKernel = '';
  const previousNetwork = process.env['AGENT_DOCKER_NETWORK'];

  beforeAll(async () => {
    process.env['AGENT_DOCKER_NETWORK'] = ISOLATION_LAB_AGENT_NETWORK;

    await buildLabMicrovmImages();
    await hostDocker(
      [
        'build',
        '-q',
        '-t',
        LAB_EGRESS_GUARD_IMAGE,
        '--label',
        `${ISOLATION_LAB_LABEL}=image`,
        '-f',
        path.join(REPO_ROOT, 'apps/agenstra/backend-agent-manager/Dockerfile.egress-guard'),
        path.join(REPO_ROOT, 'apps/agenstra/backend-agent-manager'),
      ],
      { timeoutMs: 20 * 60_000 },
    );

    vm = await startLabVm('microvm', { memoryMb: 5120, cpus: 2 });
    kvm = await requireLabKvm(vm, 'microvm level');

    if (!kvm) {
      return;
    }

    // The host preparation loads the KVM modules (/dev/kvm) like on provisioned hosts.
    const prepared = await runHostScript(vm, 'install');

    if (prepared.code !== 0) {
      throw new Error(`Host preparation failed:\n${prepared.output.slice(-3000)}`);
    }

    await vm.loadImage(LAB_MICROVM_GUEST_IMAGE);
    await vm.loadImage(LAB_MICROVM_IMAGE);
    await vm.loadImage(LAB_EGRESS_GUARD_IMAGE);
    docker = createLabDockerService(await vm.dockerSocket());
    await docker.ensureNetworkExists(ISOLATION_LAB_AGENT_NETWORK);
    hostKernel = (await vm.execOrThrow('uname -r')).trim();

    await vm.execOrThrow(
      `docker run -d --name lab-context --label ${ISOLATION_LAB_LABEL}=run --network ${ISOLATION_LAB_AGENT_NETWORK} ${LAB_MICROVM_GUEST_IMAGE} python3 -m http.server ${CONTEXT_PORT} >/dev/null`,
    );
    contextIp = (
      await vm.execOrThrow(
        `docker inspect -f '{{(index .NetworkSettings.Networks "${ISOLATION_LAB_AGENT_NETWORK}").IPAddress}}' lab-context`,
      )
    ).trim();
  }, VM_BOOT_TIMEOUT);

  afterAll(async () => {
    if (previousNetwork === undefined) {
      delete process.env['AGENT_DOCKER_NETWORK'];
    } else {
      process.env['AGENT_DOCKER_NETWORK'] = previousNetwork;
    }

    await vm?.stop();
  });

  it(
    'probes the microvm level ready and recommends it as the strongest level',
    async () => {
      if (!kvm) {
        return;
      }

      const service = new LabIsolationCapabilitiesService(docker, {
        AGENT_DOCKER_NETWORK: ISOLATION_LAB_AGENT_NETWORK,
        AGENT_EGRESS_GUARD_ENABLED: 'true',
        AGENT_ISOLATION_PROBE_IMAGE: LAB_MICROVM_GUEST_IMAGE,
        AGENT_ISOLATION_PROBE_ENABLED: 'false',
        AGENT_ISOLATION_PROBE_TIMEOUT_MS: String(5 * 60_000),
        AGENT_MICROVM_IMAGE: LAB_MICROVM_IMAGE,
        AGENT_ISOLATION_MICROVM_PROBE_TIMEOUT_MS: String(15 * 60_000),
      });

      try {
        // The other levels are committed first; the microvm probe completes in the background.
        await service.probe();

        const capabilities = await service.whenMicrovmProbed();

        expect(capabilities.levels.microvm).toEqual({ rank: 4, runtime: 'runc', state: 'ready' });
        expect(capabilities.recommendedLevel).toBe('microvm');
        expect(capabilities.availableLevels[0]).toBe('microvm');
        // The probe leaves nothing behind.
        expect((await vm.execOrThrow(`docker ps -aq --filter label=io.agenstra.isolation-probe`)).trim()).toBe('');
      } finally {
        service.onModuleDestroy();
      }
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'runs a hardened microVM worker with the full worker contract',
    async () => {
      if (!kvm) {
        return;
      }

      await vm.execOrThrow('install -d -m 0777 /opt/lab-microvm-volume', { sudo: true });

      let id = await docker.createContainer({
        image: LAB_MICROVM_IMAGE,
        name: 'lab-microvm-contract',
        labels: LABELS,
        runtime: 'runc',
        microvm: true,
        env: { LAB_SECRET: 'first' },
        volumes: [{ hostPath: '/opt/lab-microvm-volume', containerPath: '/workspace' }],
      });

      try {
        const inspect = JSON.parse(await vm.execOrThrow(`docker inspect ${id}`))[0];

        expect(inspect.HostConfig.Runtime).toBe('runc');
        expect(inspect.HostConfig.Devices).toEqual([
          expect.objectContaining({ PathOnHost: '/dev/kvm', PathInContainer: '/dev/kvm' }),
        ]);
        expect(inspect.HostConfig.CapDrop).toEqual(['ALL']);
        expect(inspect.HostConfig.CapAdd).not.toEqual(expect.arrayContaining(['NET_ADMIN', 'SYS_ADMIN', 'NET_RAW']));
        expect(inspect.HostConfig.SecurityOpt).toEqual(['no-new-privileges']);
        expect(inspect.HostConfig.Binds).toEqual(['/opt/lab-microvm-volume:/guest/workspace']);
        // Secrets stay out of Config.Env (managed environment file below the guest root).
        expect(JSON.stringify(inspect.Config.Env)).not.toContain('first');

        // Isolation evidence: the guest runs its own kernel and has no KVM device.
        const guestKernel = await execInLabContainer(docker, id, 'uname -r', '0');

        expect(guestKernel.ok).toBe(true);
        expect(guestKernel.output.trim()).not.toBe(hostKernel);
        expect((await execInLabContainer(docker, id, 'test ! -e /dev/kvm', '0')).ok).toBe(true);
        // The guest never sees the launcher tree.
        expect((await execInLabContainer(docker, id, 'test ! -e /usr/lib/agenstra-microvm/launch', '0')).ok).toBe(true);

        // Exec semantics: users, managed environment, exit codes.
        expect((await execInLabContainer(docker, id, 'id -u')).output.trim()).toBe(AGENT_UID);
        expect((await execInLabContainer(docker, id, 'printf %s "$LAB_SECRET"')).output).toBe('first');
        expect((await execInLabContainer(docker, id, 'exit 3')).ok).toBe(false);

        // Volumes are shared with the host in both directions, ownership included.
        await execInLabContainer(docker, id, 'printf guest > /workspace/from-guest.txt');
        expect((await vm.execOrThrow('stat -c %u:%s /opt/lab-microvm-volume/from-guest.txt')).trim()).toBe(
          `${AGENT_UID}:5`,
        );
        await vm.execOrThrow('printf host > /opt/lab-microvm-volume/from-host.txt');
        expect((await execInLabContainer(docker, id, 'cat /workspace/from-host.txt')).output).toBe('host');

        // The workload's output reaches `docker logs`; the VMM runs unprivileged (uid 10930, unnamed on the lab host).
        expect(await vm.execOrThrow(`docker logs ${id} 2>&1`)).toContain('lab-workload-started');
        expect(await vm.execOrThrow(`docker top ${id} -eo pid,user,comm`)).toMatch(
          /(?:agenstra-vmm|10930)\s+qemu-system/,
        );

        // Environment updates restart the same container (managed environment file below /guest).
        expect(await docker.updateContainer(id, { env: { LAB_SECRET: 'second' }, runtime: 'runc' })).toBe(id);
        expect((await execInLabContainer(docker, id, 'printf %s "$LAB_SECRET"')).output).toBe('second');

        // Joining an egress guard recreates the worker with the same launcher configuration and volumes.
        const guardId = await docker.createEgressGuardContainer({
          name: 'lab-guard-microvm-contract',
          image: LAB_EGRESS_GUARD_IMAGE,
          labels: LABELS,
          network: ISOLATION_LAB_AGENT_NETWORK,
        });

        try {
          await waitForLabGuard(docker, guardId);
          id = await docker.updateContainer(id, {
            sharedNetworkContainerId: guardId,
            capDrop: GUARDED_WORKER_CAP_DROP,
            runtime: 'runc',
          });

          const recreated = JSON.parse(await vm.execOrThrow(`docker inspect ${id}`))[0];

          expect(recreated.HostConfig.NetworkMode).toBe(`container:${guardId}`);
          expect(recreated.HostConfig.Devices).toEqual([expect.objectContaining({ PathOnHost: '/dev/kvm' })]);
          expect((await execInLabContainer(docker, id, 'cat /workspace/from-guest.txt')).output).toBe('guest');
          expect((await execInLabContainer(docker, id, 'printf %s "$LAB_SECRET"')).output).toBe('second');
        } finally {
          await docker.deleteContainer(id).catch(() => undefined);
          await docker.deleteContainer(guardId).catch(() => undefined);
        }
      } finally {
        await docker.deleteContainer(id).catch(() => undefined);
      }
    },
    SCENARIO_TIMEOUT,
  );

  const title = (scenario: IsolationLabMicrovmScenario) =>
    `networking on ${scenario.topology}${scenario.mode ? ` (${scenario.mode})` : ''}`;

  it.each(buildIsolationLabMicrovmScenarios().map((scenario) => [title(scenario), scenario] as const))(
    '%s',
    async (_title, scenario) => {
      if (!kvm) {
        return;
      }

      const suffix = `${scenario.topology}${scenario.mode ? `-${scenario.mode}` : ''}`;
      let guardId: string | undefined;
      let workerId: string | undefined;

      try {
        if (scenario.topology === 'guard') {
          guardId = await docker.createEgressGuardContainer({
            name: `lab-guard-microvm-${suffix}`,
            image: LAB_EGRESS_GUARD_IMAGE,
            labels: LABELS,
            network: ISOLATION_LAB_AGENT_NETWORK,
          });
          await waitForLabGuard(docker, guardId);
          await applyLabGuardPolicy(docker, guardId, { mode: scenario.mode ?? 'enforce', allowHosts: [ALLOWED_HOST] }, [
            { destination: contextIp, port: CONTEXT_PORT },
          ]);
          await waitForLabGuard(docker, guardId);
        }

        workerId = await docker.createContainer({
          image: LAB_MICROVM_IMAGE,
          name: `lab-microvm-${suffix}`,
          labels: LABELS,
          runtime: 'runc',
          microvm: true,
          ...(guardId
            ? {
                sharedNetworkContainerId: guardId,
                capDrop: GUARDED_WORKER_CAP_DROP,
                env:
                  scenario.mode === 'off'
                    ? {}
                    : {
                        HTTP_PROXY: EGRESS_GUARD_PROXY_URL,
                        HTTPS_PROXY: EGRESS_GUARD_PROXY_URL,
                        http_proxy: EGRESS_GUARD_PROXY_URL,
                        https_proxy: EGRESS_GUARD_PROXY_URL,
                      },
              }
            : scenario.topology === 'agent-network'
              ? { network: ISOLATION_LAB_AGENT_NETWORK }
              : {}),
        });

        const run = (script: string) => execInLabContainer(docker, workerId as string, script);

        expect((await vm.execOrThrow(`docker inspect -f '{{.HostConfig.Runtime}}' ${workerId}`)).trim()).toBe('runc');
        expect((await run('uname -r')).output.trim()).not.toBe(hostKernel);

        if (scenario.topology !== 'guard') {
          expect((await run(`nslookup ${ALLOWED_HOST}`)).ok).toBe(true);
          expect((await run(fetch(`http://${ALLOWED_HOST}`))).ok).toBe(true);
          expect((await run(fetch(`http://${DENIED_HOST}`))).ok).toBe(true);

          if (scenario.topology === 'agent-network') {
            expect((await run('nslookup lab-context')).ok).toBe(true);
            expect((await run(fetch(`http://lab-context:${CONTEXT_PORT}/`))).ok).toBe(true);
          }

          return;
        }

        const guard = guardId as string;

        // The launcher never takes the guard's interfaces over (user-mode networking, no taps).
        expect(
          (await execInLabContainer(docker, guard, `awk 'NR>1 && $1!="lo"' /proc/net/route | grep -q .`, '0')).ok,
        ).toBe(true);
        expect(
          (await execInLabContainer(docker, guard, 'test "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)" = 1', '0'))
            .ok,
        ).toBe(true);
        // The guard's loopback proxy is reachable from the guest (loopback relay).
        expect((await run(`python3 -c "import socket; socket.create_connection(('127.0.0.1', 3128), 5)"`)).ok).toBe(
          true,
        );
        expect((await run(fetch(`http://${contextIp}:${CONTEXT_PORT}/`, false))).ok).toBe(true);

        const open = scenario.mode === 'off' || scenario.mode === 'monitor';

        expect((await run(`nslookup ${DENIED_HOST}`)).ok).toBe(open);
        expect((await run(fetch(`http://${DENIED_HOST}`))).ok).toBe(open);
        expect((await run(fetch(`http://${DENIED_HOST}`, false))).ok).toBe(open);
        expect((await run(fetch(`https://${DENIED_HOST}`))).ok).toBe(open);

        if (scenario.mode !== 'offline') {
          expect((await run(`nslookup ${ALLOWED_HOST}`)).ok).toBe(true);
          expect((await run(fetch(`http://${ALLOWED_HOST}`))).ok).toBe(true);
          expect((await run(fetch(`http://${ALLOWED_HOST}`, false))).ok).toBe(true);
          expect((await run(fetch(`https://${ALLOWED_HOST}`))).ok).toBe(true);
        } else {
          expect((await run(fetch(`http://${ALLOWED_HOST}`))).ok).toBe(false);
        }

        if (!open) {
          // Bypass attempts from the guest (root inside the VM): foreign resolver, IP literals and the guard's
          // exemption mark, which a guest socket can set but which never reaches the launcher's sockets.
          expect((await run(`nslookup ${DENIED_HOST} 8.8.8.8`)).ok).toBe(false);
          expect((await run(fetch('http://1.1.1.1', false))).ok).toBe(false);

          const marked = await execInLabContainer(
            docker,
            workerId,
            `python3 -c "
import socket
s = socket.socket()
try:
    s.setsockopt(socket.SOL_SOCKET, 36, 0x4147)
except OSError:
    pass
s.settimeout(5)
s.connect(('1.1.1.1', 853))
"`,
            '0',
          );

          expect(marked.ok).toBe(false);
        }
      } finally {
        for (const id of [workerId, guardId]) {
          if (id) {
            await docker.deleteContainer(id).catch(() => undefined);
          }
        }
      }
    },
    SCENARIO_TIMEOUT,
  );
});
