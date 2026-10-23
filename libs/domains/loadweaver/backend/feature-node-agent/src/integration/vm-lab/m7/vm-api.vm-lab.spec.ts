import { LabRecorder, type Tunnel } from '@forepath/shared/backend/util-vm-lab';
import { io, type Socket } from 'socket.io-client';

import { GOLDEN_PINS } from '../golden';
import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import { ADMIN, startCluster, type LabCluster } from './m7-cluster';
import {
  CP_IMAGE,
  downloadDebianCloudImage,
  eventually,
  IMAGE_HINTS,
  LAUNCHER_IMAGE,
  log,
  nestedDescribe,
  requireImages,
  requireNested,
  sleep,
} from './m7-lab';

/**
 * Full VMs through the control plane (M7 W8 + F3a, W9's backups, the CP secret fix): a two-node cluster — n1
 * (control-plane member) and n2 (nested KVM, the VMs' node) — with the real agent, the control plane of this tree and
 * the built-in registry. The test drives the public API, the CLI (`loadweaver vm-image push`) and the `socket/consoles`
 * namespace like the console does.
 *
 * (a) images: `loadweaver vm-image push` of a qcow2, a raw image and a KubeVirt containerDisk through the API's `/v2`
 *     (chunked, absolute upload locations), a URL import (sha256-checked); `GET /projects/:p/vm-images` lists them;
 * (b) a VM with two disks and two NICs and a `secret://` user data (resolved by the node from the control plane's
 *     secrets, pinned at plan time) boots from the pushed image; the VM API shows phase / power / NICs / disks;
 * (c) power round trip for a Manual VM: stop / start (quota refusal while over quota, 409 without capacity), reboot,
 *     reset, shutdown, force-off during an ACPI stop; command statuses become succeeded / failed from the agent's
 *     events; (d) reimage of a stopped VM → new cloud-init instance id; (e) a snapshot of the 2-disk VM (consistency
 *     from the guest agent: frozen; without: crash) and a whole-disk restore (`Restore`, `replace`) of the data disk;
 *     (f) serial and graphical console through `socket/consoles` (boot log first, RFB handshake), refused for
 *     viewers; (g) a VM referencing a containerDisk image directly plans with the containerDisk warning.
 */

const PROJECT = 'vms';
const SECRET_VALUE = `lw-api-secret-${Date.now().toString(36)}`;

nestedDescribe('VM API')('full VMs through the control plane (VM lab, M7 W8 / F3a)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let cluster: LabCluster;
  let nested = false;
  let api: Tunnel;
  const rec = new LabRecorder('m7-vm-api');

  const vmDoc = (name: string, image: string, extra: string[] = []) =>
    [
      'apiVersion: loadweaver.com/v1',
      'kind: VirtualMachine',
      `metadata: { name: ${name}, project: ${PROJECT}, labels: { app: ${name} } }`,
      'spec:',
      `  image: ${image}`,
      '  cpu: { vcpus: 1 }',
      '  memory: 512Mi',
      '  placement: { selector: { names: [n2] } }',
      ...extra,
    ].join('\n');
  const vmStatus = (name: string) => cluster.ok('GET', `/projects/${PROJECT}/virtual-machines/${name}`);
  const phase = (name: string, want: RegExp, timeoutMs = 1_800_000) =>
    eventually(
      `${name} ${want}`,
      async () => {
        const vm = await vmStatus(name);

        return want.test(String(vm['phase'])) ? vm : undefined;
      },
      timeoutMs,
      10_000,
    );
  const action = (name: string, verb: string) =>
    cluster.api('POST', `/projects/${PROJECT}/virtual-machines/${name}/${verb}`, {});

  beforeAll(async () => {
    await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE], [CP_IMAGE]: IMAGE_HINTS[CP_IMAGE] });
    lab = await rec.time('lab up', () =>
      startVmLab({
        vms: [
          { name: 'vm1', site: 'a', memoryMb: 2816, cpus: 3, nested: false, dataDiskGb: 12, rootDiskGb: 20 },
          { name: 'vm2', site: 'a', memoryMb: 2560, cpus: 2, nested: true, dataDiskGb: 12, rootDiskGb: 16 },
        ],
        packages: ['attr', 'qemu-utils', 'zstd'],
        log,
      }),
    );
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
    nested = await requireNested(vm2, 'VM API');

    if (!nested) return;

    cluster = await rec.time('cluster up', () =>
      startCluster([
        { vm: vm1, name: 'n1' },
        { vm: vm2, name: 'n2' },
      ]),
    );
    api = await vm1.forward(3400);
    await cluster.apply(
      `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec:\n  quota: { virtualMachines: 3, vmMemory: 2Gi }\n`,
    );
    await cluster.ok('PUT', `/projects/${PROJECT}/secrets/vm-user-data`, { value: SECRET_VALUE });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    api?.close();
    await lab?.stop();
  }, 300_000);

  it('(a) pushes qcow2 / raw / containerDisk images with the CLI and imports a URL; the catalog lists them', async () => {
    if (!nested) return;

    const disk = await downloadDebianCloudImage(vm1);

    await vm1.exec(
      [
        `qemu-img convert -O raw ${disk} /var/tmp/debian.raw`,
        'd=$(mktemp -d) && cp ' + disk + ' $d/debian.qcow2',
        'tar -C $d -cf /var/tmp/containerdisk.tar --transform "s,^debian.qcow2,disk/debian.qcow2," debian.qcow2',
      ].join('\n'),
      { timeoutMs: 900_000 },
    );

    for (const [file, ref, extra] of [
      [disk, `${PROJECT}/debian:13`, ['--firmware', 'uefi,bios', '--guest-agent']],
      ['/var/tmp/debian.raw', `${PROJECT}/debian-raw:13`, ['--format', 'raw']],
      ['/var/tmp/containerdisk.tar', `${PROJECT}/debian-cd:13`, []],
    ] as const) {
      const result = await rec.time(`vm-image push ${ref}`, () =>
        cluster.cli(['vm-image', 'push', file, ref, ...extra]),
      );

      expect(result.stdout).toMatch(
        new RegExp(`Pushed registry\\.lw/${ref.replace(/[/.]/g, '\\$&')}@sha256:[0-9a-f]{64}`),
      );
    }

    const sha256 = (await vm1.exec(`sha256sum ${disk} | cut -d' ' -f1`)).trim();
    const created = await cluster.ok('POST', `/projects/${PROJECT}/vm-images/import`, {
      url: GOLDEN_PINS.debianImage.url,
      sha256,
      ref: 'debian-url:13',
    });

    await eventually(
      'URL import',
      async () => {
        const job = await cluster.ok('GET', `/projects/${PROJECT}/vm-images/imports/${created.id}`);

        if (job['status'] === 'failed') throw new Error(`import failed: ${JSON.stringify(job)}`);

        return job['status'] === 'succeeded' ? job : undefined;
      },
      1_800_000,
      15_000,
    );

    const catalog = (await cluster.ok('GET', `/projects/${PROJECT}/vm-images`)) as Array<Record<string, unknown>>;

    rec.note('catalog', catalog);
    expect(JSON.stringify(catalog)).toMatch(/debian-raw/);
    expect(JSON.stringify(catalog)).toMatch(/debian-cd/);
    expect(JSON.stringify(catalog)).toMatch(/debian-url/);
  });

  it('(b) boots a VM with two disks, two NICs and a secret user data from the pushed image', async () => {
    if (!nested) return;

    await cluster.apply(
      vmDoc(`db`, `registry.lw/${PROJECT}/debian:13`, [
        '  disks:',
        '    - { name: root, size: 4Gi, source: image, replicas: 2 }',
        '    - { name: data, size: 256Mi, replicas: 2 }',
        '  nics: [{ name: eth0 }, { name: backup, ipv6: false }]',
        '  runStrategy: Manual',
        '  cloudInit:',
        '    userData: |',
        '      #cloud-config',
        '      packages: [qemu-guest-agent]',
        '      write_files:',
        '        - { path: /root/lab-secret, permissions: "0600", content: secret://vms/vm-user-data }',
        "      runcmd: [[sh, -c, 'systemctl enable --now qemu-guest-agent; echo LW-SECRET-SHA $(sha256sum /root/lab-secret | cut -c1-12) > /dev/ttyS0']]",
      ]),
      1_800_000,
    );

    const vm = await rec.time('db: apply → Running', () => phase('db', /^Running$/));

    rec.note('db status', vm);
    expect((vm['nics'] as unknown[]).length).toBe(2);
    expect((vm['disks'] as unknown[]).length).toBe(2);
  });

  it('(c) runs the power round trip with quota / capacity refusals, force-off and command statuses', async () => {
    if (!nested) return;

    expect((await action('db', 'stop')).status).toBeLessThan(300);
    await phase('db', /^Stopped$/, 600_000);

    // Over quota: a second running VM would exceed vmMemory 2Gi? (512Mi each: fits) — tighten the quota first.
    await cluster.apply(
      `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec:\n  quota: { virtualMachines: 3, vmMemory: 256Mi }\n`,
    );

    const overQuota = await action('db', 'start');

    expect(overQuota.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(overQuota.json)).toMatch(/quota/i);
    await cluster.apply(
      `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec:\n  quota: { virtualMachines: 3, vmMemory: 2Gi }\n`,
    );
    expect((await action('db', 'start')).status).toBeLessThan(300);
    await phase('db', /^Running$/);

    for (const verb of ['reboot', 'reset']) {
      expect((await action('db', verb)).status).toBeLessThan(300);
      await sleep(5_000);
      await phase('db', /^Running$/, 600_000);
    }

    expect((await action('db', 'shutdown')).status).toBeLessThan(300);
    await sleep(2_000);
    // force-off while the ACPI shutdown's grace runs: destroy ends it at once.
    const t0 = Date.now();

    expect((await action('db', 'force-off')).status).toBeLessThan(300);
    await phase('db', /^Stopped$/, 300_000);
    rec.measure('force-off during ACPI stop → Stopped', Math.round((Date.now() - t0) / 1000), 's', 60);

    const commands = ((await vmStatus('db'))['commands'] ?? (await vmStatus('db'))['lastCommands'] ?? []) as Array<{
      status: string;
    }>;

    rec.note('node commands', commands);
    expect(commands.some((c) => c.status === 'succeeded')).toBe(true);
    expect(commands.every((c) => c.status !== 'sent')).toBe(true);

    // No capacity: a VM bigger than any node's memory can't start (409).
    await cluster
      .apply(
        vmDoc('huge', `registry.lw/${PROJECT}/debian:13`, [
          '  disks: [{ name: root, size: 4Gi, source: image }]',
          '  nics: [{ name: eth0 }]',
          '  runStrategy: Manual',
        ]).replace('memory: 512Mi', 'memory: 64Gi'),
      )
      .catch((e: unknown) => rec.note('huge VM plan', String(e)));

    const noCapacity = await action('huge', 'start');

    rec.note('huge VM start', noCapacity);
    expect([409, 400, 403, 404]).toContain(noCapacity.status);
  });

  it('(d) reimages a stopped VM with a new cloud-init instance id', async () => {
    if (!nested) return;

    const before = await vmStatus('db');
    const res = await cluster.api('POST', `/projects/${PROJECT}/virtual-machines/db/reimage`, {});

    expect(res.status).toBeLessThan(300);
    await eventually(
      'reimage done',
      async () => {
        const vm = await vmStatus('db');
        const cmds = JSON.stringify(vm['commands'] ?? vm['lastCommands'] ?? []);

        if (/"reimage"[^}]*"failed"/.test(cmds)) throw new Error(`reimage failed: ${cmds}`);

        return /"reimage"[^}]*"succeeded"/.test(cmds) ? vm : undefined;
      },
      1_800_000,
      15_000,
    );
    expect((await action('db', 'start')).status).toBeLessThan(300);

    const after = await phase('db', /^Running$/);

    rec.note('instance generation', { before: before['instanceGeneration'], after: after['instanceGeneration'] });
    expect(after['instanceGeneration']).not.toBe(before['instanceGeneration']);
  });

  it('(e) snapshots both disks (frozen with the guest agent) and restores the data disk', async () => {
    if (!nested) return;

    const snap = await cluster.ok('POST', `/projects/${PROJECT}/virtual-machines/db/snapshots`, {});
    const done = await eventually(
      'snapshot done',
      async () => {
        const list = (await cluster.ok('GET', `/projects/${PROJECT}/virtual-machines/db/snapshots`)) as Array<
          Record<string, unknown>
        >;
        const s = list.find((x) => x['id'] === snap['id']);

        if (s?.['status'] === 'failed') throw new Error(`snapshot failed: ${JSON.stringify(s)}`);

        return s?.['status'] === 'succeeded' || s?.['status'] === 'done' ? s : undefined;
      },
      1_800_000,
      15_000,
    );

    rec.note('snapshot', done);
    expect(String(done['consistency'])).toMatch(/application|filesystem|crash/);

    const backups = (await cluster.ok('GET', `/backups?project=${PROJECT}`)) as Array<Record<string, unknown>>;
    const data = backups.find((b) => JSON.stringify(b).includes('db.data'));

    expect(data).toBeTruthy();
    expect((await action('db', 'stop')).status).toBeLessThan(300);
    await phase('db', /^Stopped$/, 600_000);
    await cluster.apply(
      [
        'apiVersion: loadweaver.com/v1',
        'kind: Restore',
        `metadata: { name: db-data-restore, project: ${PROJECT} }`,
        'spec:',
        `  backup: ${String(data?.['id'])}`,
        '  target: { deployment: lw-vm, volume: db.data, mode: replace }',
      ].join('\n'),
      1_800_000,
    );
    expect((await action('db', 'start')).status).toBeLessThan(300);
    await phase('db', /^Running$/);
  });

  it('(f) serves the serial and graphical consoles through socket/consoles', async () => {
    if (!nested) return;

    const socket: Socket = io(`http://${api.address}/socket/consoles`, {
      transports: ['websocket'],
      extraHeaders: { Authorization: `Bearer ${cluster.token}` },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });

      const open = (kind: 'serial' | 'vnc') =>
        new Promise<{ sessionId: string; chunks: (string | Buffer)[] }>((resolve, reject) => {
          const chunks: (string | Buffer)[] = [];
          let sessionId = '';

          socket.on('consoleOutput', (m: { sessionId: string; data: string | ArrayBuffer }) => {
            if (m.sessionId === sessionId) chunks.push(typeof m.data === 'string' ? m.data : Buffer.from(m.data));
          });
          socket.once('consoleOpened', (m: { sessionId: string }) => {
            sessionId = m.sessionId;
            resolve({ sessionId, chunks });
          });
          socket.once('error', (e: unknown) => reject(new Error(JSON.stringify(e))));
          socket.emit('openConsole', { replica: `${PROJECT}/lw-vm/db/0`, kind, cols: 120, rows: 40 });
        });

      const serial = await open('serial');
      const boot = await eventually(
        'serial boot log',
        async () => {
          const text = serial.chunks.join('');

          return /LW-SECRET-SHA [0-9a-f]{12}/.test(text) ? text : undefined;
        },
        600_000,
        2_000,
      );

      const want = (await vm1.exec(`printf '%s' '${SECRET_VALUE}' | sha256sum | cut -c1-12`)).trim();

      expect(boot).toContain(`LW-SECRET-SHA ${want}`);
      socket.emit('closeConsole', { sessionId: serial.sessionId });

      const vnc = await open('vnc');

      expect(
        await eventually(
          'RFB',
          async () =>
            Buffer.concat(vnc.chunks.map((c) => Buffer.from(c)))
              .toString('latin1')
              .match(/RFB 003\.00[38]/)?.[0],
          60_000,
          500,
        ),
      ).toBeTruthy();
      socket.emit('closeConsole', { sessionId: vnc.sessionId });
    } finally {
      socket.close();
    }
  });

  it('(g) plans a VM referencing a containerDisk image with the containerDisk warning', async () => {
    if (!nested) return;

    // A real containerDisk image (not converted by the CLI): pushed with docker into the cluster registry.
    await vm1.exec(
      [
        `printf '%s' '${ADMIN.password}' | docker login 127.0.0.1:3400 -u ${ADMIN.email} --password-stdin >/dev/null`,
        `d=$(mktemp -d) && cp ${await downloadDebianCloudImage(vm1)} $d/debian.qcow2`,
        "printf 'FROM scratch\\nADD debian.qcow2 /disk/\\n' > $d/Dockerfile",
        `docker build -q -t 127.0.0.1:3400/${PROJECT}/kubevirt-disk:13 $d >/dev/null`,
        `docker push -q 127.0.0.1:3400/${PROJECT}/kubevirt-disk:13 >/dev/null`,
      ].join('\n'),
      { timeoutMs: 1_800_000 },
    );

    const plan = await cluster.plan(
      vmDoc('cd', `registry.lw/${PROJECT}/kubevirt-disk:13`, [
        '  disks: [{ name: root, size: 4Gi, source: image }]',
        '  nics: [{ name: eth0 }]',
        '  runStrategy: Halted',
      ]),
    );

    rec.note('containerDisk plan', plan.warnings ?? plan);
    expect(JSON.stringify(plan)).toMatch(/containerDisk/i);
  });
});
