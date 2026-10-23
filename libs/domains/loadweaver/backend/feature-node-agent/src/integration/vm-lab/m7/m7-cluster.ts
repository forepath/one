import { join } from 'node:path';

import { eventually, FatalWait, type Vm } from '@forepath/shared/backend/util-vm-lab';

import { CLI_BUNDLE, CP_IMAGE, LAUNCHER_IMAGE, loadImages, log, M7_CLUSTER_AGENT_BUNDLE } from './m7-lab';

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
    const res = await this.api(method, path, body);

    if (res.status >= 300)
      throw new Error(`${method} ${path}: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 1200)}`);

    return res.json;
  }

  /** Creates a plan (no apply); returns it with its issues / warnings / notes. */
  async plan(documents: string): Promise<Json> {
    return await this.ok('POST', '/plans', { documents });
  }

  /** Plans and applies, waiting until applied (fails at once when the plan fails or is rolled back). */
  async apply(documents: string, timeoutMs = 900_000): Promise<Json> {
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
  async running(project: string, deployment: string, timeoutMs = 900_000): Promise<Record<string, Json>> {
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

  /** Pushes a local (lab host) image into the cluster registry as `registry.lw/<project>/<repo>:<tag>`. */
  async pushImage(image: string, project: string, repository: string, tag: string): Promise<string> {
    await loadImages(this.member, [image]);
    await this.member.exec(
      [
        `printf '%s' '${ADMIN.password}' | docker login 127.0.0.1:3400 -u ${ADMIN.email} --password-stdin >/dev/null`,
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

  async diagnostics(vm: Vm): Promise<string> {
    return await vm.exec(
      'journalctl -u lw-agent --no-pager -n 80 2>&1 | tail -n 80; docker ps -a --format "{{.Names}} {{.Status}}"; docker logs --tail 60 lw-control-plane 2>&1 | tail -n 60',
      { allowFailure: true },
    );
  }
}

/** A node as the installer leaves it: components (KVM prep, gVisor runtimes), storage, the agent, the images. */
async function prepareNode(node: ClusterNode, member: boolean): Promise<void> {
  const { vm } = node;

  await vm.copyIn(M7_CLUSTER_AGENT_BUNDLE, AGENT);
  await vm.copyIn(COMPONENTS_SCRIPT, '/root/components.sh', '0700');
  await vm.exec(
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
  );
  await loadImages(vm, member ? [CP_IMAGE, LAUNCHER_IMAGE] : [LAUNCHER_IMAGE]);

  if (member) await vm.copyIn(CLI_BUNDLE, CLI);
}

const startAgent = (vm: Vm) =>
  vm.exec(
    `systemd-run --unit lw-agent ${env()
      .map((e) => `-E ${e}`)
      .join(' ')} node ${AGENT} run`,
  );

/** Bootstraps the control plane on the first node, registers the admin, joins the others. */
export async function startCluster(nodes: ClusterNode[]): Promise<LabCluster> {
  const [first, ...rest] = nodes;

  await Promise.all(nodes.map((n, i) => prepareNode(n, i === 0)));

  const cluster = new LabCluster(first.vm, nodes);

  await first.vm.exec(
    `${env()
      .map((e) => `export ${e}`)
      .join('; ')}; node ${AGENT} bootstrap --name ${first.name} --public-host ${first.vm.ip}`,
    { timeoutMs: 1_800_000 },
  );
  await startAgent(first.vm);
  await eventually(
    'admin registered',
    async () => {
      const res = await cluster.api('POST', '/auth/register', ADMIN, false);

      return res.status < 300 || res.status === 409;
    },
    600_000,
    5_000,
  );
  cluster.token = await eventually(
    'admin login',
    async () => (await cluster.ok('POST', '/auth/login', ADMIN)).access_token as string,
    600_000,
    5_000,
  );
  await eventually(`${first.name} connected`, async () =>
    (await cluster.nodeList()).find((n) => n.name === first.name && n.connected),
  );

  for (const node of rest) {
    const joinToken = await cluster.ok('POST', '/join-tokens', { ttlMinutes: 30 });

    await node.vm.exec(
      `export ${env().join(' ')}; LOADWEAVER_JOIN_TOKEN='${joinToken.token}' node ${AGENT} join-via ${first.vm.ip}:3400 --name ${node.name} --endpoint-host ${node.vm.ip}${(node.labels ?? []).map((l) => ` --label ${l}`).join('')}`,
      { timeoutMs: 300_000 },
    );
    await startAgent(node.vm);
  }

  await eventually(
    'every node connected and applied',
    async () => {
      const list = await cluster.nodeList();

      return nodes.every((n) => list.find((l) => l.name === n.name && l.connected && l.applyStatus === 'applied'));
    },
    900_000,
    5_000,
  );
  log(`cluster up: ${nodes.map((n) => `${n.name}@${n.vm.ip}${n.kvmDisabled ? ' (kvm disabled)' : ''}`).join(', ')}`);

  return cluster;
}
