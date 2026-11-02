import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  backupRunSchema,
  backupServerRoleSchema,
  restoreRunSchema,
  volumeAssignmentSchema,
  volumeBackupUser,
  type BackupProgress,
  type KopiaRepositoryAccess,
  type VolumeAssignment,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import { GOLDEN_PINS } from './golden';
import { BACKUP_AGENT_BUNDLE } from './vm-lab.global-setup';
import { startVmLab, type Vm, type VmLab } from './vm-lab';

/**
 * Backups on real kernels (M6 step 3a, 3.20): the node agent's backup side (bundled from `backup-agent.entry.ts`:
 * real `BackupService`, `KopiaServerManager`, `VolumeManager` on LVM thin + LUKS2 + DRBD 9) on two Debian 13 VMs.
 * vm1 runs a single-node Garage, the Kopia repository server from desired state `backupServer` (the contract's
 * `kopiaServerScript`, self-signed TLS pinned by fingerprint) and holds the primaries; vm2 holds the second replicas.
 * The test plays the control plane: it creates the volume's Kopia user on the server (the control plane's job) and
 * sends `backupRun` / `restoreRun`, reading the agent's `backupProgress` reports back.
 *
 * (a) backup with pre / post hooks in the replica → snapshot in the repository; (b) whole-volume restore into a NEW
 * volume → same files (sha256, owners, modes); (c) replace restore into the in-use volume (containers stopped and
 * started again); (d) single-path restore (refuses to overwrite, restores a deleted file, overwrites when asked);
 * (e) scratch restore tests with a passing and a failing check; (f) the volume's user can't delete its snapshot;
 * nothing of the jobs is left on the host.
 */

const BUSYBOX = GOLDEN_PINS.busyboxImage;
const KOPIA = COMPONENT_IMAGES.kopia;
const GARAGE = COMPONENT_IMAGES.garage;
const AGENT = '/opt/loadweaver/backup-agent.js';
const SOCKET = '/run/lw-bk-lab.sock';
const SERVER_PORT = 7500;
const SCOPE = 'project-shop';
const SERVER_CONTAINER = `lw-kopia-${SCOPE}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secret = () => randomBytes(32).toString('base64url');
/** `repo@sha256:…` (Docker can't save / load references with both a tag and a digest). */
const byDigest = (image: string) => image.replace(/:[^/@]+@/, '@');

async function eventually<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 120_000, stepMs = 500) {
  const start = Date.now();
  let last: unknown;

  for (;;) {
    try {
      const value = await fn();

      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }

    if (Date.now() - start > timeoutMs)
      throw new Error(`${what}: not reached in ${timeoutMs} ms${last ? ` (${String(last)})` : ''}`);

    await sleep(stepMs);
  }
}

describe('backups on real kernels (VM lab)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let local: string;
  let repository: KopiaRepositoryAccess;
  let fingerprint: string;
  let snapshot: NonNullable<BackupProgress['snapshot']>;
  let original: string;
  const results: Record<string, unknown> = {};

  const api = async <T>(vm: Vm, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const out = await vm.exec(
      body === undefined
        ? `curl -sf --unix-socket ${SOCKET} -X ${method} http://lab${path}`
        : `curl -sS --max-time 900 --unix-socket ${SOCKET} -X ${method} -H 'Content-Type: application/json' --data-binary @- http://lab${path} <<'LWEOF'\n${JSON.stringify(body)}\nLWEOF`,
      { timeoutMs: 960_000 },
    );
    const parsed = JSON.parse(out) as T & { error?: string };

    if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) throw new Error(parsed.error);

    return parsed;
  };

  /** Sends a command and waits for the agent's final report (as the control plane receives it). */
  const command = async (
    type: 'backupRun' | 'restoreRun',
    payload: { backup?: string; restore?: string; [key: string]: unknown },
  ) => {
    const id = (payload.backup ?? payload.restore) as string;
    const start = Date.now();

    await api(vm1, 'POST', '/message', { type, payload });

    const report = await eventually(
      `${type} ${id}`,
      async () =>
        (await api<BackupProgress[]>(vm1, 'GET', '/progress'))
          .filter((p) => p.id === id && p.status !== 'running')
          .pop(),
      600_000,
      500,
    );

    return { report, ms: Date.now() - start };
  };

  const volume = (name: string, minor: number): VolumeAssignment =>
    volumeAssignmentSchema.parse({
      id: `shop/db/${name}`,
      dockerName: `lw-vol-shop.db.${name}`,
      minor,
      port: 7800 + minor - 1000,
      sizeBytes: 512 * 1024 ** 2,
      replicas: [
        { node: 'vm1', nodeId: 0, address: vm1.ip },
        { node: 'vm2', nodeId: 1, address: vm2.ip },
      ],
      connections: [{ a: 'vm1', b: 'vm2', protocol: 'C' }],
      primary: 'vm1',
      keyRef: `secret://shop/lw-volume-db.${name}`,
    });

  const apply = (volumes: VolumeAssignment[]) =>
    Promise.all([vm1, vm2].map((vm) => api(vm, 'POST', '/apply', { node: vm.name, volumes })));

  const connected = (v: VolumeAssignment) =>
    eventually(`lw-${v.minor} connected`, async () => {
      const [status] = JSON.parse(await vm1.exec(`drbdsetup status lw-${v.minor} --json`)) as {
        connections: { 'connection-state': string }[];
      }[];

      return status?.connections.every((c) => c['connection-state'] === 'Connected') ? true : undefined;
    });

  /** sha256, owner and mode of every file (lost+found aside), from inside a container using the volume. */
  const MANIFEST =
    'cd /data && find . \\( -type f -o -type l \\) ! -path "./lost+found/*" | sort | ' +
    'while read -r f; do if [ -L "$f" ]; then echo "$f -> $(readlink "$f")"; ' +
    'else echo "$(sha256sum "$f" | cut -d" " -f1) $(stat -c "%u:%g %a" "$f") $f"; fi; done';
  const manifestOf = async (dockerName: string) =>
    vm1.exec(`docker run --rm --volume-driver loadweaver -v ${dockerName}:/data ${BUSYBOX} sh -c '${MANIFEST}'`);
  const manifestInStore = () => vm1.exec(`docker exec store sh -c '${MANIFEST}'`);

  const noLeftovers = async () => {
    expect(await vm1.exec('lvs --noheadings -o lv_name loadweaver')).not.toContain('lw-bk-');
    expect(await vm1.exec('dmsetup ls')).not.toContain('lw-bk-');
    expect(await vm1.exec('grep -c lw-bk- /proc/mounts || true')).toBe('0\n');
    expect(await vm1.exec('docker ps -aq --filter label=loadweaver.com/component=backup-job')).toBe('');
    expect(await vm1.exec('ls /run/loadweaver | grep -c lw-bk- || true')).toBe('0\n');
  };

  beforeAll(async () => {
    lab = await startVmLab({
      vms: [
        { name: 'vm1', site: 'a', memoryMb: 2048, dataDiskGb: 4 },
        { name: 'vm2', site: 'a', memoryMb: 1280, dataDiskGb: 4 },
      ],
      log: (line) => process.stderr.write(`[vm-lab] ${line}\n`),
    });
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
    local = await mkdtemp(join(tmpdir(), 'lw-bk-lab-'));

    const started = Date.now();

    // Images: Kopia and Garage from the local Docker (the agent pulls by digest only if they are missing).
    for (const [name, image] of [
      ['kopia', KOPIA],
      ['garage', GARAGE],
    ]) {
      execFileSync('docker', ['pull', '-q', byDigest(image)], { stdio: 'ignore' });
      execFileSync('docker', ['save', '-o', join(local, `${name}.tar`), byDigest(image)]);
      await vm1.copyIn(join(local, `${name}.tar`), `/tmp/${name}.tar`);
      await vm1.exec(`docker load -q -i /tmp/${name}.tar && rm -f /tmp/${name}.tar`, { timeoutMs: 300_000 });
    }

    results['imagesMs'] = Date.now() - started;

    await Promise.all(
      [vm1, vm2].map(async (vm) => {
        await vm.copyIn(BACKUP_AGENT_BUNDLE, AGENT);
        await vm.exec(
          [
            'install -d -m 0700 /var/lib/loadweaver /etc/loadweaver',
            "printf '%s' lab-volume-key-0123456789abcdef > /etc/loadweaver/lab-volume.key",
            'chmod 0600 /etc/loadweaver/lab-volume.key',
            `pvcreate -q ${vm.dataDisk} && vgcreate -q loadweaver ${vm.dataDisk}`,
            'lvcreate -q -l 90%FREE -T loadweaver/pool',
            'modprobe drbd',
            `systemd-run --unit lw-bk -E LOADWEAVER_STATE_DIR=/var/lib/loadweaver node ${AGENT} serve`,
          ].join('\n'),
        );
        await eventually(`${vm.name} agent`, async () =>
          (await vm.exec(`test -S ${SOCKET} && echo ok || true`)).includes('ok') ? true : undefined,
        );
      }),
    );

    // Single-node Garage on vm1 with a bucket and a key for the repository server.
    await vm1.exec(
      [
        'install -d -m 0700 /srv/garage',
        `cat > /srv/garage/garage.toml <<'EOF'`,
        'metadata_dir = "/var/lib/garage/meta"',
        'data_dir = "/var/lib/garage/data"',
        'db_engine = "lmdb"',
        'replication_factor = 1',
        `rpc_bind_addr = "${vm1.ip}:3901"`,
        `rpc_public_addr = "${vm1.ip}:3901"`,
        `rpc_secret = "${randomBytes(32).toString('hex')}"`,
        '[s3_api]',
        's3_region = "garage"',
        `api_bind_addr = "${vm1.ip}:3900"`,
        '[admin]',
        'api_bind_addr = "127.0.0.1:3903"',
        `admin_token = "${randomBytes(32).toString('hex')}"`,
        'EOF',
        `docker run -d --name lab-garage --network host -v /srv/garage/garage.toml:/etc/garage.toml:ro -v /srv/garage/meta:/var/lib/garage/meta -v /srv/garage/data:/var/lib/garage/data ${byDigest(GARAGE)} >/dev/null`,
      ].join('\n'),
    );

    const garage = (args: string) => vm1.exec(`docker exec lab-garage /garage ${args} 2>/dev/null`);
    const id = await eventually(
      'garage up',
      async () => /^([0-9a-f]{16})\s.*NO ROLE ASSIGNED/m.exec(await garage('status'))?.[1],
    );

    await garage(`layout assign -z a -c 2G ${id}`);
    await garage('layout apply --version 1');

    const key = await garage('key create lab-backups');
    const accessKeyId = /Key ID:\s+(\S+)/.exec(key)?.[1] as string;
    const secretAccessKey = /Secret key:\s+(\S+)/.exec(key)?.[1] as string;

    await garage('bucket create lw-backups');
    await garage('bucket allow --read --write --owner lw-backups --key lab-backups');

    // The repository server's certificate (self-signed, pinned by the clients).
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      join(local, 'tls.key'),
      '-out',
      join(local, 'tls.crt'),
      '-subj',
      '/CN=lw-backups',
      '-days',
      '1',
      '-addext',
      `subjectAltName=IP:${vm1.ip}`,
    ]);

    const certificatePem = await readFile(join(local, 'tls.crt'), 'utf8');

    fingerprint = new X509Certificate(certificatePem).fingerprint256.replace(/:/g, '').toLowerCase();

    const serverStart = Date.now();

    await api(
      vm1,
      'POST',
      '/servers',
      backupServerRoleSchema.parse({
        repositories: [
          {
            scope: SCOPE,
            port: SERVER_PORT,
            s3: { address: vm1.ip, port: 3900, bucket: 'lw-backups', prefix: `${SCOPE}/` },
            tls: { certificatePem, privateKeyPem: await readFile(join(local, 'tls.key'), 'utf8') },
            accessKeyId,
            secretAccessKey,
            password: secret(),
            controlPassword: secret(),
            serverControlPassword: secret(),
          },
        ],
      }),
    );
    await eventually(
      'repository server up',
      async () =>
        (await vm1.exec(`docker logs ${SERVER_CONTAINER} 2>&1 | grep -c 'SERVER ADDRESS' || true`)).trim() !== '0'
          ? true
          : undefined,
      180_000,
      1_000,
    );
    results['repositoryServerStartMs'] = Date.now() - serverStart;
    // Secrets only in the container's environment, never in its arguments.
    expect(await vm1.exec(`docker inspect -f '{{json .Args}}' ${SERVER_CONTAINER}`)).not.toMatch(
      new RegExp(`${secretAccessKey}|${accessKeyId}`),
    );

    // The control plane's part: the volume's Kopia user (here through the server container's FULL connection).
    const user = volumeBackupUser('shop/db/data');

    repository = {
      scope: SCOPE,
      servers: [{ address: vm1.ip, port: SERVER_PORT }],
      fingerprint,
      username: user.username,
      hostname: user.hostname,
      password: secret(),
    };
    await vm1.exec(
      `docker exec ${SERVER_CONTAINER} sh -c 'kopia server user add ${user.username}@${user.hostname} --user-password=${repository.password} >/dev/null && ` +
        `kopia server refresh --address=https://127.0.0.1:${SERVER_PORT} --server-cert-fingerprint=${fingerprint} --server-control-password="$KOPIA_SERVER_CONTROL_PASSWORD"'`,
    );

    // The volume, used by a replica of the service (the hooks run there).
    const data = volume('data', 1000);

    await apply([data]);
    await connected(data);
    await vm1.exec(
      [
        `docker run -d --name store --label loadweaver.com/managed=true --label loadweaver.com/workload=shop/db/store/0 --volume-driver loadweaver -v ${data.dockerName}:/data ${BUSYBOX} sleep 1000000 >/dev/null`,
        `docker exec store sh -c 'mkdir -p /data/dir/sub && head -c 20000000 /dev/urandom > /data/big.bin && echo hello > /data/dir/small.txt && echo deep > /data/dir/sub/x.txt && ln -s dir/small.txt /data/link && echo secret > /data/owned && chown 1234:1234 /data/owned && chmod 0600 /data/owned'`,
      ].join('\n'),
    );
  }, 1_200_000);

  afterAll(async () => {
    // The agent's log (job reports, warnings) for failed runs.
    const journal = await vm1
      ?.exec('journalctl -u lw-bk --no-pager | tail -n 60', { allowFailure: true })
      .catch(() => '');

    process.stderr.write(`[vm-lab] vm1 backup agent:\n${journal ?? ''}\n`);
    await lab?.stop();

    if (local) await rm(local, { recursive: true, force: true }).catch(() => undefined);

    process.stderr.write(`[vm-lab] backup results: ${JSON.stringify(results, null, 1)}\n`);
  });

  it('(a) backs up a volume in use with pre / post hooks into the repository', async () => {
    const backup = randomUUID();
    const { report, ms } = await command(
      'backupRun',
      backupRunSchema.parse({
        backup,
        volume: 'shop/db/data',
        repository,
        description: 'lab backup',
        tags: { policy: 'lab' },
        hooks: {
          replica: 'shop/db/store/0',
          pre: ['sh', '-c', 'date +%s > /data/pre-marker && sync'],
          post: ['sh', '-c', 'echo done > /tmp/post-ran'],
          timeoutSeconds: 30,
        },
      }),
    );

    expect(report.error).toBeUndefined();
    expect(report).toMatchObject({ status: 'done', operation: 'backup', hooks: true });
    expect(report.bytes).toBeGreaterThan(20_000_000);
    expect(report.files).toBe(5);
    snapshot = report.snapshot as NonNullable<BackupProgress['snapshot']>;
    expect(await vm1.exec('docker exec store cat /tmp/post-ran')).toBe('done\n');

    // The control plane (FULL) sees it as the volume's snapshot.
    const list = JSON.parse(await vm1.exec(`docker exec ${SERVER_CONTAINER} kopia snapshot list --all --json`)) as {
      id: string;
      source: { userName: string; host: string; path: string };
    }[];

    expect(list.find((s) => s.id === snapshot.manifestId)?.source).toEqual({
      userName: repository.username,
      host: repository.hostname,
      path: '/volume',
    });
    original = await manifestInStore();
    expect(original).toContain('./pre-marker');
    await noLeftovers();

    // Re-sent: the stored result is reported again, no second snapshot.
    const finals = async () =>
      (await api<BackupProgress[]>(vm1, 'GET', '/progress')).filter((p) => p.id === backup && p.status !== 'running');
    const reported = (await finals()).length;

    await api(vm1, 'POST', '/message', {
      type: 'backupRun',
      payload: { backup, volume: 'shop/db/data', repository, description: 'lab backup', tags: {} },
    });

    const again = await eventually('re-sent backup reported', async () => {
      const all = await finals();

      return all.length > reported ? all[all.length - 1] : undefined;
    });

    expect(again).toEqual(report);
    expect(JSON.parse(await vm1.exec(`docker exec ${SERVER_CONTAINER} kopia snapshot list --all --json`))).toHaveLength(
      1,
    );

    // Second (incremental) backup: only the new marker is uploaded.
    const second = await command(
      'backupRun',
      backupRunSchema.parse({ backup: randomUUID(), volume: 'shop/db/data', repository, description: 'x', tags: {} }),
    );

    expect(second.report.error).toBeUndefined();
    expect(second.report.status).toBe('done');
    results['a'] = { backupMs: ms, incrementalMs: second.ms, bytes: report.bytes, files: report.files };
  });

  it('(b) restores the whole snapshot into a new volume', async () => {
    const restored = volume('restored', 1001);

    await apply([volume('data', 1000), restored]);
    await connected(restored);

    const { report, ms } = await command(
      'restoreRun',
      restoreRunSchema.parse({
        restore: randomUUID(),
        kind: 'volume',
        mode: 'replace',
        snapshot: snapshot.rootObject,
        repository,
        volume: restored.id,
      }),
    );

    expect(report.error).toBeUndefined();
    expect(report).toMatchObject({ status: 'done' });
    expect(await manifestOf(restored.dockerName)).toBe(original);
    results['b'] = { restoreNewVolumeMs: ms };
    await noLeftovers();
  });

  it('(c) replaces the content of the volume in use (containers stopped and started again)', async () => {
    const before = await vm1.exec("docker inspect -f '{{.State.StartedAt}}' store");

    await vm1.exec("docker exec store sh -c 'rm /data/dir/small.txt && echo extra > /data/extra.txt'");

    const { report, ms } = await command(
      'restoreRun',
      restoreRunSchema.parse({
        restore: randomUUID(),
        kind: 'volume',
        mode: 'replace',
        snapshot: snapshot.rootObject,
        repository,
        volume: 'shop/db/data',
      }),
    );

    expect(report.error).toBeUndefined();
    expect(report).toMatchObject({ status: 'done' });
    expect(await vm1.exec("docker inspect -f '{{.State.Running}}' store")).toBe('true\n');
    expect(await vm1.exec("docker inspect -f '{{.State.StartedAt}}' store")).not.toBe(before);
    expect(await manifestInStore()).toBe(original);
    results['c'] = { replaceInUseMs: ms };
  });

  it('(d) restores a single file, refusing to overwrite unless asked', async () => {
    const path = (overrides: Record<string, unknown>) =>
      restoreRunSchema.parse({
        restore: randomUUID(),
        kind: 'path',
        snapshot: snapshot.rootObject,
        repository,
        volume: 'shop/db/data',
        path: 'dir/small.txt',
        ...overrides,
      });

    await vm1.exec("docker exec store sh -c 'echo changed > /data/dir/small.txt'");

    const refused = await command('restoreRun', path({}));

    expect(refused.report).toMatchObject({ status: 'failed', error: expect.stringContaining('exists in the volume') });
    expect(await vm1.exec('docker exec store cat /data/dir/small.txt')).toBe('changed\n');

    const overwritten = await command('restoreRun', path({ overwrite: true }));

    expect(overwritten.report.error).toBeUndefined();
    expect(overwritten.report.status).toBe('done');
    expect(await vm1.exec('docker exec store cat /data/dir/small.txt')).toBe('hello\n');

    // Into another place (a deleted directory comes back with its parents).
    const elsewhere = await command('restoreRun', path({ path: 'dir/sub', targetPath: 'copy/of/sub' }));

    expect(elsewhere.report.error).toBeUndefined();
    expect(elsewhere.report.status).toBe('done');
    expect(await vm1.exec('docker exec store cat /data/copy/of/sub/x.txt')).toBe('deep\n');
    expect(await vm1.exec("docker inspect -f '{{.State.Running}}' store")).toBe('true\n');
    results['d'] = { singleFileMs: overwritten.ms };
    await noLeftovers();
  });

  it('(e) restore tests into a throw-away scratch volume with a check', async () => {
    const scratch = (check: string[]) =>
      restoreRunSchema.parse({
        restore: randomUUID(),
        kind: 'scratch',
        snapshot: snapshot.rootObject,
        repository,
        volume: 'shop/db/data',
        sizeBytes: 512 * 1024 ** 2,
        check: { image: BUSYBOX, command: check, mountPath: '/restored', timeoutSeconds: 60 },
      });
    const passed = await command(
      'restoreRun',
      scratch([
        'sh',
        '-c',
        'test -s /restored/pre-marker && stat -c "%u %a" /restored/owned && sha256sum /restored/big.bin',
      ]),
    );
    const expectedSum = /^([0-9a-f]{64}) 0:0 \d+ \.\/big\.bin$/m.exec(original)?.[1];

    expect(passed.report.error).toBeUndefined();
    expect(passed.report).toMatchObject({ status: 'done', check: { exitCode: 0 } });
    expect(passed.report.check?.output).toContain('1234 600');
    expect(passed.report.check?.output).toContain(expectedSum);

    const failed = await command('restoreRun', scratch(['sh', '-c', 'echo missing table; exit 3']));

    expect(failed.report).toMatchObject({
      status: 'failed',
      phase: 'check',
      check: { exitCode: 3, output: 'missing table\n' },
    });
    results['e'] = { scratchWithCheckMs: passed.ms, failingCheckMs: failed.ms };
    await noLeftovers();
  });

  it("(f) the volume's user can't delete its snapshot", async () => {
    const out = await vm1.exec(
      [
        'rm -rf /tmp/lab-client && install -d -m 0700 /tmp/lab-client',
        `docker run --rm --network host -v /tmp/lab-client:/app -e KOPIA_PASSWORD=${repository.password} ${byDigest(KOPIA)} repository connect server --url=https://${vm1.ip}:${SERVER_PORT} --server-cert-fingerprint=${fingerprint} --override-username=${repository.username} --override-hostname=${repository.hostname} >/dev/null 2>&1`,
        `docker run --rm --network host -v /tmp/lab-client:/app -e KOPIA_PASSWORD=${repository.password} ${byDigest(KOPIA)} snapshot delete ${snapshot.manifestId} --delete 2>&1 || true`,
      ].join('\n'),
    );

    expect(out).toContain('access denied');
    expect(await vm1.exec(`docker exec ${SERVER_CONTAINER} kopia snapshot list --all --json`)).toContain(
      snapshot.manifestId,
    );
  });
});
