import * as path from 'path';

import {
  containerRuntimeForIsolationLevel,
  type DockerService,
  EGRESS_GUARD_PROXY_URL,
} from '@forepath/agenstra/backend/feature-agent-manager';

import {
  buildIsolationLabScenarios,
  ISOLATION_LAB_AGENT_NETWORK,
  ISOLATION_LAB_LABEL,
  type IsolationLabScenario,
} from '../lib/isolation-lab.config';

import { REPO_ROOT, requireLabKvm, runHostScript } from './harness/lab-host';
import {
  applyLabGuardPolicy,
  buildLabWorkerImage,
  createLabDockerService,
  execInLabContainer,
  LAB_EGRESS_GUARD_IMAGE,
  LAB_WORKER_IMAGE,
  waitForLabGuard,
} from './harness/manager';
import { docker as hostDocker } from './harness/process';
import { type LabVm, startLabVm } from './harness/vm';

const VM_BOOT_TIMEOUT = 60 * 60_000;
const ALLOWED_HOST = 'example.com';
/** Not allowlisted; serves plain HTTP 200 (no redirect) and HTTPS. */
const DENIED_HOST = 'example.org';
const CONTEXT_PORT = 18080;
const LABELS = { [ISOLATION_LAB_LABEL]: 'run' };
/** Capabilities dropped from guarded workers (mirrors EGRESS_GUARDED_AGENT_CAP_DROP of AgentEgressService). */
const GUARDED_WORKER_CAP_DROP = ['NET_ADMIN', 'NET_RAW'];

/**
 * HTTP(S) request with Python's urllib (honours HTTP(S)_PROXY like the agent's tools); `proxy=false`
 * ignores the proxy variables (transparent interception path). Exit code 0 only for a 2xx/3xx response.
 */
function fetch(url: string, proxy = true): string {
  const opener = proxy ? 'u.build_opener()' : 'u.build_opener(u.ProxyHandler({}))';

  // Some test sites reject Python's default user agent.
  return `python3 -c "import urllib.request as u; ${opener}.open(u.Request('${url}', headers={'User-Agent': 'agenstra-isolation-lab'}), timeout=10).read(64)"`;
}

/**
 * Networking, filtering and name resolution of every isolation level on a real host: default bridge,
 * agent network (Docker's embedded DNS) and behind the real egress guard in every mode. Workers are
 * created by the manager's DockerService, so the runtime mapping (Netstack vs kernel network stack) is
 * the production code path.
 */
describe('isolation lab: networking per level and topology', () => {
  let vm: LabVm;
  let docker: DockerService;
  let kvm = false;
  let contextIp = '';
  const previousNetwork = process.env['AGENT_DOCKER_NETWORK'];

  beforeAll(async () => {
    process.env['AGENT_DOCKER_NETWORK'] = ISOLATION_LAB_AGENT_NETWORK;

    // The guard image is built from the repository so the lab tests the current guard.
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

    vm = await startLabVm('net-kvm', { memoryMb: 4096, cpus: 2 });
    kvm = await requireLabKvm(vm, 'networking with sandboxed-kvm');

    const prepared = await runHostScript(vm, 'install');

    if (prepared.code !== 0) {
      throw new Error(`Host preparation failed:\n${prepared.output.slice(-3000)}`);
    }

    await vm.loadImage(LAB_EGRESS_GUARD_IMAGE);
    await buildLabWorkerImage(vm);
    docker = createLabDockerService(await vm.dockerSocket());
    await docker.ensureNetworkExists(ISOLATION_LAB_AGENT_NETWORK);

    // Stand-in for the agent manager's context API: the guard's platform allow must keep it reachable.
    await vm.execOrThrow(
      `docker run -d --name lab-context --label ${ISOLATION_LAB_LABEL}=run --network ${ISOLATION_LAB_AGENT_NETWORK} ${LAB_WORKER_IMAGE} python3 -m http.server ${CONTEXT_PORT} >/dev/null`,
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

  const scenarios = buildIsolationLabScenarios();
  const title = (scenario: IsolationLabScenario) =>
    `${scenario.level} on ${scenario.topology}${scenario.mode ? ` (${scenario.mode})` : ''}`;

  it.each(scenarios.map((scenario) => [title(scenario), scenario] as const))('%s', async (_title, scenario) => {
    if (scenario.level === 'sandboxed-kvm' && !kvm) {
      return;
    }

    const runtime = containerRuntimeForIsolationLevel(scenario.level, {});
    const suffix = `${scenario.level}-${scenario.topology}${scenario.mode ? `-${scenario.mode}` : ''}`;
    let guardId: string | undefined;
    let workerId: string | undefined;

    try {
      if (scenario.topology === 'guard') {
        guardId = await docker.createEgressGuardContainer({
          name: `lab-guard-${suffix}`,
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
        image: LAB_WORKER_IMAGE,
        name: `lab-worker-${suffix}`,
        labels: LABELS,
        runtime,
        ...(guardId
          ? {
              sharedNetworkContainerId: guardId,
              capDrop: GUARDED_WORKER_CAP_DROP,
              // Like AgentEgressService.proxyEnvironment: no proxy variables when the policy is `off`.
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
      const actualRuntime = (await vm.execOrThrow(`docker inspect -f '{{.HostConfig.Runtime}}' ${workerId}`)).trim();

      // Production runtime mapping: kernel network stack variant wherever Netstack would bypass guard / DNS.
      expect(actualRuntime === '' ? 'runc' : actualRuntime).toBe(scenario.expectedRuntime);

      // Isolation evidence: the gVisor kernel answers on gVisor levels only.
      const kernel = await execInLabContainer(docker, workerId, 'dmesg 2>&1 | head -n 3 || true', '0');

      expect(kernel.output.includes('Starting gVisor')).toBe(scenario.level !== 'standard');

      if (scenario.topology !== 'guard') {
        expect((await run(`nslookup ${ALLOWED_HOST}`)).ok).toBe(true);
        expect((await run(fetch(`http://${ALLOWED_HOST}`))).ok).toBe(true);
        expect((await run(fetch(`http://${DENIED_HOST}`))).ok).toBe(true);

        if (scenario.topology === 'agent-network') {
          // Docker's embedded DNS (127.0.0.11) resolves containers on the agent network.
          expect((await run('nslookup lab-context')).ok).toBe(true);
          expect((await run(fetch(`http://lab-context:${CONTEXT_PORT}/`))).ok).toBe(true);
        }

        return;
      }

      const guard = guardId as string;
      // Netstack would take the guard's interfaces over: the guard must keep its own address.
      const guardRoutes = await execInLabContainer(
        docker,
        guard,
        `awk 'NR>1 && $1!="lo"' /proc/net/route | grep -q .`,
        '0',
      );

      expect(guardRoutes.ok).toBe(true);
      // IPv6 is disabled in the guard's namespace (IPv4 is fully filtered); the worker shares it.
      expect(
        (await execInLabContainer(docker, guard, 'test "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)" = 1', '0')).ok,
      ).toBe(true);
      // The guard's loopback proxy is reachable from the worker.
      expect((await run(`python3 -c "import socket; socket.create_connection(('127.0.0.1', 3128), 5)"`)).ok).toBe(true);
      // Platform allow (agent manager context API) works in every mode, including offline.
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
        // Bypass attempts: a foreign resolver, direct IP literals and the guard's exemption mark (SO_MARK
        // 0x4147). The mark attempt runs as root inside the worker (NET_ADMIN dropped, as in production);
        // only the connection result counts: DNS over TLS (853) is rejected unless the mark applies.
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
  });
});
