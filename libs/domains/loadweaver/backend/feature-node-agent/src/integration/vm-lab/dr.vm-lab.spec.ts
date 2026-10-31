import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import { GOLDEN_PINS } from './golden';
import { DR_AGENT_BUNDLE } from './vm-lab.global-setup';
import { startVmLab, type Vm, type VmLab } from './vm-lab';

/**
 * Whole-cluster disaster-recovery drill on real kernels (3.20, M6 step 3c).
 *
 * Setup (the smallest faithful one that fits the lab's 7 GiB): vm1 is the control-plane member — the real agent
 * (`dr-agent.entry.ts`: the agent's CLI with the drill's reduced reconciler, overlay replaced by static routes, no
 * log store) bootstraps the real control plane on it: etcd, Spilo (Postgres + TimescaleDB + WAL-G), Valkey and the
 * control-plane API built from this tree (image `loadweaver-control-plane-api:dr-lab`), then Garage and the Kopia
 * repository server from its desired state. vm2 is a worker; both hold DRBD volume replicas. The external backup
 * target is a second, independent Garage (the release's pinned image) in the lab switch's network (10.77.1.1:3900).
 * Garage has no S3 Object Lock, so the target declares none here: the object-lock path of external copies is covered
 * by the control plane's `platform-dr.integration` against a fake S3 and is NOT verified against a real
 * lock-capable S3 in this drill.
 *
 * 1. Original cluster: admin user, BackupTarget + credentials secret, a deployment with a volume holding a known file,
 *    a BackupPolicy copying to the target; kit downloaded and confirmed; volume backup + its copy, platform backups
 *    (base backup, WAL, etcd, DR envelopes) + their encrypted copy; DR info downloaded.
 * 2. Disaster: both VMs wiped (fresh disks from the golden image).
 * 3. Fresh vm1: `loadweaver-agent bootstrap --restore --dr-info … --share-file … --share-file …` (2 of 3 shares) —
 *    control plane back with its data (the admin logs in, the deployment resource exists), previous nodes lost,
 *    object store formed anew, Kopia repository re-seeded from the target, master key re-sealed (secrets decrypt:
 *    the target's credentials for the next copy, the volume's LUKS key); vm2 re-joins as a replacement node with a
 *    new token; the volume is restored from its backup and the deployment runs again with the file intact.
 */

const AGENT = '/opt/loadweaver/dr-agent.js';
const CP_IMAGE = 'loadweaver-control-plane-api:dr-lab';
/** The external target's key (Garage format: `GK` + 24 hex, 64 hex secret), generated per run. */
const EXTERNAL = {
  accessKeyId: `GK${randomBytes(12).toString('hex')}`,
  secretAccessKey: randomBytes(32).toString('hex'),
  bucket: 'lw-dr',
};
const ADMIN = { email: 'admin@drill.example', password: 'Lw-Drill-Passw0rd!2026' };
const BUSYBOX = GOLDEN_PINS.busyboxImage;
const ENV = [
  'LOADWEAVER_STATE_DIR=/var/lib/loadweaver',
  `LOADWEAVER_CONTROL_PLANE_IMAGE=${CP_IMAGE}`,
  // Lab: platform backups / external copies on a short cycle.
  'LOADWEAVER_PLATFORM_COPY_INTERVAL_MS=30000',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ends an `eventually` at once (a failed plan doesn't recover by waiting). */
class FatalDrillError extends Error {}

async function eventually<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
  timeoutMs = 300_000,
  stepMs = 3_000,
) {
  const start = Date.now();
  let last: unknown;

  for (;;) {
    try {
      const value = await fn();

      if (value !== undefined && value !== null && value !== false) return value;
    } catch (error) {
      if (error instanceof FatalDrillError) throw error;

      last = error;
    }

    if (Date.now() - start > timeoutMs)
      throw new Error(`${what}: not reached in ${timeoutMs} ms${last ? ` (${String(last)})` : ''}`);

    await sleep(stepMs);
  }
}

describe('whole-cluster disaster recovery drill (VM lab)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let switchName: string;
  let token = '';
  const local = mkdtempSync(join(tmpdir(), 'lw-dr-drill-'));
  const timings: Record<string, number> = {};
  const facts: Record<string, unknown> = {};

  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    const result = await fn();

    timings[label] = Math.round((Date.now() - start) / 100) / 10;
    process.stderr.write(`[dr-drill] ${label}: ${timings[label]} s\n`);

    return result;
  };

  /** The API on vm1 (curl on the node: the test process can't reach the VMs directly). */
  const api = async (
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<{ status: number; json: any }> => {
    // A refused / dropped connection (the API container re-created by the restored member's first reconcile, G5):
    // curl prints status 000 and exits non-zero — read as status 0, transient like a 5xx.
    const { stdout: out } = await vm1.execResult(
      [
        `curl -sS -o /tmp/api.out -w '%{http_code}' --max-time 300 -X ${method} http://127.0.0.1:3400/api${path}`,
        ...(auth ? [`-H 'Authorization: Bearer ${token}'`] : []),
        ...(body !== undefined
          ? [`-H 'Content-Type: application/json' --data-binary @- <<'LWEOF'\n${JSON.stringify(body)}\nLWEOF`]
          : []),
      ].join(' '),
      { timeoutMs: 400_000, allowFailure: true },
    );
    const text = await vm1.exec('cat /tmp/api.out 2>/dev/null || true; rm -f /tmp/api.out');
    let json: unknown = text;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }

    return { status: Number(out.trim()), json };
  };
  /**
   * A control-plane membership change (a node joining as a member, the restored member's first reconcile) recreates
   * the Spilo container with the new member list, so Postgres restarts and requests in that window fail: 5xx, or 401
   * "Invalid or expired token" (the identity guard maps any error during token validation, incl. a dropped DB
   * connection, to 401 — G5 open point). Those are retried for up to 4 minutes (G5: the drill hit the window in
   * 2 of 3 runs); every retry is logged.
   */
  const transient = (res: { status: number; json: unknown }) =>
    res.status === 0 ||
    res.status >= 500 ||
    (res.status === 401 && /Invalid or expired token/.test(JSON.stringify(res.json)));
  const ok = async (method: string, path: string, body?: unknown) => {
    const deadline = Date.now() + 240_000;
    let res = await api(method, path, body);

    while (transient(res) && Date.now() < deadline) {
      process.stderr.write(
        `[dr-drill] ${method} ${path}: HTTP ${res.status} during a Postgres restart? retrying (${JSON.stringify(res.json).slice(0, 120)})\n`,
      );
      await new Promise((r) => setTimeout(r, 5_000));
      res = await api(method, path, body);
    }

    if (res.status < 200 || res.status >= 300)
      throw new Error(`${method} ${path}: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 800)}`);

    return res.json;
  };
  /**
   * Applies a plan and waits until it is applied — failing at once (with the plan's error and per-node states) when it
   * fails or is rolled back, instead of waiting for what it would have started.
   */
  /**
   * A plan; "no active node can run workloads" right after a membership change (the nodes' heartbeats can't be
   * written while Postgres is read-only, G5 dr2 / dr6) is planned again for up to 4 minutes.
   */
  const planOf = async (documents: string) => {
    const deadline = Date.now() + 240_000;

    for (;;) {
      const res = await api('POST', '/plans', { documents });

      if (res.status >= 200 && res.status < 300) return res.json;

      const retry = transient(res) || (res.status === 400 && /no active node/.test(JSON.stringify(res.json)));

      if (!retry || Date.now() > deadline)
        throw new Error(`POST /plans: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 800)}`);

      process.stderr.write(`[dr-drill] POST /plans: HTTP ${res.status}, planning again\n`);
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }
  };
  const apply = async (documents: string, timeoutMs = 600_000) => {
    let plan = await planOf(documents);

    // A plan made while n2 joins can be outdated by the time it's applied (409 "the cluster changed since the plan
    // was created"): planned again, as an operator would (G5 dr5).
    for (let attempt = 1; ; attempt++) {
      const res = await api('POST', `/plans/${plan.id}/apply`, { confirm: true });

      if (res.status >= 200 && res.status < 300) break;

      if (transient(res) && attempt < 30) {
        await new Promise((resolve) => setTimeout(resolve, 8_000));
        continue;
      }

      if (res.status !== 409 || attempt >= 30)
        throw new Error(`POST /plans/${plan.id}/apply: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 800)}`);

      process.stderr.write(`[dr-drill] plan ${plan.id} outdated (409), planning again\n`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      plan = await planOf(documents);
    }

    return await eventually(
      `plan ${plan.id} applied`,
      async () => {
        const current = (await ok('GET', `/plans/${plan.id}`)) as {
          status: string;
          error?: string | null;
          progress?: unknown;
          deploymentStates?: unknown;
        };

        if (['failed', 'rolled-back', 'rollback-failed', 'discarded'].includes(current.status))
          throw new FatalDrillError(
            `plan ${plan.id} ${current.status}: ${current.error ?? ''} ${JSON.stringify({ progress: current.progress, deployments: current.deploymentStates }).slice(0, 2000)}`,
          );

        return current.status === 'applied' ? current : undefined;
      },
      timeoutMs,
      5_000,
    );
  };
  // The API is re-created with the lab's settings (no forced e-mail second factor) by the agent's first apply.
  const login = async () => {
    token = await eventually(
      'admin login',
      async () =>
        (await ok('POST', '/auth/login', { email: ADMIN.email, password: ADMIN.password })).access_token as string,
      600_000,
      5_000,
    );
  };
  const diagnostics = async (vm: Vm) =>
    vm.exec(
      'journalctl -u lw-agent --no-pager -n 80 2>&1 | tail -n 80; docker ps -a --format "{{.Names}} {{.Status}}"; docker logs --tail 60 lw-control-plane 2>&1 | tail -n 60',
      { allowFailure: true },
    );

  /** A node as the installer leaves it: storage for volumes, DRBD 9, the agent, the control-plane image. */
  const prepare = async (vm: Vm, image: boolean) => {
    await vm.copyIn(DR_AGENT_BUNDLE, AGENT);
    await vm.exec(
      [
        'install -d -m 0700 /var/lib/loadweaver',
        `pvcreate -q ${vm.dataDisk} && vgcreate -q loadweaver ${vm.dataDisk}`,
        'lvcreate -q -l 90%FREE -T loadweaver/pool',
        'modprobe drbd',
        'sysctl -qw net.ipv4.ip_forward=1',
      ].join('\n'),
    );

    if (image) {
      await vm.copyIn(join(local, 'cp.tar'), '/var/tmp/cp.tar');
      await vm.exec('docker load -q -i /var/tmp/cp.tar && rm -f /var/tmp/cp.tar', { timeoutMs: 600_000 });
    }
  };
  const startAgent = (vm: Vm) =>
    vm.exec(`systemd-run --unit lw-agent ${ENV.map((e) => `-E ${e}`).join(' ')} node ${AGENT} run`);
  /** Polling calls into the VMs are short: a hung ssh must not hold a wait loop. */
  const QUICK = { timeoutMs: 30_000 };
  /** The VM running the drill's workload replica, if any. */
  const workloadHolder = async (): Promise<{ vm: Vm; name: string } | undefined> => {
    for (const vm of [vm1, vm2]) {
      const name = (
        await vm.exec(
          `docker ps --filter label=loadweaver.com/workload=shop/store/app/0 --format '{{.Names}}' | head -n1`,
          QUICK,
        )
      ).trim();

      if (name) return { vm, name };
    }

    return undefined;
  };
  const nodes = async () =>
    (await ok('GET', '/nodes')) as Array<{ name: string; lifecycle: string; connected: boolean }>;

  beforeAll(async () => {
    // The control-plane image of this tree (build: `npx nx run loadweaver-backend-control-plane:api-container-image`,
    // then `docker tag ghcr.io/forepath/loadweaver-control-plane-api:latest loadweaver-control-plane-api:dr-lab`).
    try {
      execFileSync('docker', ['image', 'inspect', CP_IMAGE], { stdio: 'ignore' });
    } catch {
      throw new Error(`the drill needs the control-plane image ${CP_IMAGE} built from this tree (see the comment)`);
    }

    execFileSync('docker', ['save', '-o', join(local, 'cp.tar'), CP_IMAGE]);
    facts['cpImageMb'] = Math.round(statSync(join(local, 'cp.tar')).size / 1024 ** 2);

    lab = await timed('lab up', () =>
      startVmLab({
        vms: [
          // Both become control-plane members (two nodes = two members): etcd, Spilo, API, Garage on each.
          { name: 'vm1', site: 'a', memoryMb: 3072, cpus: 3, dataDiskGb: 4 },
          { name: 'vm2', site: 'a', memoryMb: 2560, cpus: 2, dataDiskGb: 4 },
        ],
        log: (line) => process.stderr.write(`[vm-lab] ${line}\n`),
      }),
    );
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
    switchName = `lw-vmlab-${lab.run}-switch`;

    // The external target in the switch's network namespace (10.77.1.1 for the VMs): one Garage node.
    const garageName = `lw-vmlab-${lab.run}-external`;

    writeFileSync(
      join(local, 'garage.toml'),
      [
        'metadata_dir = "/var/lib/garage/meta"',
        'data_dir = "/var/lib/garage/data"',
        'db_engine = "sqlite"',
        'replication_factor = 1',
        'rpc_bind_addr = "127.0.0.1:3901"',
        'rpc_public_addr = "127.0.0.1:3901"',
        `rpc_secret = "${randomBytes(32).toString('hex')}"`,
        '[s3_api]',
        's3_region = "garage"',
        'api_bind_addr = "0.0.0.0:3900"',
      ].join('\n'),
      { mode: 0o644 },
    );
    execFileSync('docker', [
      'run',
      '-d',
      '--name',
      garageName,
      '--label',
      `org.forepath.loadweaver.vm-lab=run`,
      '--label',
      `org.forepath.loadweaver.vm-lab.run=${lab.run}`,
      '--network',
      `container:${switchName}`,
      '--memory',
      '256m',
      '-v',
      `${join(local, 'garage.toml')}:/etc/garage.toml:ro`,
      COMPONENT_IMAGES.garage,
    ]);

    const garage = (...args: string[]) =>
      execFileSync('docker', ['exec', garageName, '/garage', ...args], { encoding: 'utf8' });
    const garageId = await eventually(
      'external garage',
      async () => garage('node', 'id', '-q').split('@')[0].trim(),
      60_000,
      2_000,
    );

    garage('layout', 'assign', '-z', 'offsite', '-c', '2G', garageId);
    garage('layout', 'apply', '--version', '1');
    await eventually(
      'external bucket',
      async () => {
        garage('key', 'import', '--yes', '-n', 'drill', EXTERNAL.accessKeyId, EXTERNAL.secretAccessKey);

        return true;
      },
      60_000,
      2_000,
    );
    garage('bucket', 'create', EXTERNAL.bucket);
    garage('bucket', 'allow', '--read', '--write', EXTERNAL.bucket, '--key', EXTERNAL.accessKeyId);

    await timed('nodes prepared', () => Promise.all([prepare(vm1, true), prepare(vm2, true)]));
  }, 1_800_000);

  afterAll(async () => {
    process.stderr.write(`[dr-drill] timings ${JSON.stringify(timings)}\n[dr-drill] facts ${JSON.stringify(facts)}\n`);
    await lab?.stop();
    rmSync(local, { recursive: true, force: true });
  }, 300_000);

  let volumeSha = '';

  it('runs a cluster with a deployment, its volume and platform backups copied to the external target', async () => {
    try {
      await timed('bootstrap (control plane up, node joined)', () =>
        vm1.exec(
          `${ENV.map((e) => `export ${e}`).join('; ')}; node ${AGENT} bootstrap --name n1 --public-host ${vm1.ip}`,
          {
            timeoutMs: 1_800_000,
          },
        ),
      );
      await startAgent(vm1);

      // The first user becomes the admin (as in the console); the API may still be settling after the bootstrap.
      await eventually(
        'admin registered',
        async () => {
          const res = await api('POST', '/auth/register', ADMIN, false);

          // 409: a retry after a lost response.
          return res.status < 300 || res.status === 409;
        },
        600_000,
        5_000,
      );
      await login();
      await eventually('n1 connected', async () => (await nodes()).find((n) => n.name === 'n1' && n.connected));

      const joinToken = await ok('POST', '/join-tokens', { ttlMinutes: 30 });

      await timed('vm2 joined', () =>
        vm2.exec(
          `export ${ENV.join(' ')}; LOADWEAVER_JOIN_TOKEN='${joinToken.token}' node ${AGENT} join-via ${vm1.ip}:3400 --name n2 --endpoint-host ${vm2.ip}`,
          { timeoutMs: 300_000 },
        ),
      );
      await startAgent(vm2);
      await eventually('n2 connected', async () => (await nodes()).find((n) => n.name === 'n2' && n.connected));
      // The external target's credentials as a secret of the operations project; target, policy, deployment.
      await apply(
        `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ops }\nspec: {}\n---\napiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: shop }\nspec: {}\n`,
      );
      await ok('PUT', '/projects/ops/secrets/dr-target', {
        value: JSON.stringify({ accessKeyId: EXTERNAL.accessKeyId, secretAccessKey: EXTERNAL.secretAccessKey }),
      });
      // Planned right away, while n2 (the second control-plane member: etcd, a Postgres replica, the API) is still
      // joining: the volume's sync copy is held back from n2 with a plan warning (no rollback waiting for n2's
      // replica, as before the joining-node rule), and the next plan once n2 is ready adds the copy.
      const storeDocuments = [
        'apiVersion: loadweaver.com/v1',
        'kind: BackupTarget',
        'metadata: { name: offsite }',
        'spec:',
        '  type: s3',
        '  endpoint: http://10.77.1.1:3900',
        `  bucket: ${EXTERNAL.bucket}`,
        '  region: garage',
        '  prefix: drill/',
        '  credentials: secret://ops/dr-target',
        '---',
        'apiVersion: loadweaver.com/v1',
        'kind: BackupPolicy',
        'metadata: { name: nightly, project: shop }',
        'spec:',
        "  schedules: ['0 3 * * *']",
        '  targets: [offsite]',
        '---',
        'apiVersion: loadweaver.com/v1',
        'kind: Deployment',
        'metadata: { name: store, project: shop }',
        'spec:',
        '  compose: |',
        '    services:',
        '      app:',
        `        image: ${BUSYBOX}`,
        "        command: ['sh', '-c', 'test -f /data/seed || (head -c 4194304 /dev/urandom > /data/seed && sha256sum /data/seed > /data/seed.sha256); sleep 1000000']",
        '        volumes: [data:/data]',
        '    volumes:',
        "      data: { x-loadweaver: { size: 256m } } # the lab's data disks are 4 GiB",
      ].join('\n');
      const first = (await apply(storeDocuments)) as { warnings?: unknown[] };
      const heldBack = JSON.stringify(first.warnings ?? []).includes('while it is joining');

      facts['n2CopyHeldBackWhileJoining'] = String(heldBack);

      await timed('n2 control-plane member', () =>
        eventually(
          'both nodes applied, n2 running the control plane',
          async () => {
            const all = (await ok('GET', '/nodes')) as Array<{ name: string; connected: boolean; applyStatus: string }>;
            const running = (
              await vm2.exec(`docker ps --filter name=lw-control-plane --filter health=healthy -q`, QUICK)
            ).trim();

            return all.every((n) => n.connected && n.applyStatus === 'applied') && running !== '';
          },
          900_000,
          10_000,
        ),
      );

      // n2 ready: the unchanged plan adds the held-back copy (listed as a `copy` change).
      const again = (await apply(storeDocuments)) as {
        workloadChanges?: Array<Record<string, unknown>>;
        warnings?: unknown[];
      };

      if (heldBack)
        expect(again.workloadChanges).toContainEqual(
          expect.objectContaining({ action: 'copy', volume: 'shop/store/data', to: 'n2' }),
        );

      expect(JSON.stringify(again.warnings ?? [])).not.toContain('while it is joining');

      // The recovery kit: three shares downloaded once, confirmed with two.
      const [generation] = await ok('GET', '/backups/keys');
      const shares: string[] = [];

      for (const index of [1, 2, 3])
        shares.push((await ok('POST', `/backups/keys/${generation.generation}/kit/shares/${index}`)).text);

      expect(
        await ok('POST', `/backups/keys/${generation.generation}/kit/confirm`, { shares: [shares[0], shares[1]] }),
      ).toEqual({
        confirmed: true,
      });
      shares.forEach((s, i) => writeFileSync(join(local, `share-${i + 1}.txt`), s, { mode: 0o600 }));

      // The deployment runs (its plan is applied above); its volume holds the file.
      const holder = await eventually(
        'the deployment running',
        async () => {
          const found = await workloadHolder();

          return found &&
            (await found.vm.exec(`docker exec ${found.name} cat /data/seed.sha256 2>/dev/null || true`, QUICK)).trim()
            ? found
            : undefined;
        },
        300_000,
        5_000,
      );

      volumeSha = (await holder.vm.exec(`docker exec ${holder.name} cat /data/seed.sha256`)).trim().split(/\s+/)[0];
      expect(volumeSha).toMatch(/^[0-9a-f]{64}$/);
      facts['volumeHolder'] = holder.vm.name;

      // A volume backup, copied to the target by the policy.
      const backup = await timed('volume backup', async () => {
        // The policy's schedule may have started one already (a new volume's first backup isn't delayed): 409 then.
        const started = await api('POST', '/backups/now', { volume: 'shop/store/data' });

        expect([200, 201, 409]).toContain(started.status);

        return await eventually(
          'the volume backup and its external copy',
          async () => {
            const catalog = (await ok('GET', '/backups?project=shop')) as Array<{
              id: string;
              resource: string;
              status: string;
              error: string | null;
              targets: { target: string }[];
            }>;

            return catalog.find(
              (b) =>
                b.resource === 'shop/store/data' &&
                b.status === 'succeeded' &&
                b.targets.some((t) => t.target === 'offsite'),
            );
          },
          900_000,
          5_000,
        );
      });

      facts['volumeBackup'] = backup.id;

      // Platform backups (base backup + etcd, each with its DR envelope) and their encrypted copy.
      await timed('platform backups + external copy', async () => {
        expect((await ok('POST', '/backups/platform/postgres/run')).status).toBe('succeeded');
        expect((await ok('POST', '/backups/platform/etcd/run')).status).toBe('succeeded');
        expect(await ok('POST', '/backups/platform/copies/run')).toEqual([
          expect.objectContaining({ target: 'offsite', status: 'succeeded' }),
        ]);
      });

      // Written after the base backup: comes back through the WAL only.
      await ok('PUT', '/projects/shop/secrets/after-backup', { value: 'written-after-the-base-backup' });
      await vm1.exec(`docker exec lw-postgres psql -U postgres -d postgres -tAc 'SELECT pg_switch_wal()'`);
      await eventually(
        'the WAL segment on the target',
        async () => ((await ok('POST', '/backups/platform/copies/run')) as { copied: number }[])[0].copied > 0,
        300_000,
        10_000,
      );

      const status = await ok('GET', '/backups/platform');

      expect(status.copies[0]).toMatchObject({
        lastStatus: 'succeeded',
        verifiedEnvelope: expect.stringMatching(/^dr-envelope\//),
      });
      expect(status.pins).toEqual([]);
      writeFileSync(join(local, 'dr-info.json'), JSON.stringify(await ok('GET', '/backups/platform/dr-info')));
      facts['objectsOnTarget'] = status.copies[0].objects;
    } catch (error) {
      process.stderr.write(
        `[dr-drill] last view: ${JSON.stringify({ restores: facts['lastRestores'], holder: facts['lastHolder'] })}\n`,
      );
      process.stderr.write(`[dr-drill] vm1:\n${await diagnostics(vm1)}\n[dr-drill] vm2:\n${await diagnostics(vm2)}\n`);
      throw error;
    }
  }, 3_600_000);

  it('loses every node', async () => {
    await timed('wipe both VMs', () => Promise.all([vm1.wipe(), vm2.wipe()]));
    expect(await vm1.exec('test -e /var/lib/loadweaver && echo yes || echo no')).toBe('no\n');
  }, 900_000);

  it('restores the cluster on a fresh node with 2 of 3 kit shares, the volume and the deployment', async () => {
    try {
      await timed('fresh nodes prepared', () => Promise.all([prepare(vm1, true), prepare(vm2, true)]));
      await vm1.copyIn(join(local, 'dr-info.json'), '/root/dr-info.json', '0600');
      await vm1.copyIn(join(local, 'share-1.txt'), '/root/share-1.txt', '0600');
      await vm1.copyIn(join(local, 'share-3.txt'), '/root/share-3.txt', '0600');

      const output = await timed('bootstrap --restore', () =>
        vm1.exec(
          [
            `export ${ENV.join(' ')}`,
            `export LOADWEAVER_DR_ACCESS_KEY_ID=${EXTERNAL.accessKeyId} LOADWEAVER_DR_SECRET_ACCESS_KEY=${EXTERNAL.secretAccessKey}`,
            `node ${AGENT} bootstrap --restore --name n1 --public-host ${vm1.ip} --dr-info /root/dr-info.json --share-file /root/share-1.txt --share-file /root/share-3.txt 2>&1`,
          ].join('\n'),
          { timeoutMs: 1_800_000 },
        ),
      );

      process.stderr.write(`[dr-drill] restore output:\n${output}\n`);
      expect(output).toContain('restored on n1');
      expect(await vm1.exec('test -e /var/lib/loadweaver/dr && echo staged || echo clean')).toBe('clean\n');
      await startAgent(vm1);

      // The control plane is back with its data: the same admin, the deployment, the previous nodes lost.
      await login();
      expect((await ok('GET', '/resources/Deployment/store?project=shop')).metadata.name).toBe('store');
      expect(((await ok('GET', '/projects/shop/secrets')) as { name: string }[]).map((x) => x.name)).toContain(
        'after-backup',
      );

      const after = await nodes();

      expect(after.find((n) => n.name === 'n2')?.lifecycle).toBe('left');
      await eventually('n1 connected', async () => (await nodes()).find((n) => n.name === 'n1' && n.connected));

      // A replacement for the lost worker.
      const joinToken = await ok('POST', '/join-tokens', { ttlMinutes: 30 });

      await vm2.exec(
        `export ${ENV.join(' ')}; LOADWEAVER_JOIN_TOKEN='${joinToken.token}' node ${AGENT} join-via ${vm1.ip}:3400 --name n2 --endpoint-host ${vm2.ip}`,
        { timeoutMs: 300_000 },
      );
      await startAgent(vm2);

      // Object store anew, repository re-seeded from the target, the volume restored, the deployment running.
      const recovered = await timed('volumes restored', () =>
        eventually(
          'the volume restored',
          async () => {
            // The recovery gives up on a volume after three failed restores: no point in waiting then.
            const restores = (await ok('GET', '/backups/restores?project=shop')) as Array<{
              name: string;
              status: string;
              error: string | null;
            }>;
            const failed = restores.filter((r) => r.name.startsWith('dr-') && r.status === 'failed');

            // Last view, written to the diagnostics when the wait times out (G5: no restore ever showed up).
            facts['lastRestores'] = restores
              .map((r) => `${r.name}:${r.status}${r.error ? `:${r.error}` : ''}`)
              .join(', ');

            if (failed.length >= 3)
              throw new FatalDrillError(`volume restore failed: ${failed.map((r) => r.error).join('; ')}`);

            const holder = await workloadHolder();

            facts['lastHolder'] = holder ? `${holder.vm.name}/${holder.name}` : 'none';

            if (!holder) return undefined;

            const sha = (
              await holder.vm.exec(`docker exec ${holder.name} sha256sum /data/seed 2>/dev/null || true`, QUICK)
            )
              .trim()
              .split(/\s+/)[0];

            return sha === volumeSha ? holder : undefined;
          },
          1_200_000,
          10_000,
        ),
      );

      facts['restoredOn'] = recovered.vm.name;

      // Secrets decrypt with the recovered master key: the next copy uses the target's credentials secret.
      expect(await ok('POST', '/backups/platform/copies/run')).toEqual([
        expect.objectContaining({ target: 'offsite', status: 'succeeded' }),
      ]);

      const platform = await ok('GET', '/backups/platform');

      facts['postgresScope'] = platform.postgresScope;
      facts['restores'] = (await ok('GET', '/backups/restores?project=shop')).length;
    } catch (error) {
      process.stderr.write(`[dr-drill] vm1:\n${await diagnostics(vm1)}\n[dr-drill] vm2:\n${await diagnostics(vm2)}\n`);
      throw error;
    }
  }, 3_600_000);

  it('cleans up the staging copy and leaves no restore containers behind', async () => {
    expect(await vm1.exec('docker ps -aq --filter label=loadweaver.com/component=dr-restore')).toBe('');
    expect(existsSync(local)).toBe(true);
  });
});
