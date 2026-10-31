import { join } from 'node:path';

import {
  eventually,
  FatalWait,
  hostImageId,
  type LabRecorder,
  loadedImageMarker,
  type Vm,
} from '@forepath/shared/backend/util-vm-lab';

import { CLI_BUNDLE, CP_IMAGE, LAUNCHER_IMAGE, loadImages, log, M7_CLUSTER_AGENT_BUNDLE } from './m7-lab';

/**
 * Wait budgets of the cluster specs (lab speed-ups 2026-10-26): ≈ 2–3× the green timings of G5, so a broken state
 * fails within minutes instead of 15–30. A plan / deployment that reports a terminal failure ends its wait at once.
 */
export const CLUSTER_BUDGETS = {
  /** Plan applied (green: seconds to ~2 min; microVM / VM images up to ~4). */
  applyMs: 480_000,
  /** A replica running (green: < 2 min). */
  runningMs: 480_000,
  /** Every node connected with its desired state applied after the joins (green: ~1–3 min). */
  nodesAppliedMs: 480_000,
  /** A node reporting `applyStatus: failed` this long ends the nodes wait (transient failures recover sooner). */
  nodeFailedMs: 240_000,
} as const;

/** `LW_LAB_CP_HOTSWAP=1` (development, with a kept cluster): a rebuilt control-plane image replaces the running one. */
export const CP_HOTSWAP_ENV = 'LW_LAB_CP_HOTSWAP';

/**
 * A small real cluster for the M7 cluster specs: the control plane of this tree on the first VM (bootstrap), further
 * VMs joined, every node running the real agent with the lab reconciler (`m7-cluster-agent.entry.ts`). The test
 * process talks to the API with curl on the member (the VMs can't reach the test process; `vm.forward()` gives a
 * local port for real clients such as Agenstra's `LoadweaverClient` or Socket.IO).
 */

/** API answers, checked per spec. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

const AGENT = '/opt/loadweaver/m7-cluster-agent.js';
const CLI = '/opt/loadweaver/loadweaver-cli.js';
export const ADMIN = { email: 'admin@m7.lab.test', password: 'Lw-M7-Lab-Passw0rd!2026' };
const COMPONENTS_SCRIPT = join(__dirname, '..', 'components.generated.sh');

export interface ClusterNode {
  vm: Vm;
  name: string;
  /** Opted out of KVM at install (`LOADWEAVER_KVM=disabled`). */
  kvmDisabled?: boolean;
  /** Node labels at join (not for the bootstrap node). */
  labels?: string[];
}

function env(extra: Record<string, string> = {}): string[] {
  return Object.entries({
    LOADWEAVER_STATE_DIR: '/var/lib/loadweaver',
    LOADWEAVER_CONTROL_PLANE_IMAGE: CP_IMAGE,
    LOADWEAVER_MICROVM_LAUNCHER_IMAGE: LAUNCHER_IMAGE,
    ...extra,
  }).map(([k, v]) => `${k}=${v}`);
}

export class LabCluster {
  token = '';
  private registryToken = '';

  constructor(
    readonly member: Vm,
    readonly nodes: ClusterNode[],
  ) {}

  /** The API on the member (curl on the node). */
  async api(method: string, path: string, body?: unknown, auth = true): Promise<{ status: number; json: Json }> {
    const out = await this.member.exec(
      [
        `curl -sS -o /tmp/api.out -w '%{http_code}' --max-time 300 -X ${method} http://127.0.0.1:3400/api${path}`,
        ...(auth ? [`-H 'Authorization: Bearer ${this.token}'`] : []),
        ...(body !== undefined
          ? [`-H 'Content-Type: application/json' --data-binary @- <<'LWEOF'\n${JSON.stringify(body)}\nLWEOF`]
          : []),
      ].join(' '),
      { timeoutMs: 400_000 },
    );
    const text = await this.member.exec('cat /tmp/api.out; rm -f /tmp/api.out');
    let json: unknown = text;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }

    return { status: Number(out.trim()), json };
  }

  async ok(method: string, path: string, body?: unknown): Promise<Json> {
    let res = await this.api(method, path, body);

    // A freshly (re)started API is sealed until a share holder's agent reconnects (seconds; after a CP hot-swap or a
    // member restart): wait that out instead of failing the case (G5).
    for (
      const end = Date.now() + 120_000;
      res.status === 503 && /master key is sealed/.test(JSON.stringify(res.json));

    ) {
      if (Date.now() > end) break;

      await new Promise((resolve) => setTimeout(resolve, 3_000));
      res = await this.api(method, path, body);
    }

    if (res.status >= 300)
      throw new Error(`${method} ${path}: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 1200)}`);

    return res.json;
  }

  /** Creates a plan (no apply); returns it with its issues / warnings / notes. */
  async plan(documents: string): Promise<Json> {
    return await this.ok('POST', '/plans', { documents });
  }

  /** Plans and applies, waiting until applied (fails at once when the plan fails or is rolled back). */
  async apply(documents: string, timeoutMs: number = CLUSTER_BUDGETS.applyMs): Promise<Json> {
    const plan = await this.plan(documents);

    await this.ok('POST', `/plans/${plan.id}/apply`, { confirm: true });

    return await eventually(
      `plan ${plan.id} applied`,
      async () => {
        const current = (await this.ok('GET', `/plans/${plan.id}`)) as { status: string; error?: string | null };

        if (['failed', 'rolled-back', 'rollback-failed', 'discarded'].includes(current.status))
          throw new FatalWait(
            `plan ${plan.id} ${current.status}: ${current.error ?? ''} ${JSON.stringify(current).slice(0, 2000)}`,
          );

        return current.status === 'applied' ? current : undefined;
      },
      timeoutMs,
      5_000,
    );
  }

  async nodeList(): Promise<Array<Record<string, Json>>> {
    return (await this.ok('GET', '/nodes')) as Array<Record<string, Json>>;
  }

  /** Waits until a replica of `deployment` runs (status from the API), returning the replica entry. */
  async running(
    project: string,
    deployment: string,
    timeoutMs: number = CLUSTER_BUDGETS.runningMs,
  ): Promise<Record<string, Json>> {
    return await eventually(
      `${project}/${deployment} running`,
      async () => {
        const status = (await this.ok('GET', `/projects/${project}/deployments/${deployment}/status`)) as {
          replicas?: Array<{ state: string; node?: string; message?: string }>;
        };
        const replica = status.replicas?.[0];

        if (replica?.state === 'failed' && replica.message)
          throw new FatalWait(`${deployment} failed: ${replica.message}`);

        return replica && ['running', 'healthy'].includes(replica.state) ? replica : undefined;
      },
      timeoutMs,
      5_000,
    );
  }

  /** The VM running a replica (by its container label). */
  async holderOf(replica: string): Promise<ClusterNode | undefined> {
    for (const node of this.nodes) {
      const id = (
        await node.vm.exec(`docker ps -q --filter label=loadweaver.com/workload=${replica} | head -n1`, {
          timeoutMs: 30_000,
        })
      ).trim();

      if (id) return node;
    }

    return undefined;
  }

  /**
   * The password for `docker login` against the registry's token realm: an API key or a personal access token, never
   * the account password (built-in-registry.md; G5). A PAT with the registry scopes, created once.
   */
  async registryPassword(): Promise<string> {
    if (!this.registryToken)
      this.registryToken = String(
        (
          (await this.ok('POST', '/auth/tokens', {
            name: 'lab-registry',
            scopes: ['registry:pull', 'registry:push'],
          })) as {
            token: string;
          }
        ).token,
      );

    return this.registryToken;
  }

  /**
   * The PAT owner (the lab admin) as `developer` of a project: the registry token realm authorizes per repository from
   * the project role (user decision 2026-10-26, "project roles only"); a PAT never inherits the global admin's powers
   * and creating a project doesn't make its creator a member. Call after the project exists.
   */
  async registryMember(project: string, role: 'viewer' | 'developer' = 'developer'): Promise<void> {
    const me = (await this.ok('GET', '/access/me')) as { userId: string | null };

    if (me.userId) await this.ok('PUT', `/projects/${project}/members/${me.userId}`, { role });
  }

  /**
   * `docker login` on the member against the cluster registry (shell lines). The agent starts the registry after the
   * bootstrap (images pulled through the lab NAT): `/v2/` answers 503 until then, so the login waits (≤ 15 min) for
   * its 401 / 200 first (G5).
   */
  async registryLogin(): Promise<string> {
    return [
      'for i in $(seq 1 180); do c=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3400/v2/); [ "$c" = 401 ] || [ "$c" = 200 ] && break; sleep 5; done',
      `printf '%s' '${await this.registryPassword()}' | docker login 127.0.0.1:3400 -u ${ADMIN.email} --password-stdin >/dev/null`,
    ].join('\n');
  }

  /** Pushes a local (lab host) image into the cluster registry as `registry.lw/<project>/<repo>:<tag>`. */
  async pushImage(image: string, project: string, repository: string, tag: string): Promise<string> {
    await this.registryMember(project);
    await loadImages(this.member, [image]);
    await this.member.exec(
      [
        await this.registryLogin(),
        `docker tag ${image} 127.0.0.1:3400/${project}/${repository}:${tag}`,
        `docker push -q 127.0.0.1:3400/${project}/${repository}:${tag} >/dev/null`,
      ].join('\n'),
      { timeoutMs: 1_800_000 },
    );

    return `registry.lw/${project}/${repository}:${tag}`;
  }

  /** Runs the Loadweaver CLI on the member against the API (`LOADWEAVER_URL` / `LOADWEAVER_TOKEN`). */
  async cli(args: string[], options: { allowFailure?: boolean; timeoutMs?: number } = {}) {
    return await this.member.execResult(
      `LOADWEAVER_URL=http://127.0.0.1:3400 LOADWEAVER_TOKEN='${this.token}' node ${CLI} ${args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')}`,
      { timeoutMs: options.timeoutMs ?? 1_800_000, allowFailure: options.allowFailure },
    );
  }

  /** G5: why a URL import doesn't move (the import rows, the worker log lines and open queries on every member). */
  async importDiagnostics(project: string): Promise<string> {
    const parts = [
      `imports: ${JSON.stringify(await this.ok('GET', `/projects/${project}/vm-images/imports`).catch(String))}`,
    ];

    for (const node of this.nodes)
      parts.push(
        `${node.name}: ${await node.vm
          .exec(
            [
              "docker logs lw-control-plane 2>&1 | grep -E 'VM image import|Postgres leader' | tail -n 20 || true",
              'docker exec lw-postgres psql -U postgres -d postgres -tAc "SELECT pid, state, wait_event_type, wait_event, now() - query_start, left(query, 120) FROM pg_stat_activity WHERE state <> \'idle\' AND pid <> pg_backend_pid()" 2>&1 | tail -n 20 || true',
            ].join('\n'),
          )
          .catch(String)}`,
      );

    return parts.join('\n');
  }

  async diagnostics(vm: Vm): Promise<string> {
    return await vm.exec(
      'journalctl -u lw-agent --no-pager -n 80 2>&1 | tail -n 80; docker ps -a --format "{{.Names}} {{.Status}}"; docker logs --tail 60 lw-control-plane 2>&1 | tail -n 60',
      { allowFailure: true },
    );
  }
}

type Timer = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/** A node as the installer leaves it: components (KVM prep, gVisor runtimes), storage, the agent, the images. */
async function prepareNode(node: ClusterNode, member: boolean, time: Timer): Promise<void> {
  const { vm } = node;

  await vm.copyIn(M7_CLUSTER_AGENT_BUNDLE, AGENT);
  await vm.copyIn(COMPONENTS_SCRIPT, '/root/components.sh', '0700');
  await time(`${node.name} components`, () =>
    vm.exec(
      [
        'install -d -m 0700 /var/lib/loadweaver',
        ...(vm.dataDisk
          ? [
              `pvcreate -q ${vm.dataDisk} && vgcreate -q loadweaver ${vm.dataDisk}`,
              'lvcreate -q -l 90%FREE -T loadweaver/pool',
            ]
          : []),
        'modprobe drbd',
        'sysctl -qw net.ipv4.ip_forward=1',
        `${node.kvmDisabled ? 'LOADWEAVER_KVM=disabled ' : ''}bash /root/components.sh > /var/log/lw-components.log 2>&1 || { tail -n 60 /var/log/lw-components.log; exit 1; }`,
      ].join('\n'),
      { timeoutMs: 1_800_000 },
    ),
  );
  // Every node: the control plane makes further nodes members too (a second member on join), and the lab's control
  // plane image is a local tag no registry serves (G5: n2's member role failed with "pull access denied").
  await time(`${node.name} images`, () => loadImages(vm, [CP_IMAGE, LAUNCHER_IMAGE]));

  if (member) await vm.copyIn(CLI_BUNDLE, CLI);
}

const startAgent = (vm: Vm) =>
  vm.exec(
    `systemd-run --unit lw-agent ${env()
      .map((e) => `-E ${e}`)
      .join(' ')} node ${AGENT} run`,
  );

export interface StartClusterOptions {
  /** Records the bootstrap phases (`cluster: …` measurements). */
  rec?: LabRecorder;
  /** The lab was re-attached (`LW_LAB_KEEP=1`): the cluster is up already — log in instead of bootstrapping. */
  attached?: boolean;
}

/** Logs in on a cluster that is up already (kept lab) and waits for its nodes; hot-swaps the CP image if asked. */
async function attachCluster(nodes: ClusterNode[], time: Timer): Promise<LabCluster> {
  const cluster = new LabCluster(nodes[0].vm, nodes);

  if (process.env[CP_HOTSWAP_ENV] === '1') await time('control-plane hot-swap', () => hotSwapControlPlane(nodes));

  cluster.token = await time('login (attached)', () =>
    eventually(
      'admin login (kept cluster)',
      async () => (await cluster.ok('POST', '/auth/login', ADMIN)).access_token as string,
      300_000,
      3_000,
    ),
  );
  await eventually(
    'every node connected (kept cluster)',
    async () => {
      const list = await cluster.nodeList();

      return nodes.every((n) => list.find((l) => l.name === n.name && l.connected));
    },
    300_000,
    3_000,
  );
  log(`cluster re-attached (kept): ${nodes.map((n) => `${n.name}@${n.vm.ip}`).join(', ')}`);

  return cluster;
}

/**
 * Development only (`LW_LAB_CP_HOTSWAP=1`, kept cluster): when the lab host's control-plane image differs from the
 * one a member runs, load it and re-create the container. The agent alone wouldn't: its spec hash covers the image
 * reference, not the image ID, so a rebuilt image under the same tag keeps the old container (checked 2026-10-26,
 * `ManagedContainers.ensure`). Removing the container and restarting the agent re-creates it from the new image.
 */
async function hotSwapControlPlane(nodes: ClusterNode[]): Promise<void> {
  const want = await hostImageId(CP_IMAGE);

  for (const { vm, name } of nodes) {
    // Image IDs differ between the host and the guests (containerd image store): compare the host ID recorded at load.
    const loaded = (
      await vm.exec(`cat ${loadedImageMarker(CP_IMAGE)} 2>/dev/null || true`, { timeoutMs: 30_000 })
    ).trim();
    const member = (await vm.exec('docker inspect lw-control-plane >/dev/null 2>&1 && echo yes || true')).trim();

    if (loaded === want || !member) continue;

    log(`${name}: control plane ${loaded.slice(7, 19) || '(unknown)'} → ${want.slice(7, 19)} (hot-swap)`);
    await loadImages(vm, [CP_IMAGE]);
    await vm.exec('docker rm -f lw-control-plane >/dev/null && systemctl restart lw-agent', { timeoutMs: 120_000 });
  }
}

/** Bootstraps the control plane on the first node, registers the admin, joins the others. */
export async function startCluster(nodes: ClusterNode[], options: StartClusterOptions = {}): Promise<LabCluster> {
  const time: Timer = (name, fn) => (options.rec ? options.rec.time(`cluster: ${name}`, fn) : fn());

  if (options.attached) return await attachCluster(nodes, time);

  const [first, ...rest] = nodes;

  await time('prepare nodes', () => Promise.all(nodes.map((n, i) => prepareNode(n, i === 0, time))));

  const cluster = new LabCluster(first.vm, nodes);

  await time('bootstrap', () =>
    first.vm.exec(
      `${env()
        .map((e) => `export ${e}`)
        .join('; ')}; node ${AGENT} bootstrap --name ${first.name} --public-host ${first.vm.ip}`,
      { timeoutMs: 1_800_000 },
    ),
  );
  await startAgent(first.vm);
  await time('admin registered', () =>
    eventually(
      'admin registered',
      async () => {
        const res = await cluster.api('POST', '/auth/register', ADMIN, false);

        return res.status < 300 || res.status === 409;
      },
      600_000,
      5_000,
    ),
  );
  cluster.token = await time('admin login', () =>
    eventually(
      'admin login',
      async () => (await cluster.ok('POST', '/auth/login', ADMIN)).access_token as string,
      600_000,
      5_000,
    ),
  );
  await time(`${first.name} connected`, () =>
    eventually(`${first.name} connected`, async () =>
      (await cluster.nodeList()).find((n) => n.name === first.name && n.connected),
    ),
  );

  // G5 s1: the first apply re-creates Postgres, which then runs read-only for ~1 min (writes answer 500, e.g.
  // `POST /join-tokens`): members join once the first node has applied its desired state, as an operator would.
  if (rest.length > 0)
    await time(`${first.name} applied`, () =>
      eventually(
        `${first.name} applied`,
        async () => (await cluster.nodeList()).find((n) => n.name === first.name && n.applyStatus === 'applied'),
        CLUSTER_BUDGETS.nodesAppliedMs,
        5_000,
      ),
    );

  for (const node of rest) {
    const joinStart = Date.now();
    // G5 r9: the first member's API was briefly unreachable right after bootstrap ("fetch failed"): retry the join
    // (a fresh token each time; nothing is saved before the control plane answers) and record what the member did.
    for (let attempt = 1; ; attempt++) {
      const joinToken = await eventually(
        'join token',
        async () => {
          const res = await cluster.api('POST', '/join-tokens', { ttlMinutes: 30 });

          if (res.status >= 500) return undefined;

          if (res.status >= 300)
            throw new FatalWait(`POST /join-tokens: HTTP ${res.status} ${JSON.stringify(res.json)}`);

          return res.json as { token: string };
        },
        180_000,
        5_000,
      );
      const result = await node.vm.execResult(
        `export ${env().join(' ')}; LOADWEAVER_JOIN_TOKEN='${joinToken.token}' node ${AGENT} join-via ${first.vm.ip}:3400 --name ${node.name} --endpoint-host ${node.vm.ip}${(node.labels ?? []).map((l) => ` --label ${l}`).join('')}`,
        { timeoutMs: 300_000 },
      );

      if (result.code === 0) break;

      if (attempt >= 3)
        throw new Error(
          `${node.name}: join failed ${attempt} times\n--- stderr\n${result.stderr.trim()}\n--- stdout\n${result.stdout.trim().slice(-2000)}`,
        );

      log(
        `${node.name} join attempt ${attempt} failed (${result.stderr.trim().slice(-300)}); ${first.name}: ${await first.vm
          .exec(
            "docker ps -a --format '{{.Names}} {{.Status}}'; docker inspect -f '{{.Name}} started {{.State.StartedAt}} restarts {{.RestartCount}}' lw-control-plane lw-postgres 2>&1; docker logs --since 3m lw-control-plane 2>&1 | grep -viE '\"GET ' | tail -n 15",
          )
          .catch(String)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 20_000));
    }

    await startAgent(node.vm);
    options.rec?.measure(`cluster: ${node.name} join`, Math.round((Date.now() - joinStart) / 100) / 10, 's');
  }

  let lastList: Array<Record<string, Json>> = [];
  const failedSince = new Map<string, number>();

  await time('nodes applied', () =>
    eventually(
      'every node connected and applied',
      async () => {
        const list = await cluster.nodeList();

        lastList = list;

        // Fail fast: a node whose apply keeps failing won't converge by waiting out the budget.
        for (const n of nodes) {
          const entry = list.find((l) => l.name === n.name);

          if (entry?.applyStatus !== 'failed') failedSince.delete(n.name);
          else if (!failedSince.has(n.name)) failedSince.set(n.name, Date.now());
          else if (Date.now() - (failedSince.get(n.name) ?? 0) > CLUSTER_BUDGETS.nodeFailedMs)
            throw new FatalWait(
              `${n.name}: apply failed for ${CLUSTER_BUDGETS.nodeFailedMs / 1000} s: ${JSON.stringify(entry.applyError ?? entry.lastError ?? entry).slice(0, 1500)}`,
            );
        }

        return nodes.every((n) => list.find((l) => l.name === n.name && l.connected && l.applyStatus === 'applied'));
      },
      CLUSTER_BUDGETS.nodesAppliedMs,
      5_000,
    ),
  ).catch(async (error: unknown) => {
    // G5: what the control plane and the agents saw (also when the API itself doesn't answer).
    for (const node of nodes)
      log(
        `${node.name} containers:\n${await node.vm
          .exec(
            "docker ps -a --format '{{.Names}} {{.Status}}'; docker logs --tail 40 lw-control-plane 2>&1 | tail -n 40; free -m | head -2",
          )
          .catch(String)}`,
      );
    log(
      `nodes: ${JSON.stringify(
        lastList.map((l) => ({
          name: l.name,
          connected: l.connected,
          applyStatus: l.applyStatus,
          applyError: l.applyError ?? l.lastError ?? null,
          steps: l.applySteps ?? l.steps ?? null,
        })),
      ).slice(0, 4000)}`,
    );

    for (const node of nodes)
      log(
        `${node.name} agent journal:\n${await node.vm
          .exec("journalctl -u lw-agent --no-pager -o cat | grep -E 'ERROR|WARN|failed|Applying' | tail -n 30")
          .catch(String)}`,
      );
    throw error;
  });
  log(`cluster up: ${nodes.map((n) => `${n.name}@${n.vm.ip}${n.kvmDisabled ? ' (kvm disabled)' : ''}`).join(', ')}`);
  options.rec?.note(
    'cluster images (member)',
    (
      await first.vm
        .exec("docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | sort")
        .catch((error: unknown) => String(error))
    ).trim(),
  );

  return cluster;
}
