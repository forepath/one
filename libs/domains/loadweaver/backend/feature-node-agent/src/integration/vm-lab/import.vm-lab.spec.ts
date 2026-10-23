import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  discoveryReportSchema,
  ingressSchema,
  volumeAssignmentSchema,
  volumeDockerName,
  workloadSpecSchema,
  type DiscoveryReport,
  type ImportAction,
  type ImportProgress,
  type VolumeAssignment,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { buildJoinPlan, classifyFormer, type ImportClusterContext } from '@forepath/loadweaver/shared/util-import';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import { IMPORT_AGENT_BUNDLE } from './vm-lab.global-setup';
import { startVmLab, type Vm, type VmLab } from './vm-lab';

/**
 * Import of an existing Docker host and rejoin of a former node on real kernels (M6 step 4, 3.21).
 *
 * Why the VM lab (not Docker-in-Docker): the import copies data into a replicated volume (LVM thin → LUKS2 → DRBD 9)
 * and hands port 80 from the host's own nginx to the Loadweaver ingress — DRBD needs a real kernel module, and the
 * component step installs packages and reloads Docker on a real Debian host. One VM (2 GiB) covers the import; a
 * second (1.5 GiB) the former-node rejoin with DRBD; together ~5 GiB with QEMU overhead, inside the 7 GiB guard.
 *
 * (a) vm1 runs a compose project (nginx on :80 with a named volume, compose labels, `.env` with a secret) the way
 *     `docker compose up` leaves it. `discover` (the agent command) changes nothing on the host — containers,
 *     volumes, networks, nftables, interfaces, routes, files, units and packages are compared before / after — and
 *     reports the project (secrets redacted), the listener and the volume. The control plane's plan builder turns it
 *     into the join plan; the test plays the control plane and runs the steps through the real agent classes:
 *     components (idempotent; installs only what is missing — rsync — and reloads Docker without stopping nginx),
 *     activation (pod network, the replicated volume), rsync pre-copy while nginx serves, stop (restart policy off),
 *     final pass, release (the imported nginx on the volume) with the ingress taking port 80, handover. The site
 *     answers through the ingress with the copied data (checksums, owners, links equal).
 * (b) vm2 held a replica of a volume of cluster `lab` with vm1 and "left" (agent gone, resource down) while vm1 kept
 *     writing; it joins again: discovery finds the former installation (cluster id, `lw-<minor>`, backing LV), the
 *     classifier marks the replica reusable, and the same assignment brings it back without a new LUKS header or
 *     DRBD metadata — only the difference is resynced (bytes received ≪ volume size), `drbdadm verify` is clean.
 */

const NGINX =
  'docker.io/library/nginx:1.29.3-alpine@sha256:b3c656d55d7ad751196f21b7fd2e8d4da9cb430e32f646adcf92441b72f82b14';
const ENVOY = COMPONENT_IMAGES['envoy'];
const AGENT = '/opt/loadweaver/import-agent.js';
const SOCKET = '/run/lw-import-lab.sock';
const POD_SUBNET = '10.244.1.0/24';
const POD_ADDRESS = '10.244.1.10';
const HOST = 'shop.example.com';
const byDigest = (image: string) => image.replace(/:[^/@]+@/, '@');
/**
 * The join plan's component script exactly as the control plane sends it (`buildComponentsScript`); kept in sync by
 * the control plane's unit test (the lab can't import the control-plane library).
 */
const COMPONENTS_SCRIPT = join(__dirname, 'components.generated.sh');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventually<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 120_000, stepMs = 1_000) {
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

/** Everything discovery could possibly change, as one text to compare before / after. */
const SNAPSHOT = [
  "docker ps -a --no-trunc --format '{{.ID}} {{.Names}} {{.Image}} {{.Status}} {{.Ports}}' | sed -E 's/Up [^,]*/Up/'",
  "docker inspect --format '{{.Id}} {{.State.Running}} {{.HostConfig.RestartPolicy.Name}} {{json .Mounts}} {{json .Config.Labels}}' $(docker ps -aq)",
  "docker volume ls --format '{{.Name}} {{.Driver}}'",
  "docker network ls --format '{{.Name}} {{.Driver}}'",
  // Stateless: packet counters move with any traffic (the lab's own ssh).
  'nft -s list ruleset',
  'ip -br addr | sort',
  'ip route show table all | sort',
  'ip -6 route show table all | sort',
  'ls -la /var/lib/loadweaver /etc/drbd.d /run/docker/plugins 2>&1 || true',
  'lvs --noheadings -o lv_name 2>/dev/null | sort || true',
  'systemctl list-units --type=service --state=running --no-legend --plain | awk "{print \\$1}" | sort',
  'dpkg-query -W | md5sum',
  'sha256sum /etc/docker/daemon.json /etc/sysctl.d/* 2>/dev/null | sort',
  "find /etc /srv /var/lib/docker/volumes -newer /root/lw-marker -not -path '/etc/machine-id' 2>/dev/null | sort",
].join('\necho ---\n');

/** The data in the volume: path, owner, mode, type and checksum per entry (links included). */
const TREE = (dir: string) =>
  `cd ${dir} && find . -mindepth 1 -printf '%p %U:%G %m %y %l\\n' | sort && find . -type f -exec sha256sum {} + | sort -k2`;

describe('import of an existing Docker host and a former node (VM lab)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let local: string;
  const results: Record<string, unknown> = {};

  const api = async <T>(
    vm: Vm,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 120_000,
  ): Promise<T> => {
    const out = await vm.exec(
      body === undefined
        ? `curl -sf --unix-socket ${SOCKET} -X ${method} http://lab${path}`
        : `curl -sS --max-time ${Math.ceil(timeoutMs / 1000)} --unix-socket ${SOCKET} -X ${method} -H 'Content-Type: application/json' --data-binary @- http://lab${path} <<'LWEOF'\n${JSON.stringify(body)}\nLWEOF`,
      { timeoutMs: timeoutMs + 10_000 },
    );
    const parsed = JSON.parse(out) as T & { error?: string };

    if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) throw new Error(parsed.error);

    return parsed;
  };

  const IMPORT = randomUUID();
  const step = (vm: Vm, id: string, action: ImportAction, timeoutMs = 120_000) =>
    api<ImportProgress>(vm, 'POST', '/step', { import: IMPORT, step: id, action }, timeoutMs);

  const startAgent = async (vm: Vm) => {
    await vm.exec(
      `systemctl is-active -q lw-import || { systemctl reset-failed lw-import 2>/dev/null || true; systemd-run --unit lw-import -E LOADWEAVER_STATE_DIR=/var/lib/loadweaver node ${AGENT} serve; }`,
    );
    await eventually(`${vm.name} agent`, async () =>
      (await vm.exec(`test -S ${SOCKET} && echo ok || true`)).includes('ok') ? true : undefined,
    );
  };

  /** The host as a member of cluster `lab` (what activation leaves): identity, the lab's volume key, a thin pool. */
  const prepareMember = async (vm: Vm) =>
    await vm.exec(
      [
        'test -f /var/lib/loadweaver/identity.json && exit 0',
        'install -d -m 0700 /var/lib/loadweaver /etc/loadweaver',
        `echo '${JSON.stringify({ clusterId: 'lab', nodeName: vm.name, controlPlaneUrl: 'https://cp.lab', controlPlaneEndpoints: [] })}' > /var/lib/loadweaver/identity.json`,
        "printf '%s' lab-volume-key-0123456789abcdef > /etc/loadweaver/lab-volume.key",
        'chmod 0600 /etc/loadweaver/lab-volume.key',
        `pvcreate -q ${vm.dataDisk} && vgcreate -q loadweaver ${vm.dataDisk}`,
        'lvcreate -q -l 90%FREE -T loadweaver/pool',
      ].join('\n'),
    );

  const discover = async (vm: Vm): Promise<DiscoveryReport> =>
    discoveryReportSchema.parse(
      JSON.parse(await vm.exec(`LOADWEAVER_STATE_DIR=/var/lib/loadweaver node ${AGENT} discover`)),
    );

  const cluster = (node: string, volumes: ImportClusterContext['volumes'] = []): ImportClusterContext => ({
    clusterId: 'lab',
    node,
    network: { podPoolV4: '10.244.0.0/16', servicePoolV4: '10.96.0.0/16', overlayPoolV4: '10.255.0.0/16' },
    nodeSubnets: [POD_SUBNET],
    projects: ['shop'],
    deployments: [],
    forwardedPorts: {},
    hostnames: {},
    volumes,
  });

  beforeAll(async () => {
    lab = await startVmLab({
      vms: [
        { name: 'vm1', site: 'a', memoryMb: 2048, dataDiskGb: 4 },
        { name: 'vm2', site: 'a', memoryMb: 1536, dataDiskGb: 4 },
      ],
      log: (line) => process.stderr.write(`[vm-lab] ${line}\n`),
    });
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
    local = await mkdtemp(join(tmpdir(), 'lw-import-lab-'));

    const started = Date.now();

    // Images from the local Docker (pulled by digest once): nginx for the host's project, Envoy for the ingress.
    for (const [name, image] of [
      ['nginx', NGINX],
      ['envoy', ENVOY],
    ]) {
      execFileSync('docker', ['pull', '-q', byDigest(image)], { stdio: 'ignore', timeout: 300_000 });
      execFileSync('docker', ['save', '-o', join(local, `${name}.tar`), byDigest(image)], { timeout: 300_000 });
      await vm1.copyIn(join(local, `${name}.tar`), `/var/tmp/${name}.tar`);
      await vm1.exec(`docker load -q -i /var/tmp/${name}.tar && rm -f /var/tmp/${name}.tar`, { timeoutMs: 300_000 });
    }

    results['imagesMs'] = Date.now() - started;

    for (const vm of [vm1, vm2]) await vm.copyIn(IMPORT_AGENT_BUNDLE, AGENT);
  });

  afterAll(async () => {
    await lab?.stop();

    if (local) await rm(local, { recursive: true, force: true });

    process.stderr.write(`[vm-lab] import results: ${JSON.stringify(results, null, 1)}\n`);
  });

  it('(a) discovers read-only, then imports the compose project: data copied, port 80 handed to the ingress', async () => {
    // The host as `docker compose up` leaves it (compose labels on project, volume and network).
    await vm1.exec(
      [
        'install -d /srv/shop',
        `cat > /srv/shop/compose.yaml <<'EOF'\nname: shop\nservices:\n  web:\n    image: ${NGINX}\n    restart: unless-stopped\n    ports: ["80:80"]\n    volumes: ["html:/usr/share/nginx/html"]\n    environment:\n      GREETING: \${GREETING}\n      ADMIN_TOKEN: inline-secret-value\nvolumes:\n  html: {}\nEOF`,
        "printf 'GREETING=hello\\nDB_PASSWORD=env-secret-value\\n' > /srv/shop/.env",
        'L="--label com.docker.compose.project=shop"',
        'docker network create $L --label com.docker.compose.network=default shop_default >/dev/null',
        'docker volume create $L --label com.docker.compose.volume=html shop_html >/dev/null',
        // Data with an owner, a hard link, a symlink and a subdirectory.
        `docker run --rm -v shop_html:/d ${NGINX} sh -c 'echo "<h1>imported shop</h1>" > /d/index.html && mkdir -p /d/assets && head -c 3000000 /dev/urandom > /d/assets/big.bin && ln /d/assets/big.bin /d/assets/hard.bin && ln -s index.html /d/link.html && chown -R 101:101 /d/assets'`,
        `docker run -d --name shop-web-1 --restart unless-stopped --network shop_default -p 80:80 -v shop_html:/usr/share/nginx/html -e GREETING=hello $L --label com.docker.compose.service=web --label com.docker.compose.container-number=1 --label com.docker.compose.oneoff=False --label com.docker.compose.project.working_dir=/srv/shop --label com.docker.compose.project.config_files=/srv/shop/compose.yaml ${NGINX} >/dev/null`,
      ].join('\n'),
    );
    await eventually('nginx on :80', async () =>
      (await vm1.exec('curl -s http://127.0.0.1/ || true')).includes('imported shop') ? true : undefined,
    );

    const sourceTree = await vm1.exec(TREE('/var/lib/docker/volumes/shop_html/_data'));

    // --- discovery changes nothing ---
    await vm1.exec('touch /root/lw-marker && sleep 1');

    const before = await vm1.exec(SNAPSHOT);
    const t0 = Date.now();
    const report = await discover(vm1);

    results['discoverMs'] = Date.now() - t0;

    const after = await vm1.exec(SNAPSHOT);

    expect(after).toBe(before);
    expect(report.former).toBeNull();
    expect(report.composeProjects).toEqual([
      expect.objectContaining({
        name: 'shop',
        services: ['web'],
        envFile: expect.objectContaining({
          variables: [
            { name: 'GREETING', value: 'hello', sensitive: false },
            { name: 'DB_PASSWORD', sensitive: true },
          ],
        }),
      }),
    ]);
    expect(report.composeProjects[0].configFiles[0].redacted).toEqual([
      { variable: 'ADMIN_TOKEN', path: 'services.web.environment.ADMIN_TOKEN' },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/inline-secret-value|env-secret-value/);
    expect(report.listeners).toEqual(
      expect.arrayContaining([expect.objectContaining({ protocol: 'tcp', port: 80, process: 'docker-proxy' })]),
    );
    expect(report.volumes.find((v) => v.name === 'shop_html')).toMatchObject({
      compose: { project: 'shop', volume: 'html' },
    });
    expect(report.volumes.find((v) => v.name === 'shop_html')?.sizeBytes).toBeGreaterThan(2_500_000);

    // --- the join plan (the control plane's builder) ---
    const plan = buildJoinPlan(
      report,
      {
        items: [
          {
            item: 'compose:shop',
            choice: 'import',
            project: 'shop',
            http: { '80': HOST },
            variables: { ADMIN_TOKEN: 'from-wizard' },
          },
        ],
      },
      cluster('vm1'),
    );

    expect(plan.errors).toEqual([]);
    expect(plan.steps.map((s) => s.id)).toEqual([
      'components',
      'activate',
      'shop/shop/precopy',
      'shop/shop/stop',
      'shop/shop/final-sync',
      'shop/shop/release',
      'shop/shop/verify',
      'handover',
    ]);

    const deployment = plan.deployments[0];
    const copies = deployment.copies.map((c) => ({ source: c.source, volume: volumeDockerName(c.volume) }));

    expect(copies).toEqual([{ source: '/var/lib/docker/volumes/shop_html/_data', volume: 'lw-vol-shop.shop.html' }]);

    // --- components (idempotent: the golden image has everything but rsync; Docker is reloaded, nginx keeps running)
    await prepareMember(vm1);
    await startAgent(vm1);

    const nginxStarted = await vm1.exec("docker inspect -f '{{.State.StartedAt}}' shop-web-1");
    let t = Date.now();
    const script = await readFile(COMPONENTS_SCRIPT, 'utf8');
    const components = await step(vm1, 'components', { kind: 'components', script }, 900_000);

    results['componentsMs'] = Date.now() - t;
    expect(components).toMatchObject({ status: 'done', message: 'loadweaver-components: installed' });
    expect(await vm1.exec('command -v rsync')).toContain('rsync');
    expect((await vm1.exec('jq -r \'."live-restore"\' /etc/docker/daemon.json')).trim()).toBe('true');
    // Never restarted: the source still runs since before.
    expect(await vm1.exec("docker inspect -f '{{.State.StartedAt}}' shop-web-1")).toBe(nginxStarted);
    // Idempotent: a second run installs nothing.
    expect(await step(vm1, 'components-again', { kind: 'components', script }, 300_000)).toMatchObject({
      status: 'done',
    });

    // --- activation: pod network and the replicated volume (single replica on vm1) ---
    const volume: VolumeAssignment = volumeAssignmentSchema.parse({
      id: 'shop/shop/html',
      dockerName: 'lw-vol-shop.shop.html',
      minor: 1000,
      port: 7800,
      sizeBytes: 512 * 1024 ** 2,
      replicas: [{ node: 'vm1', nodeId: 0, address: vm1.ip, host: 'vm1' }],
      connections: [],
      primary: 'vm1',
      keyRef: 'secret://shop/lw-volume-shop.html',
    });
    const network = { bgp: { originate: [POD_SUBNET] } };

    await api(vm1, 'POST', '/apply', { node: 'vm1', network, volumes: [volume], workloads: [] }, 300_000);

    // --- rsync pre-copy while nginx serves, stop, final pass ---
    t = Date.now();
    expect(await step(vm1, 'shop/shop/precopy', { kind: 'precopy', copies }, 600_000)).toMatchObject({
      status: 'done',
    });
    results['precopyMs'] = Date.now() - t;
    expect(await vm1.exec('curl -s http://127.0.0.1/')).toContain('imported shop');

    // Written after the pre-copy: only the final pass brings it over (and deletes what's gone).
    await vm1.exec(
      `docker exec shop-web-1 sh -c 'echo late > /usr/share/nginx/html/late.txt && rm /usr/share/nginx/html/link.html && ln -s index.html /usr/share/nginx/html/link.html'`,
    );

    const finalTree = await vm1.exec(TREE('/var/lib/docker/volumes/shop_html/_data'));
    const stopStarted = Date.now();
    const stopped = await step(vm1, 'shop/shop/stop', { kind: 'stop', containers: deployment.containers }, 120_000);

    expect(stopped).toMatchObject({
      status: 'done',
      restartPolicies: { [deployment.containers[0]]: 'unless-stopped' },
    });
    expect(
      (await vm1.exec("docker inspect -f '{{.State.Running}} {{.HostConfig.RestartPolicy.Name}}' shop-web-1")).trim(),
    ).toBe('false no');
    expect(await step(vm1, 'shop/shop/final-sync', { kind: 'final-sync', copies }, 600_000)).toMatchObject({
      status: 'done',
    });

    // --- release: the imported nginx on the replicated volume, the ingress takes port 80 ---
    const web = workloadSpecSchema.parse({
      id: 'shop/shop/web/0',
      project: 'shop',
      deployment: 'shop',
      service: 'web',
      kind: 'service',
      image: NGINX,
      environment: { GREETING: 'hello', ADMIN_TOKEN: 'from-wizard' },
      labels: {},
      dnsSearch: [],
      runtime: 'runc',
      resources: { cpuMillis: 100, memoryBytes: 64 * 1024 ** 2 },
      restart: 'always',
      stopGracePeriodMs: 2_000,
      init: false,
      readOnly: false,
      privileged: false,
      capAdd: [],
      capDrop: [],
      ulimits: {},
      extraHosts: [],
      volumes: [{ type: 'volume', volume: 'shop/shop/html', target: '/usr/share/nginx/html', readOnly: false }],
      secrets: [],
      addresses: [POD_ADDRESS],
      specHash: '1a2b3c4d5e6f7a8b',
    });
    const ingress = ingressSchema.parse({
      addresses: [vm1.ip],
      sites: [{ host: HOST, routes: [{ prefix: '/', upstream: 'shop/shop/web:80' }] }],
      certificates: [],
      acmeChallenges: [],
      forwards: [],
      upstreams: [{ name: 'shop/shop/web:80', endpoints: [{ address: POD_ADDRESS, port: 80 }] }],
    });

    await api(vm1, 'POST', '/apply', { node: 'vm1', network, volumes: [volume], workloads: [web], ingress }, 600_000);
    await eventually(
      'the site through the ingress',
      async () =>
        (await vm1.exec(`curl -s -H 'Host: ${HOST}' http://${vm1.ip}/ || true`)).includes('imported shop')
          ? true
          : undefined,
      180_000,
    );
    results['shortStopMs'] = Date.now() - stopStarted;

    expect(
      await step(vm1, 'handover', { kind: 'handover', containers: deployment.containers, ports: deployment.ports }),
    ).toMatchObject({
      status: 'done',
    });

    // Port 80 belongs to the ingress now; the late file and the replaced link came with the final pass.
    expect(await vm1.exec("ss -H -ltnp 'sport = :80'")).toContain('envoy');
    expect(await vm1.exec(`curl -s -H 'Host: ${HOST}' http://${vm1.ip}/late.txt`)).toContain('late');

    const container = (await vm1.exec('docker ps -q --filter label=loadweaver.com/workload=shop/shop/web/0')).trim();

    expect(container).not.toBe('');

    // The volume as the imported replica mounts it (the agent's mount point on the host).
    const importedTree = await vm1.exec(TREE('/var/lib/loadweaver/volumes/lw-vol-shop.shop.html'));

    expect(importedTree).toBe(finalTree);
    expect(finalTree).not.toBe(sourceTree);
    // The source stays (stopped, restart policy off) for a manual rollback.
    expect((await vm1.exec("docker inspect -f '{{.State.Running}}' shop-web-1")).trim()).toBe('false');
  }, 1_800_000);

  it('(b) a former node of the same cluster rejoins: its DRBD replica is reused, only the difference resyncs', async () => {
    const minor = 1001;
    const resource = `lw-${minor}`;
    const assignment = volumeAssignmentSchema.parse({
      id: 'shop/db/data',
      dockerName: 'lw-vol-shop.db.data',
      minor,
      port: 7801,
      sizeBytes: 512 * 1024 ** 2,
      replicas: [
        { node: 'vm1', nodeId: 0, address: vm1.ip, host: 'vm1' },
        { node: 'vm2', nodeId: 1, address: vm2.ip, host: 'vm2' },
      ],
      connections: [{ a: 'vm1', b: 'vm2', protocol: 'C' }],
      primary: 'vm1',
      keyRef: 'secret://shop/lw-volume-db.data',
    });
    const html = volumeAssignmentSchema.parse({
      id: 'shop/shop/html',
      dockerName: 'lw-vol-shop.shop.html',
      minor: 1000,
      port: 7800,
      sizeBytes: 512 * 1024 ** 2,
      replicas: [{ node: 'vm1', nodeId: 0, address: vm1.ip, host: 'vm1' }],
      connections: [],
      primary: 'vm1',
      keyRef: 'secret://shop/lw-volume-shop.html',
    });
    const status = (vm: Vm) => vm.exec(`drbdsetup status ${resource} --verbose --statistics`);
    const write = (mb: number, name: string) =>
      vm1.exec(
        `docker run --rm --volume-driver loadweaver -v lw-vol-shop.db.data:/d ${NGINX} sh -c 'head -c ${mb * 1024 * 1024} /dev/urandom > /d/${name} && sync'`,
        { timeoutMs: 300_000 },
      );

    // vm2 as a member of cluster `lab`: identity, keys, a replica of shop/db/data.
    await prepareMember(vm2);
    await prepareMember(vm1);
    await startAgent(vm1);
    await startAgent(vm2);
    await api(vm2, 'POST', '/apply', { node: 'vm2', volumes: [assignment] }, 300_000);
    await api(vm1, 'POST', '/apply', { node: 'vm1', volumes: [html, assignment] }, 300_000);
    // The first mount (the write) initialises the new volume on the primary; then both copies are UpToDate.
    await write(16, 'before');
    await eventually(
      'initial sync',
      async () => ((await status(vm1)).match(/peer-disk:UpToDate/) ? true : undefined),
      300_000,
    );

    const luksBefore = await vm2.exec(`cryptsetup luksUUID /dev/loadweaver/${resource}`);

    // vm2 "leaves" the hard way: its agent is gone, the resource is down, its files and LV stay.
    await vm2.exec(`systemctl stop lw-import; drbdadm down ${resource}; cryptsetup close ${resource}-crypt || true`);
    await write(8, 'while-away');

    // Rejoin: discovery finds the former installation, the classifier keeps the replica.
    const report = await discover(vm2);

    expect(report.former).toMatchObject({ stateDir: true, clusterId: 'lab', nodeName: 'vm2' });
    expect(report.former?.drbdResources).toEqual([
      expect.objectContaining({
        name: resource,
        minor,
        backingDevice: true,
        hosts: [
          { host: 'vm1', nodeId: 0 },
          { host: 'vm2', nodeId: 1 },
        ],
      }),
    ]);

    const former = classifyFormer(
      report,
      cluster('vm2', [{ id: 'shop/db/data', drbdMinor: minor, holders: ['vm1', 'vm2'], sizeBytes: 512 * 1024 ** 2 }]),
    );

    expect(former).toMatchObject({
      kind: 'same-cluster',
      requiresWipe: false,
      reusable: [expect.objectContaining({ resource, volume: 'shop/db/data' })],
    });

    const t = Date.now();

    await startAgent(vm2);
    await api(vm2, 'POST', '/apply', { node: 'vm2', volumes: [assignment] }, 300_000);
    await eventually(
      'resync of the difference',
      async () => {
        const s = await status(vm1);

        return /peer-disk:UpToDate/.test(s) && /out-of-sync:0\b/.test(s) ? s : undefined;
      },
      300_000,
    );
    results['rejoinResyncMs'] = Date.now() - t;

    // The same LUKS header (no reformat), and only about the difference went over the wire.
    expect(await vm2.exec(`cryptsetup luksUUID /dev/loadweaver/${resource}`)).toBe(luksBefore);

    const received = Number(/received:(\d+)/.exec(await status(vm2))?.[1] ?? -1);

    results['rejoinReceivedKiB'] = received;
    expect(received).toBeGreaterThan(0);
    expect(received).toBeLessThan(128 * 1024);

    await vm1.exec(`drbdadm verify ${resource}`);
    await eventually(
      'verify',
      async () => {
        const s = await status(vm1);

        return /replication:Established/.test(s) && !/Verify/.test(s) ? s : undefined;
      },
      300_000,
    );
    expect(await status(vm1)).toMatch(/out-of-sync:0\b/);
  }, 1_800_000);
});
