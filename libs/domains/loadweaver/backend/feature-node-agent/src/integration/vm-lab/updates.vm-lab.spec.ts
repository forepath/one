import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  ComponentVersions,
  NodeComponents,
  VolumeAssignment,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  buildManifest,
  canonicalJson,
  DRBD_PIN,
  generateReleaseKeyPair,
  inspectDrbdCompatEntry,
  signManifest,
  type ArtifactFile,
  type ReleaseManifest,
} from '@forepath/loadweaver/shared/util-release';

import { OLDER_KERNEL_IMAGE } from './golden';
import { APT_SOURCE_BUNDLE, UPDATES_AGENT_BUNDLE, VOLUME_DRIVER_BUNDLE } from './vm-lab.global-setup';
import { startVmLab, type Vm, type VmLab } from './vm-lab';

/**
 * Update rollout on real VMs (M6 step 2, 3.26). vm1 plays the cluster the nodes fetch from: the control plane's
 * frozen-index apt source (real `takeSnapshot` / `serveAptFile` over the Debian / Docker archives, through the lab's
 * NAT) and its artifact route. vm2 runs the node agent's update side (real `UpdatesService`, bundled from
 * `updates-agent.entry.ts`) as `loadweaver-agent.service` under systemd; the test plays the rollout controller.
 *
 * (a) Self-update: the release's agent is downloaded by checksum, verified against the signed manifest, swapped by a
 *     transient unit and restarted; it confirms and the rollback timer stops. A workload container keeps running —
 *     also across a Docker restart (live-restore). (b) A release whose agent never starts: the rollback timer puts the
 *     previous binary back, which reports `rolled-back` and doesn't try that release again; the container still runs.
 * (a2) Platform images as the rollout's `images` gate sees them: Docker's list API `Image` is the created-from
 *     reference incl. its digest (`docker inspect`'s `.Image` is the image ID; containerd image store in the golden).
 * (c) Host update path, one node: drain (the workload stops) → OS update from the cluster-local apt snapshot (a real
 *     package update: the test first moves one package back to an older version of the snapshot, the update brings
 *     it forward again) with the release's pins → reboot on the controller's token → rejoin (new boot id, agent back
 *     by itself, DRBD 9 module loads) → uncordon. The default golden image runs the snapshot's newest kernel, so the
 *     reboot is requested through `/run/reboot-required` here; the real kernel-ABI change is (d) below.
 */

/** The release pipeline's DRBD compat-patch generator (bundle build time, see util-release `drbd-compat.ts`). */
const DRBD_COMPAT_SCRIPT = resolve(__dirname, '../../../../../shared/util-release/scripts/drbd-compat.sh');

const BUSYBOX =
  'docker.io/library/busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e';
const KEY = generateReleaseKeyPair();
const CP_PORT = 8080;
const SOCKET = '/run/lw-updates-lab.sock';
const ROLE = { role: 'none' as const, members: [], automaticFailover: false, scope: 'lab' };

/** The snapshot the control plane takes at plan time (Debian 13 + security + Docker's repository). */
const UPSTREAMS = [
  {
    name: 'debian-trixie',
    url: 'https://deb.debian.org/debian',
    suites: ['trixie', 'trixie-updates'],
    components: ['main'],
    arches: ['amd64'],
    keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
    os: 'debian:13',
  },
  {
    name: 'debian-security-trixie',
    url: 'https://security.debian.org/debian-security',
    suites: ['trixie-security'],
    components: ['main'],
    arches: ['amd64'],
    keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
    os: 'debian:13',
  },
  {
    name: 'docker-debian-trixie',
    url: 'https://download.docker.com/linux/debian',
    suites: ['trixie'],
    components: ['stable'],
    arches: ['amd64'],
    // The golden image keeps Docker's key as .asc (nodes from the installer: /etc/apt/keyrings/docker.gpg).
    keyring: '/etc/apt/keyrings/docker.asc',
    os: 'debian:13',
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ends an `eventually` at once (a failed action doesn't recover by waiting). */
class FatalError extends Error {}

async function eventually<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 120_000, stepMs = 1_000) {
  const start = Date.now();
  let last: unknown;

  for (;;) {
    try {
      const value = await fn();

      if (value !== undefined) return value;
    } catch (error) {
      if (error instanceof FatalError) throw error;

      last = error;
    }

    if (Date.now() - start > timeoutMs)
      throw new Error(`${what}: not reached in ${timeoutMs} ms${last ? ` (${String(last)})` : ''}`);

    await sleep(stepMs);
  }
}

/** The agent wrapper of one release: what `/usr/local/bin/loadweaver-agent` is (the lab's "binary"). */
function wrapper(version: string, broken = false): string {
  return broken
    ? '#!/bin/sh\necho "this agent build is broken" >&2\nexit 1\n'
    : [
        '#!/bin/sh',
        `export LOADWEAVER_AGENT_VERSION=${version}`,
        'export LOADWEAVER_STATE_DIR=/var/lib/loadweaver',
        'export LOADWEAVER_SELF_UPDATE_CONFIRM_SECONDS=30',
        'export LOADWEAVER_RELEASE_DEV_KEYS="$(cat /etc/loadweaver/release-dev.pem)"',
        'exec /usr/local/bin/node /opt/loadweaver/updates-agent.js serve',
        '',
      ].join('\n');
}

describe('updates on real VMs (VM lab)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  // Created by beforeAll (a describe filtered out with -t never runs afterAll, which removes it).
  let local = '';
  const results: Record<string, unknown> = {};

  /**
   * Calls the agent's control API on vm2. `restarts`: the call may start the agent's own restart (self-update), which
   * can cut the answer off — then it resolves with `{}`.
   */
  const agent = async <T>(method: 'GET' | 'POST', path: string, body?: unknown, restarts = false): Promise<T> => {
    const data = body === undefined ? '' : `-H 'content-type: application/json' --data-binary @/tmp/lw-req.json`;

    if (body !== undefined) {
      const file = join(local, 'req.json');

      writeFileSync(file, JSON.stringify(body));
      await vm2.copyIn(file, '/tmp/lw-req.json', '0600');
    }

    const command = `curl -sf --max-time 600 --unix-socket ${SOCKET} -X ${method} ${data} http://lab${path}`;

    if (restarts) {
      const result = await vm2.execResult(command, { timeoutMs: 660_000, allowFailure: true });

      return (result.code === 0 && result.stdout.trim() ? JSON.parse(result.stdout) : {}) as T;
    }

    return JSON.parse(await vm2.exec(command, { timeoutMs: 660_000 })) as T;
  };

  /** Stores a file in the "cluster" (vm1) and returns its artifact entry. */
  const publish = async (name: string, content: string, path: string): Promise<ArtifactFile> => {
    const file = join(local, name);

    writeFileSync(file, content);
    await vm1.copyIn(file, `/tmp/${name}`, '0644');

    const sha = (await vm1.exec(`node /opt/loadweaver/apt-source.js put /srv/lw /tmp/${name}`)).trim();

    expect(sha).toBe(createHash('sha256').update(content).digest('hex'));

    return { path, sha256: sha, size: Buffer.byteLength(content) };
  };

  const release = (version: string, agentFile: ArtifactFile): ReleaseManifest =>
    buildManifest({
      version,
      channel: 'stable',
      created: new Date().toISOString(),
      images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:${version}@sha256:${'c'.repeat(64)}` },
      agentBinaries: { amd64: agentFile },
    });

  const components = (manifest: ReleaseManifest, extra: Partial<NodeComponents> = {}): NodeComponents => {
    const bytes = canonicalJson(manifest);

    return {
      release: manifest.version,
      manifest: bytes,
      signature: JSON.stringify(signManifest(Buffer.from(bytes), KEY.privateKeyPem)),
      artifactBase: '/api/updates/artifacts',
      ...extra,
    };
  };

  const version = () => agent<{ version: string; pid: number }>('GET', '/version');
  const report = () => agent<ComponentVersions>('GET', '/report');
  const app = async () =>
    (await vm2.exec(`docker inspect -f '{{.State.Pid}} {{.State.StartedAt}} {{.State.Running}}' lab-app`)).trim();
  const bootId = async () => (await vm2.exec('cat /proc/sys/kernel/random/boot_id')).trim();

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), 'lw-vmlab-updates-'));
    lab = await startVmLab({
      vms: [
        { name: 'vm1', site: 'a', memoryMb: 1024 },
        { name: 'vm2', site: 'a', memoryMb: 1536, cpus: 2 },
      ],
      log: (line) => process.stderr.write(`[vm-lab] ${line}\n`),
    });
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);

    // vm1: the cluster's update file routes.
    await vm1.exec('mkdir -p /opt/loadweaver /srv/lw');
    await vm1.copyIn(APT_SOURCE_BUNDLE, '/opt/loadweaver/apt-source.js', '0644');

    // vm2: the agent as a systemd service, starting from release 3.4.0's agent.
    const pem = join(local, 'release-dev.pem');

    writeFileSync(pem, KEY.publicKeyPem);
    writeFileSync(join(local, 'agent-3.4.0'), wrapper('3.4.0'));
    writeFileSync(
      join(local, 'identity.json'),
      JSON.stringify({
        clusterId: 'lab',
        nodeName: 'n2',
        controlPlaneUrl: `http://${vm1.ip}:${CP_PORT}`,
        controlPlaneEndpoints: [],
      }),
    );
    writeFileSync(
      join(local, 'loadweaver-agent.service'),
      [
        '[Unit]',
        'Description=Loadweaver node agent (VM lab)',
        'After=network-online.target docker.service',
        '[Service]',
        'ExecStart=/usr/local/bin/loadweaver-agent',
        'Restart=always',
        'RestartSec=1',
        '[Install]',
        'WantedBy=multi-user.target',
        '',
      ].join('\n'),
    );
    await vm2.exec('mkdir -p /opt/loadweaver /etc/loadweaver /var/lib/loadweaver && chmod 700 /var/lib/loadweaver');
    await vm2.copyIn(UPDATES_AGENT_BUNDLE, '/opt/loadweaver/updates-agent.js', '0644');
    await vm2.copyIn(pem, '/etc/loadweaver/release-dev.pem', '0644');
    await vm2.copyIn(join(local, 'agent-3.4.0'), '/usr/local/bin/loadweaver-agent', '0755');
    await vm2.copyIn(join(local, 'identity.json'), '/var/lib/loadweaver/identity.json', '0600');
    await vm2.copyIn(join(local, 'loadweaver-agent.service'), '/etc/systemd/system/loadweaver-agent.service', '0644');
    await vm2.exec(`docker run -d --name lab-app --restart unless-stopped ${BUSYBOX} sleep 1000000 >/dev/null`);
    await vm2.exec('systemctl daemon-reload && systemctl enable --now loadweaver-agent');
    await eventually('agent up', async () => ((await version()).version === '3.4.0' ? true : undefined), 60_000);
  });

  afterAll(async () => {
    await lab?.stop();
    if (local) rmSync(local, { recursive: true, force: true });
    process.stderr.write(`[vm-lab] update results: ${JSON.stringify(results, null, 1)}\n`);
  });

  it('(a) swaps the agent to the release by checksum and keeps containers running (live-restore)', async () => {
    await vm1.exec(
      `systemd-run --unit=lw-cluster --collect node /opt/loadweaver/apt-source.js serve /srv/lw ${CP_PORT}`,
    );

    const before = await app();
    const old = await version();
    const manifest = release(
      '3.5.0',
      await publish('agent-3.5.0', wrapper('3.5.0'), 'artifacts/bin/loadweaver-agent-linux-amd64'),
    );
    const target = components(manifest);
    const started = Date.now();

    expect(await agent('POST', '/apply', { components: target, role: ROLE, address: vm2.ip })).toEqual({
      changed: true,
    });
    await agent('POST', '/after-apply', { components: target }, true);

    const next = await eventually('agent 3.5.0 running', async () => {
      const v = await version();

      return v.version === '3.5.0' ? v : undefined;
    });

    results['selfUpdateRestartMs'] = Date.now() - started;
    expect(next.pid).not.toBe(old.pid);
    expect(
      await vm2.exec(
        'cmp /usr/local/bin/loadweaver-agent /var/lib/loadweaver/updates/loadweaver-agent-3.5.0 && echo same',
      ),
    ).toContain('same');
    expect(
      await vm2.exec('grep -c LOADWEAVER_AGENT_VERSION=3.4.0 /var/lib/loadweaver/updates/loadweaver-agent.prev'),
    ).toContain('1');

    // The control plane's next desired state confirms it: the rollback timer stops.
    await agent('POST', '/apply', { components: target, role: ROLE, address: vm2.ip });
    await agent('POST', '/after-apply', { components: target });
    expect((await report()).actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'self-update:3.5.0', kind: 'self-update', phase: 'done' }),
      ]),
    );
    expect(
      await vm2.exec('test -e /var/lib/loadweaver/updates/self-update.json && echo pending || echo confirmed'),
    ).toContain('confirmed');
    expect(await vm2.exec("systemctl list-timers --all --no-legend 'loadweaver-agent-rollback-*' | wc -l")).toContain(
      '0',
    );

    // The workload never noticed; neither does it when Docker itself restarts (live-restore).
    expect(await app()).toBe(before);
    await vm2.exec('systemctl restart docker && docker info >/dev/null');
    expect(await app()).toBe(before);
    results['containerKept'] = before;
  });

  it("(a2) reports platform images with the release's digest, as the rollout's images gate compares them", async () => {
    // A platform container as the agent creates it: managed + component labels, the release reference by digest.
    const digest = BUSYBOX.slice(BUSYBOX.lastIndexOf('@') + 1);

    await vm2.exec(
      `docker run -d --name lw-etcd --memory 32m --label loadweaver.com/managed=true --label loadweaver.com/component=etcd ${BUSYBOX} sleep 1000000 >/dev/null`,
    );

    const inspect = async () =>
      (await vm2.exec(`docker inspect -f '{{.Image}} {{.Config.Image}}' lw-etcd`)).trim().split(' ');
    const listed = async () =>
      (
        JSON.parse(
          await vm2.exec(
            `curl -sf --unix-socket /var/run/docker.sock 'http://d/containers/json?filters=%7B%22name%22%3A%5B%22lw-etcd%22%5D%7D'`,
          ),
        ) as { Image: string; ImageID: string }[]
      )[0];
    const [imageField, configImage] = await inspect();
    const list = await listed();
    const reported = (await report()).images?.['etcd'];

    results['dockerImageFields'] = {
      storage: (await vm2.exec(`docker info -f '{{.Driver}} {{.DriverStatus}}'`)).trim(),
      inspectImage: imageField,
      inspectConfigImage: configImage,
      listImage: list.Image,
      listImageId: list.ImageID,
      reported,
    };
    // `docker inspect`'s `.Image` is the image ID (with the containerd image store the manifest digest, with the
    // classic store the config digest); the agent reports the list API's `Image`, the reference incl. the digest.
    expect(configImage).toBe(BUSYBOX);
    expect(list.Image).toBe(BUSYBOX);
    expect(reported).toBe(BUSYBOX);
    expect(reported?.endsWith(digest)).toBe(true);

    await vm2.exec('docker rm -f lw-etcd >/dev/null');
  });

  it('(b) puts the previous agent back when the new one never starts, and keeps the release from looping', async () => {
    const before = await app();
    const manifest = release(
      '3.6.0',
      await publish('agent-3.6.0', wrapper('3.6.0', true), 'artifacts/bin/loadweaver-agent-linux-amd64'),
    );
    const target = components(manifest);
    const started = Date.now();

    await agent('POST', '/apply', { components: target, role: ROLE, address: vm2.ip });
    await agent('POST', '/after-apply', { components: target }, true);
    // The broken agent can't answer; after the confirmation window (30 s in the lab) 3.5.0 is back.
    await eventually('broken agent installed', async () =>
      (await vm2.exec('grep -c "broken" /usr/local/bin/loadweaver-agent || true')).trim() === '1' ? true : undefined,
    );
    await eventually(
      'previous agent restored',
      async () => ((await version().catch(() => null))?.version === '3.5.0' ? true : undefined),
      180_000,
      2_000,
    );
    results['selfUpdateRollbackMs'] = Date.now() - started;

    // The restored agent learns from its desired state that the swap didn't stick, and doesn't try again: the block
    // is the action's error (M6 review L5), keyed by the release that asked for it.
    await agent('POST', '/after-apply', { components: target });
    expect((await report()).actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'self-update:3.6.0',
          phase: 'rolled-back',
          error: expect.stringContaining('not retried while it stays on release 3.6.0; 3.5.0 keeps running'),
        }),
      ]),
    );
    await agent('POST', '/after-apply', { components: target });
    expect(await vm2.exec('grep -c LOADWEAVER_AGENT_VERSION=3.5.0 /usr/local/bin/loadweaver-agent')).toContain('1');
    expect(await vm2.exec('ls /var/lib/loadweaver/updates/ | grep -c "^failed-3.6.0$" || true')).toContain('1');
    expect(await app()).toBe(before);

    // The step rolls back (the node is moved to 3.5.0 again): the block is cleared, a later step retries 3.6.0.
    const previous = components(
      release('3.5.0', await publish('agent-3.5.0', wrapper('3.5.0'), 'artifacts/bin/loadweaver-agent-linux-amd64')),
    );

    await agent('POST', '/apply', { components: previous, role: ROLE, address: vm2.ip });
    await agent('POST', '/after-apply', { components: previous });
    expect(await vm2.exec('ls /var/lib/loadweaver/updates/ | grep -c "^failed-" || true')).toContain('0');
    expect((await version()).version).toBe('3.5.0');
  });

  it('(c) drains, updates the OS from the cluster-local apt snapshot, reboots on the token and rejoins', async () => {
    const upstreams = UPSTREAMS;
    const upstreamsFile = join(local, 'upstreams.json');

    writeFileSync(upstreamsFile, JSON.stringify(upstreams));
    await vm1.copyIn(upstreamsFile, '/tmp/upstreams.json', '0644');

    const snapshotStart = Date.now();
    const snapshot = (
      await vm1.exec('node /opt/loadweaver/apt-source.js snapshot /srv/lw /tmp/upstreams.json', { timeoutMs: 600_000 })
    ).trim();

    results['aptSnapshotMs'] = Date.now() - snapshotStart;
    await vm1.exec('systemctl stop lw-cluster || true');
    await vm1.exec(
      `systemd-run --unit=lw-cluster-2 --collect node /opt/loadweaver/apt-source.js serve /srv/lw ${CP_PORT}`,
    );

    const sources = upstreams.map((u) => ({
      name: u.name,
      suites: u.suites,
      components: u.components,
      keyring: u.keyring,
    }));
    const aptBase = `/api/updates/apt/${snapshot}`;
    const aptOptions =
      '-o Dir::Etc::sourcelist=/tmp/lw-lab.list -o Dir::Etc::sourceparts=- -o Dir::State::Lists=/tmp/lw-lab-lists -o Acquire::Languages=none -o Acquire::Check-Valid-Until=false';
    const apt = `apt-get ${aptOptions}`;
    const cache = `apt-cache ${aptOptions}`;

    // Find a package with an older version in the snapshot and move it back, so the update has real work to do.
    writeFileSync(
      join(local, 'lw-lab.list'),
      sources
        .flatMap((s) =>
          s.suites.map(
            (suite) =>
              `deb [signed-by=${s.keyring}] http://${vm1.ip}:${CP_PORT}${aptBase}/${s.name} ${suite} ${s.components.join(' ')}`,
          ),
        )
        .join('\n') + '\n',
    );
    await vm2.copyIn(join(local, 'lw-lab.list'), '/tmp/lw-lab.list', '0644');
    await vm2.exec(`mkdir -p /tmp/lw-lab-lists/partial && ${apt} update -q >/dev/null`, { timeoutMs: 600_000 });

    const moved = await vm2.exec(
      `for p in tzdata distro-info-data base-files ca-certificates libc-bin openssl curl; do
         installed=$(dpkg-query -W -f='\${Version}' "$p" 2>/dev/null || true)
         [ -n "$installed" ] || continue
         older=$(${cache} madison "$p" 2>/dev/null | awk -F'|' '{gsub(/ /,"",$2); print $2}' | while read -r v; do dpkg --compare-versions "$v" lt "$installed" && echo "$v" && break; done || true)
         if [ -n "$older" ]; then echo "$p $installed $older"; break; fi
       done`,
      { timeoutMs: 120_000 },
    );
    const [pkg, newest, older] = moved.trim().split(/\s+/);

    expect(pkg).toBeTruthy();
    await vm2.exec(
      `DEBIAN_FRONTEND=noninteractive ${apt} -y -q --allow-downgrades install "${pkg}=${older}" >/dev/null`,
      { timeoutMs: 600_000 },
    );
    expect((await vm2.exec(`dpkg-query -W -f='\${Version}' ${pkg}`)).trim()).toBe(older);
    results['packageMovedBack'] = { pkg, from: newest, to: older };

    // The kernel packages are held in the lab's golden image (a lab artifact; nodes don't hold them).
    await vm2.exec('apt-mark unhold $(apt-mark showhold) >/dev/null 2>&1 || true');

    // Drain: the controller moves the node's workloads away first (here: the one container stops).
    await vm2.exec('docker stop lab-app >/dev/null');

    const manifest = release(
      '3.5.0',
      await publish('agent-3.5.0', wrapper('3.5.0'), 'artifacts/bin/loadweaver-agent-linux-amd64'),
    );
    const host = { id: randomUUID(), snapshot, aptBase, sources, upgrade: true };
    const target = components(manifest, { host });
    const started = Date.now();

    await agent('POST', '/apply', { components: target, role: ROLE, address: vm2.ip });
    await agent('POST', '/after-apply', { components: target });

    const done = await eventually(
      'host update done',
      async () => {
        const action = (await report()).actions?.find((a) => a.id === host.id);

        if (action?.phase === 'failed') throw new Error(`host update failed: ${action.error}`);

        return action?.phase === 'done' ? action : undefined;
      },
      20 * 60_000,
      5_000,
    );

    results['hostUpdateMs'] = Date.now() - started;
    expect(done.kind).toBe('host');
    expect((await vm2.exec(`dpkg-query -W -f='\${Version}' ${pkg}`)).trim()).toBe(newest);
    // Installed from the cluster only: vm1 served the indexes and the package.
    expect(await vm2.exec('cat /var/lib/loadweaver/apt/sources.list')).toContain(
      `http://${vm1.ip}:${CP_PORT}${aptBase}/debian-trixie trixie main`,
    );
    expect(await vm1.exec(`journalctl -u lw-cluster-2 --no-pager | grep -c '${pkg}_' || true`)).not.toBe('0\n');

    // As the agent does after any restart (its applied state is re-applied first; run alone, (c) also swaps the agent).
    await eventually(
      'agent answers',
      async () => ((await version().catch(() => null)) ? true : undefined),
      120_000,
      2_000,
    );
    await agent('POST', '/apply', { components: target, role: ROLE, address: vm2.ip });

    const afterUpdate = await report();

    expect(afterUpdate.snapshot).toBe(snapshot);
    expect(afterUpdate.packages).toMatchObject({ 'drbd-utils': '9.22.0-1.1', criu: '4.1.1-1' });

    // No newer kernel in the snapshot for this image: the reboot request comes from the flag file (stand-in, see above).
    if (!afterUpdate.rebootRequired) await vm2.exec('touch /run/reboot-required');

    await eventually(
      'reboot required reported',
      async () => ((await report()).rebootRequired ? true : undefined),
      120_000,
      5_000,
    );

    // The controller sends the reboot token; the agent reboots once, comes back on its own and rejoins.
    const boot = await bootId();
    const rebootStarted = Date.now();
    const rebooting = components(manifest, { host: { ...host, reboot: randomUUID() } });

    await agent('POST', '/after-apply', { components: rebooting }, true);
    await eventually(
      'new boot id',
      async () => {
        const id = await bootId().catch(() => null);

        return id && id !== boot ? id : undefined;
      },
      300_000,
      3_000,
    );
    await eventually(
      'agent back after the reboot',
      async () => ((await version().catch(() => null))?.version === '3.5.0' ? true : undefined),
      120_000,
      2_000,
    );
    await agent('POST', '/apply', { components: rebooting, role: ROLE, address: vm2.ip });
    results['rebootRejoinMs'] = Date.now() - rebootStarted;

    // The same token never reboots twice.
    await agent('POST', '/after-apply', { components: rebooting });
    await sleep(5_000);
    expect(await bootId()).not.toBe(boot);

    const rejoined = await report();

    expect(rejoined.bootId).not.toBe(afterUpdate.bootId);
    expect(rejoined.rebootRequired).toBe(false);
    expect(await vm2.exec('modprobe drbd && grep -o "^version: [0-9.]*" /proc/drbd')).toContain('version: 9.2.20');
    expect(rejoined.drbd).toBe('9.2.20');

    // Uncordon: work comes back.
    await vm2.exec('docker start lab-app >/dev/null');
    expect(await app()).toMatch(/ true$/);
  });
});

/**
 * (d) A real kernel-ABI change (M6 gate): the VMs come from the `older-kernel` golden image (Debian 13 cloud kernel
 * 6.12.107, DRBD 9.2.20 built for it), the frozen snapshot carries a newer cloud kernel (trixie-security). vm2 holds a
 * replicated volume with vm3 (protocol C). The rolling host path on vm2: drain (vm3 takes over the volume and keeps
 * writing) → OS update from the cluster's apt snapshot (new kernel + headers, the DRBD module rebuilt from the
 * release's verified source for the next boot's kernel, GRUB's default entry on it) → reboot on the token → rejoin
 * (new kernel running, DRBD 9.2.20 loads, the replica resyncs what vm3 wrote) → failback: both writes intact on vm2.
 * Air-gapped DRBD build: vm1 plays the bundle build (network allowed) and pre-generates DRBD's compat patch for the
 * snapshot's cloud kernel with the release pipeline's `drbd-compat.sh`; source + patch come from the cluster. During
 * the host update vm2 reaches only vm1 and vm3 (nftables; SPAAS unreachable is asserted): a release without a patch for
 * the new kernel is refused before anything changes, the real one builds offline (log: cache hit, no SPAAS).
 */
describe('kernel-ABI change on real VMs (VM lab)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let vm3: Vm;
  // Created by beforeAll (a describe filtered out with -t never runs afterAll, which removes it).
  let local = '';
  const results: Record<string, unknown> = {};
  const DRIVER = '/opt/loadweaver/volume-driver.js';
  const ASSIGNMENTS = '/etc/loadweaver/lab-assignments.json';
  const RESOURCE = 'lw-1100';
  const DOCKER_NAME = 'lw-vol-shop.db.data';

  const agent = async <T>(method: 'GET' | 'POST', path: string, body?: unknown, restarts = false): Promise<T> => {
    const data = body === undefined ? '' : `-H 'content-type: application/json' --data-binary @/tmp/lw-req.json`;

    if (body !== undefined) {
      writeFileSync(join(local, 'req.json'), JSON.stringify(body));
      await vm2.copyIn(join(local, 'req.json'), '/tmp/lw-req.json', '0600');
    }

    const command = `curl -sf --max-time 600 --unix-socket ${SOCKET} -X ${method} ${data} http://lab${path}`;

    if (restarts) {
      const result = await vm2.execResult(command, { timeoutMs: 660_000, allowFailure: true });

      return (result.code === 0 && result.stdout.trim() ? JSON.parse(result.stdout) : {}) as T;
    }

    return JSON.parse(await vm2.exec(command, { timeoutMs: 660_000 })) as T;
  };
  const report = () => agent<ComponentVersions>('GET', '/report');
  const version = () => agent<{ version: string; pid: number }>('GET', '/version');
  const bootId = async () => (await vm2.exec('cat /proc/sys/kernel/random/boot_id')).trim();

  const volume = (primary: Vm): VolumeAssignment => ({
    id: 'shop/db/data',
    dockerName: DOCKER_NAME,
    minor: 1100,
    port: 7900,
    sizeBytes: 256 * 1024 ** 2,
    replicas: [
      { node: 'n2', nodeId: 0, address: vm2.ip, host: 'vm2' },
      { node: 'n3', nodeId: 1, address: vm3.ip, host: 'vm3' },
    ],
    connections: [{ a: 'n2', b: 'n3', protocol: 'C' }],
    primary: primary === vm2 ? 'n2' : 'n3',
    keyRef: 'secret://shop/lw-volume-db.data',
  });
  /** The agent's volume manager on `vm` with the control plane's view "primary is `primary`". */
  const driver = async (vm: Vm, mode: 'apply' | 'mount' | 'unmount', primary: Vm) => {
    const out = await vm.exec(
      `cat > ${ASSIGNMENTS} <<'EOF'\n${JSON.stringify([volume(primary)])}\nEOF\nnode ${DRIVER} ${mode} ${vm.name.replace('vm', 'n')} ${ASSIGNMENTS} ${DOCKER_NAME}`,
      { timeoutMs: 300_000 },
    );
    const lines = out.trim().split('\n');

    return JSON.parse(lines[lines.length - 1] ?? '') as { changed: boolean; mountpoint?: string };
  };
  /** Both replicas connected and UpToDate as seen from `vm`. */
  const inSync = (vm: Vm, peer: Vm, timeoutMs = 300_000) =>
    syncedOrDiagnose(vm, peer, timeoutMs).catch(async (error: unknown) => {
      for (const v of [vm, peer])
        process.stderr.write(
          `[vm-lab] ${v.name} DRBD diagnostics:\n${
            (
              await v.execResult(
                `drbdsetup status ${RESOURCE} --verbose --statistics 2>&1; cat /etc/drbd.d/${RESOURCE}.res 2>&1; lvs 2>&1; dmesg | grep -iE 'drbd|${RESOURCE}' | tail -n 80`,
                { allowFailure: true, timeoutMs: 30_000 },
              )
            ).stdout
          }\n`,
        );

      throw error;
    });
  const syncedOrDiagnose = (vm: Vm, peer: Vm, timeoutMs: number) =>
    eventually(
      `${vm.name} ${RESOURCE} UpToDate with ${peer.name}`,
      async () => {
        const [s] = JSON.parse(await vm.exec(`drbdsetup status ${RESOURCE} --json`, { timeoutMs: 30_000 })) as {
          devices: { 'disk-state': string }[];
          connections: { name: string; 'connection-state': string; peer_devices: { 'peer-disk-state': string }[] }[];
        }[];
        const c = s?.connections.find((x) => x.name === peer.name);

        return s?.devices[0]?.['disk-state'] === 'UpToDate' &&
          c?.['connection-state'] === 'Connected' &&
          c.peer_devices[0]?.['peer-disk-state'] === 'UpToDate'
          ? true
          : undefined;
      },
      timeoutMs,
      2_000,
    );
  const writeFile = async (vm: Vm, mountpoint: string, name: string) =>
    (
      await vm.exec(
        `dd if=/dev/urandom of=${mountpoint}/${name} bs=1M count=16 status=none && sync && sha256sum ${mountpoint}/${name} | cut -d' ' -f1`,
      )
    ).trim();
  const sha = async (vm: Vm, path: string) => (await vm.exec(`sha256sum ${path} | cut -d' ' -f1`)).trim();
  const diagnostics = async () =>
    (
      await vm2.execResult(
        "journalctl --no-pager -n 60 -u 'loadweaver-host-update-*' -u loadweaver-agent 2>&1 | tail -n 60; ls /lib/modules; ls /var/lib/loadweaver/updates",
        { allowFailure: true, timeoutMs: 30_000 },
      )
    ).stdout;

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), 'lw-vmlab-kernel-'));
    lab = await startVmLab({
      golden: 'older-kernel',
      vms: [
        { name: 'vm1', site: 'a', memoryMb: 1024 },
        { name: 'vm2', site: 'a', memoryMb: 1536, cpus: 2, dataDiskGb: 4 },
        { name: 'vm3', site: 'a', memoryMb: 1024, dataDiskGb: 4 },
      ],
      log: (line) => process.stderr.write(`[vm-lab] ${line}\n`),
    });
    ({ vm1, vm2, vm3 } = lab.vms as Record<'vm1' | 'vm2' | 'vm3', Vm>);

    await vm1.exec('mkdir -p /opt/loadweaver /srv/lw');
    await vm1.copyIn(APT_SOURCE_BUNDLE, '/opt/loadweaver/apt-source.js', '0644');
    await Promise.all(
      [vm2, vm3].map(async (vm) => {
        await vm.exec('mkdir -p /opt/loadweaver');
        await vm.copyIn(VOLUME_DRIVER_BUNDLE, DRIVER);
        await vm.exec(
          [
            `pvcreate -q ${vm.dataDisk} && vgcreate -q loadweaver ${vm.dataDisk}`,
            'lvcreate -q -l 90%FREE -T loadweaver/pool',
            'install -d -m 0700 /etc/loadweaver',
            "printf '%s' lab-volume-key-0123456789abcdef > /etc/loadweaver/lab-volume.key",
            'chmod 0600 /etc/loadweaver/lab-volume.key',
            'modprobe drbd',
          ].join('\n'),
        );
      }),
    );

    // vm2: the agent (already on the release, so the update is the host path only) as a systemd service.
    writeFileSync(join(local, 'release-dev.pem'), KEY.publicKeyPem);
    writeFileSync(join(local, 'agent'), wrapper('3.5.0'));
    writeFileSync(
      join(local, 'identity.json'),
      JSON.stringify({
        clusterId: 'lab',
        nodeName: 'n2',
        controlPlaneUrl: `http://${vm1.ip}:${CP_PORT}`,
        controlPlaneEndpoints: [],
      }),
    );
    writeFileSync(
      join(local, 'loadweaver-agent.service'),
      '[Unit]\nDescription=Loadweaver node agent (VM lab)\nAfter=network-online.target docker.service\n[Service]\nExecStart=/usr/local/bin/loadweaver-agent\nRestart=always\nRestartSec=1\n[Install]\nWantedBy=multi-user.target\n',
    );
    await vm2.exec('mkdir -p /etc/loadweaver /var/lib/loadweaver && chmod 700 /var/lib/loadweaver');
    await vm2.copyIn(UPDATES_AGENT_BUNDLE, '/opt/loadweaver/updates-agent.js', '0644');
    await vm2.copyIn(join(local, 'release-dev.pem'), '/etc/loadweaver/release-dev.pem', '0644');
    await vm2.copyIn(join(local, 'agent'), '/usr/local/bin/loadweaver-agent', '0755');
    await vm2.copyIn(join(local, 'identity.json'), '/var/lib/loadweaver/identity.json', '0600');
    await vm2.copyIn(join(local, 'loadweaver-agent.service'), '/etc/systemd/system/loadweaver-agent.service', '0644');
    await vm2.exec('systemctl daemon-reload && systemctl enable --now loadweaver-agent');
    await eventually('agent up', async () => ((await version()).version === '3.5.0' ? true : undefined), 60_000);
  }, 3_600_000);

  afterAll(async () => {
    await lab?.stop();
    if (local) rmSync(local, { recursive: true, force: true });
    process.stderr.write(`[vm-lab] kernel update results: ${JSON.stringify(results, null, 1)}\n`);
  });

  it('(d) updates to a newer kernel: DRBD rebuilt for it, GRUB default, reboot, rejoin, replica resynced', async () => {
    const before = (await vm2.exec('uname -r')).trim();

    expect(before).toBe(OLDER_KERNEL_IMAGE.kernel);
    expect(await vm2.exec('grep -o "^version: [0-9.]*" /proc/drbd')).toContain('version: 9.2.20');

    // A replicated volume, primary on vm2, with data.
    await Promise.all([driver(vm3, 'apply', vm2), driver(vm2, 'apply', vm2)]);
    await eventually(
      'replicas connected',
      async () => {
        const [s] = JSON.parse(await vm2.exec(`drbdsetup status ${RESOURCE} --json`, { timeoutMs: 30_000 })) as {
          connections: { name: string; 'connection-state': string }[];
        }[];

        return s?.connections.find((c) => c.name === 'vm3')?.['connection-state'] === 'Connected' ? true : undefined;
      },
      120_000,
      2_000,
    );

    const first = await driver(vm2, 'mount', vm2);

    await inSync(vm2, vm3);

    const shaA = await writeFile(vm2, String(first.mountpoint), 'a.bin');

    // Drain: the workload (and the volume's primary) moves to vm3, which keeps writing while vm2 updates.
    await driver(vm2, 'unmount', vm2);

    const moved = await driver(vm3, 'mount', vm3);

    // The cluster's snapshot (frozen indexes) and its apt / artifact routes on vm1.
    writeFileSync(join(local, 'upstreams.json'), JSON.stringify(UPSTREAMS));
    await vm1.copyIn(join(local, 'upstreams.json'), '/tmp/upstreams.json', '0644');

    const snapshotStart = Date.now();
    const snapshot = (
      await vm1.exec('node /opt/loadweaver/apt-source.js snapshot /srv/lw /tmp/upstreams.json', { timeoutMs: 600_000 })
    ).trim();

    results['aptSnapshotMs'] = Date.now() - snapshotStart;
    await vm1.exec(
      `systemd-run --unit=lw-cluster --collect node /opt/loadweaver/apt-source.js serve /srv/lw ${CP_PORT}`,
    );

    const agentFile = await (async () => {
      const content = wrapper('3.5.0');

      writeFileSync(join(local, 'agent-3.5.0'), content);
      await vm1.copyIn(join(local, 'agent-3.5.0'), '/tmp/agent-3.5.0', '0644');

      const sha256 = (await vm1.exec('node /opt/loadweaver/apt-source.js put /srv/lw /tmp/agent-3.5.0')).trim();

      return { path: 'artifacts/bin/loadweaver-agent-linux-amd64', sha256, size: Buffer.byteLength(content) };
    })();

    // Bundle build (vm1, network allowed, as in the release job): the DRBD source and its compat patch for the cloud
    // kernel the snapshot installs, generated by the pipeline's script; both into the cluster's artifact store and the
    // signed manifest. The node then builds DRBD offline (air-gapped, SPAAS disabled).
    const bundleStart = Date.now();
    const putFile = async (remote: string, path: string): Promise<ArtifactFile> => ({
      path,
      sha256: (await vm1.exec(`node /opt/loadweaver/apt-source.js put /srv/lw ${remote}`)).trim(),
      size: Number((await vm1.exec(`stat -c %s ${remote}`)).trim()),
    });
    const nextKernel = (
      await vm1.exec(
        "apt-get update -q >/dev/null && apt-cache depends linux-image-cloud-amd64 | sed -n 's/^ *Depends: linux-image-\\([0-9][^ ]*\\)$/\\1/p' | head -1",
        { timeoutMs: 300_000 },
      )
    ).trim();

    expect(nextKernel).toMatch(/^6\.12\.\d+\+deb13-cloud-amd64$/);
    expect(nextKernel).not.toBe(OLDER_KERNEL_IMAGE.kernel);
    await vm1.copyIn(DRBD_COMPAT_SCRIPT, '/opt/loadweaver/drbd-compat.sh', '0755');
    await vm1.exec(
      `curl -fsSL -o /srv/drbd.tar.gz ${DRBD_PIN.url} && /opt/loadweaver/drbd-compat.sh /srv/drbd.tar.gz ${DRBD_PIN.sha256} /srv/drbd-compat ${nextKernel}`,
      { timeoutMs: 1_200_000 },
    );
    await vm1.copyOut(`/srv/drbd-compat/${nextKernel}.tar.gz`, join(local, 'compat.tar.gz'));

    const compatEntry = await inspectDrbdCompatEntry(readFileSync(join(local, 'compat.tar.gz')), nextKernel);
    const drbdSource = await putFile('/srv/drbd.tar.gz', 'artifacts/drbd/drbd-9.2.20.tar.gz');
    const compatFile = await putFile(
      `/srv/drbd-compat/${nextKernel}.tar.gz`,
      `artifacts/drbd/compat/${nextKernel}-amd64-${compatEntry.md5}.tar.gz`,
    );

    results['bundleBuild'] = { ms: Date.now() - bundleStart, nextKernel, ...compatEntry };

    const manifestWith = (compatKernel: string) =>
      buildManifest({
        version: '3.5.0',
        channel: 'stable',
        created: new Date().toISOString(),
        images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@sha256:${'c'.repeat(64)}` },
        agentBinaries: { amd64: agentFile },
        drbdSource,
        drbdCompat: [{ kernel: compatKernel, arch: 'amd64', file: compatFile, md5: compatEntry.md5 }],
      });
    const manifest = manifestWith(nextKernel);
    const components = (extra: Partial<NodeComponents>, m = manifest): NodeComponents => {
      const bytes = canonicalJson(m);

      return {
        release: manifest.version,
        manifest: bytes,
        signature: JSON.stringify(signManifest(Buffer.from(bytes), KEY.privateKeyPem)),
        artifactBase: '/api/updates/artifacts',
        ...extra,
      };
    };
    const sources = UPSTREAMS.map((u) => ({
      name: u.name,
      suites: u.suites,
      components: u.components,
      keyring: u.keyring,
    }));
    const host = { id: randomUUID(), snapshot, aptBase: `/api/updates/apt/${snapshot}`, sources, upgrade: true };

    // The lab's golden image holds its kernel packages (a lab artifact; nodes don't hold them).
    await vm2.exec('apt-mark unhold $(apt-mark showhold) >/dev/null 2>&1 || true');

    // From here vm2 reaches only the cluster (vm1) and its DRBD peer (vm3): no internet, no SPAAS (air-gapped node).
    await vm2.exec(
      `nft -f - <<'EOF'\ntable inet lw_airgap {\n  chain out {\n    type filter hook output priority 0; policy drop;\n    oif "lo" accept\n    ct state established,related accept\n    ip daddr { ${vm1.ip}, ${vm3.ip} } accept\n  }\n}\nEOF`,
    );
    expect(
      (
        await vm2.execResult('curl -fsS -m 5 https://spaas.drbd.io/api/v1/hello', {
          allowFailure: true,
          timeoutMs: 30_000,
        })
      ).code,
    ).not.toBe(0);

    // A release without a compat patch for the kernel the upgrade brings: refused before anything changes.
    const modulesBefore = (await vm2.exec('ls /lib/modules')).trim();
    const uncovered = { ...host, id: randomUUID() };
    const refused = components({ host: uncovered }, manifestWith(OLDER_KERNEL_IMAGE.kernel));

    await agent('POST', '/apply', { components: refused, role: ROLE, address: vm2.ip });
    await agent('POST', '/after-apply', { components: refused });

    const refusal = await eventually(
      'host update refused',
      async () => {
        const action = (await report()).actions?.find((a) => a.id === uncovered.id);

        if (action?.phase === 'done') throw new FatalError('host update without a compat patch for the kernel passed');

        return action?.phase === 'failed' ? action : undefined;
      },
      10 * 60_000,
      5_000,
    );

    expect(refusal.error).toContain(
      `the release ships neither a prebuilt module nor a compat patch for kernel ${nextKernel}`,
    );
    expect(refusal.error).toContain('nothing was changed');
    expect((await vm2.exec('ls /lib/modules')).trim()).toBe(modulesBefore);

    const started = Date.now();
    const target = components({ host });

    await agent('POST', '/apply', { components: target, role: ROLE, address: vm2.ip });
    await agent('POST', '/after-apply', { components: target });

    // vm3 keeps writing while vm2 updates (the resync after the rejoin has work to do).
    const shaB = await writeFile(vm3, String(moved.mountpoint), 'b.bin');

    try {
      await eventually(
        'host update done',
        async () => {
          const action = (await report()).actions?.find((a) => a.id === host.id);

          if (action?.phase === 'failed') throw new FatalError(`host update failed: ${action.error}`);

          return action?.phase === 'done' ? action : undefined;
        },
        30 * 60_000,
        5_000,
      );
    } catch (error) {
      process.stderr.write(`[vm-lab] vm2 diagnostics:\n${await diagnostics()}\n`);
      process.stderr.write(
        `[vm-lab] vm1 apt source:\n${(await vm1.execResult("journalctl -u lw-cluster --no-pager | grep -v ' 200$' | tail -n 40", { allowFailure: true, timeoutMs: 30_000 })).stdout}\n`,
      );
      throw error;
    }

    results['hostUpdateMs'] = Date.now() - started;

    // The next boot's kernel: newer than the running one, with DRBD 9.2.20 built for exactly it and GRUB's default.
    const next = (await vm2.exec('ls /lib/modules | sort -V | tail -1')).trim();

    expect(next).not.toBe(before);
    expect(next).toBe(nextKernel);
    expect((await vm2.exec(`modinfo -k ${next} -F version drbd`)).trim()).toBe('9.2.20');
    expect((await vm2.exec(`modinfo -k ${next} -F vermagic drbd`)).trim().split(' ')[0]).toBe(next);
    // Built offline from the release's compat patch: DRBD took it from its cache, never tried SPAAS.
    const buildLog = await vm2.exec(`cat /var/log/loadweaver-drbd-build-${next}.log`);

    results['drbdBuild'] = buildLog.split('\n').filter((l) => /SPAAS|spatch|cocci_cache|compat\.patch/.test(l));
    expect(buildLog).not.toMatch(/SPAAS|spatch-as-a-service/);
    expect(buildLog).toContain(`cocci_cache/${compatEntry.md5}/compat.patch`);
    await vm2.exec('nft delete table inet lw_airgap');

    const grubDefault = (
      await vm2.exec(
        "grep -E '^GRUB_DEFAULT=' /etc/default/grub || true; grub-editenv list 2>/dev/null || true; awk '$1 == \"linux\" { print $2; exit }' /boot/grub/grub.cfg",
      )
    ).trim();

    results['kernel'] = { before, next, grubDefault: grubDefault.split('\n') };
    expect(grubDefault.split('\n').pop()).toBe(`/boot/vmlinuz-${next}`);

    const updated = await eventually(
      'reboot required reported',
      async () => {
        const r = await report();

        return r.rebootRequired ? r : undefined;
      },
      120_000,
      5_000,
    );

    // The controller's reboot token: one reboot into the new kernel, the agent comes back by itself.
    const boot = await bootId();
    const rebootStarted = Date.now();

    await agent('POST', '/after-apply', { components: components({ host: { ...host, reboot: randomUUID() } }) }, true);
    await eventually(
      'new boot id',
      async () => {
        const id = await bootId().catch(() => null);

        return id && id !== boot ? id : undefined;
      },
      300_000,
      3_000,
    );
    await eventually(
      'agent back after the reboot',
      async () => ((await version().catch(() => null))?.version === '3.5.0' ? true : undefined),
      120_000,
      2_000,
    );
    results['rebootMs'] = Date.now() - rebootStarted;
    expect((await vm2.exec('uname -r')).trim()).toBe(next);
    expect(await vm2.exec('modprobe drbd && grep -o "^version: [0-9.]*" /proc/drbd')).toContain('version: 9.2.20');

    const rejoined = await eventually(
      'report after the reboot',
      async () => {
        const r = await report();

        return r.bootId !== updated.bootId && r.drbd ? r : undefined;
      },
      120_000,
      3_000,
    );

    expect(rejoined.rebootRequired).toBe(false);
    expect(rejoined.drbd).toBe('9.2.20');

    // Rejoin: the agent's volume manager brings the replica back; it resyncs what vm3 wrote meanwhile.
    const resyncStarted = Date.now();

    await driver(vm2, 'apply', vm3);
    await inSync(vm2, vm3);
    results['rejoinResyncMs'] = Date.now() - resyncStarted;

    // Failback: vm2 is primary again and has both writes.
    await driver(vm3, 'unmount', vm3);

    const back = await driver(vm2, 'mount', vm2);

    expect(await sha(vm2, `${back.mountpoint}/a.bin`)).toBe(shaA);
    expect(await sha(vm2, `${back.mountpoint}/b.bin`)).toBe(shaB);
    await driver(vm2, 'unmount', vm2);
  }, 3_600_000);
});
