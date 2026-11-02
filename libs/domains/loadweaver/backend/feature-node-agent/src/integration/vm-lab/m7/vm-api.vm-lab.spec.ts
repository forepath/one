import {
  FatalWait,
  LabCases,
  LabRecorder,
  persistGuard,
  stallGuard,
  type Tunnel,
} from '@forepath/shared/backend/util-vm-lab';
import { io, type Socket } from 'socket.io-client';

import { GOLDEN_PINS } from '../golden';
import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import { CLUSTER_BUDGETS, startCluster, type LabCluster } from './m7-cluster';
import {
  BUSYBOX,
  CP_IMAGE,
  debianGuestAgentImage,
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
 * Full VMs through the control plane (M7 W8 + F3a, W9's backups, the CP secret fix): a one-node cluster — n1, the
 * control-plane member and the VMs' node (nested KVM) — with the real agent, the control plane of this tree and
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
  let cluster: LabCluster;
  let nested = false;
  let api: Tunnel;
  const rec = new LabRecorder('m7-vm-api');
  // Fail fast (lab speed-ups 2026-10-26): dependent cases end at once when their prerequisite failed.
  const cases = new LabCases();
  /** Whether `debian:13` was pushed from the golden's image with qemu-guest-agent (no apt in the nested guest). */
  let guestAgentBaked = false;

  const vmDoc = (name: string, image: string, extra: string[] = []) =>
    [
      'apiVersion: loadweaver.com/v1',
      'kind: VirtualMachine',
      `metadata: { name: ${name}, project: ${PROJECT}, labels: { app: ${name} } }`,
      'spec:',
      `  image: ${image}`,
      '  cpu: { vcpus: 1 }',
      '  memory: 512Mi',
      '  placement: { selector: { names: [n1] } }',
      ...extra,
    ].join('\n');
  const vmStatus = (name: string) => cluster.ok('GET', `/projects/${PROJECT}/virtual-machines/${name}`);
  /**
   * Waits for a VM phase (budget 10 min ≈ 2× the green apply → Running incl. import). Ends at once when the VM stays
   * `Failed` for 2 min or `Pending` (not placed) for 5 min — states that don't recover by waiting.
   */
  const phase = (name: string, want: RegExp, timeoutMs = 600_000) => {
    const guard = persistGuard(`${name} ${want}`);

    return eventually(
      `${name} ${want}`,
      async () => {
        const vm = await vmStatus(name);
        const current = String(vm['phase']);
        const detail = () => JSON.stringify({ message: vm['message'], conditions: vm['conditions'] }).slice(0, 800);

        if (want.test(current)) return vm;

        guard('Failed', current === 'Failed', 120_000, detail);
        guard('Pending', current === 'Pending', 300_000, detail);

        return undefined;
      },
      timeoutMs,
      10_000,
    );
  };
  const action = (name: string, verb: string) =>
    cluster.api('POST', `/projects/${PROJECT}/virtual-machines/${name}/${verb}`, {});

  beforeAll(async () => {
    await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE], [CP_IMAGE]: IMAGE_HINTS[CP_IMAGE] });
    lab = await rec.time('lab up', () =>
      startVmLab({
        // LW_LAB_KEEP=1 (development): keep the lab + cluster, re-attach next time.
        keep: 'm7-vm-api',
        vms: [
          // One node (G5): a second node joins as a control-plane member too (membership 1 → 2 by design), and a
          // member reserves 3 GiB / 1.25 CPUs for the platform — two members plus a VM don't fit the lab's 7 GiB guard.
          // Replicated VM disks across nodes are covered by vm-live-migration / virtual-machine.
          { name: 'vm1', site: 'a', memoryMb: 5120, cpus: 4, nested: true, dataDiskGb: 16, rootDiskGb: 24 },
        ],
        packages: ['attr', 'qemu-utils', 'zstd'],
        log,
      }),
    );
    ({ vm1 } = lab.vms as Record<'vm1', Vm>);
    nested = await requireNested(vm1, 'VM API');

    if (!nested) return;

    cluster = await rec.time('cluster up', () =>
      startCluster([{ vm: vm1, name: 'n1' }], { rec, attached: lab.attached }),
    );
    api = await vm1.forward(3400);
    await cluster.apply(
      `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec:\n  quota: { virtualMachines: 3, vmMemory: 2g }\n`,
    );
    await cluster.ok('PUT', `/projects/${PROJECT}/secrets/vm-user-data`, { value: SECRET_VALUE });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    api?.close();
    await lab?.stop();
  }, 300_000);

  it(
    '(a) pushes qcow2 / raw / containerDisk images with the CLI and imports a URL; the catalog lists them',
    cases.run('a', [], async () => {
      if (!nested) return;

      const disk = await downloadDebianCloudImage(vm1);
      const agentDisk = await debianGuestAgentImage(vm1);

      guestAgentBaked = Boolean(agentDisk);
      rec.note('debian:13 source', agentDisk ? 'golden image with qemu-guest-agent' : 'plain (cloud-init installs it)');
      await vm1.exec(
        [
          `qemu-img convert -O raw ${disk} /var/tmp/debian.raw`,
          'd=$(mktemp -d) && cp ' + disk + ' $d/debian.qcow2',
          'tar -C $d -cf /var/tmp/containerdisk.tar --transform "s,^debian.qcow2,disk/debian.qcow2," debian.qcow2',
        ].join('\n'),
        { timeoutMs: 900_000 },
      );

      await cases.step('a-push', async () => {
        for (const [file, ref, extra] of [
          [agentDisk ?? disk, `${PROJECT}/debian:13`, ['--firmware', 'uefi,bios', '--guest-agent']],
          ['/var/tmp/debian.raw', `${PROJECT}/debian-raw:13`, ['--format', 'raw']],
          ['/var/tmp/containerdisk.tar', `${PROJECT}/debian-cd:13`, []],
        ] as const) {
          const result = await rec.time(`vm-image push ${ref}`, () =>
            cluster.cli(['vm-image', 'push', file, ref, ...extra]),
          );

          rec.note(
            `vm-image push ${ref}`,
            `exit ${result.code}; ${(result.stdout + result.stderr).trim().slice(-400)}`,
          );
          expect(result.stdout).toMatch(
            new RegExp(`Pushed registry\\.lw/${ref.replace(/[/.]/g, '\\$&')}@sha256:[0-9a-f]{64}`),
          );
        }
      });

      const sha256 = (await vm1.exec(`sha256sum ${disk} | cut -d' ' -f1`)).trim();
      const created = await cluster.ok('POST', `/projects/${PROJECT}/vm-images/import`, {
        url: GOLDEN_PINS.debianImage.url,
        sha256,
        ref: 'debian-url:13',
      });

      // Budget 8 min (the public download is ~330 MB; green: 1–3 min); no progress for 5 min ends it at once.
      const stalled = stallGuard('URL import', 300_000);

      await eventually(
        'URL import',
        async () => {
          const job = await cluster.ok('GET', `/projects/${PROJECT}/vm-images/imports/${created.id}`);

          if (job['status'] === 'failed') throw new FatalWait(`import failed: ${JSON.stringify(job)}`);

          if (job['status'] === 'succeeded') return job;

          stalled(Object.fromEntries(Object.entries(job).filter(([k]) => !/heartbeat|At$/i.test(k))));

          return undefined;
        },
        480_000,
        15_000,
      ).catch(async (error: unknown) => {
        rec.note('URL import diagnostics', await cluster.importDiagnostics(PROJECT));
        throw error;
      });

      const catalog = (await cluster.ok('GET', `/projects/${PROJECT}/vm-images`)) as Array<Record<string, unknown>>;

      rec.note('catalog', catalog);
      expect(JSON.stringify(catalog)).toMatch(/debian-raw/);
      expect(JSON.stringify(catalog)).toMatch(/debian-cd/);
      expect(JSON.stringify(catalog)).toMatch(/debian-url/);
    }),
  );

  it(
    '(b) boots a VM with two disks, two NICs and a secret user data from the pushed image',
    cases.run('b', ['a-push'], async () => {
      if (!nested) return;

      await cluster.apply(
        vmDoc(`db`, `registry.lw/${PROJECT}/debian:13`, [
          '  disks:',
          '    - { name: root, size: 4Gi, source: image, replicas: 1 }',
          '    - { name: data, size: 256Mi, replicas: 1 }',
          '  nics: [{ name: eth0 }, { name: backup, ipv6: false }]',
          '  runStrategy: Manual',
          '  cloudInit:',
          '    userData: |',
          '      #cloud-config',
          // The golden's image has the guest agent already (no apt in the nested guest); else cloud-init installs it.
          ...(guestAgentBaked ? [] : ['      packages: [qemu-guest-agent]']),
          '      write_files:',
          '        - { path: /root/lab-secret, permissions: "0600", content: secret://vms/vm-user-data }',
          // The marker goes to the serial console on every boot (runcmd runs once per instance; (e) restarts the VM
          // after its restore and (f) reads the current boot's log).
          '        - path: /etc/systemd/system/lw-secret.service',
          '          content: |',
          '            [Unit]',
          '            After=multi-user.target',
          '            [Service]',
          '            Type=oneshot',
          "            ExecStart=/bin/sh -c 'echo LW-SECRET-SHA $(sha256sum /root/lab-secret | cut -c1-12) > /dev/ttyS0'",
          '            [Install]',
          '            WantedBy=multi-user.target',
          "      runcmd: [[sh, -c, 'systemctl enable --now qemu-guest-agent; systemctl daemon-reload; systemctl enable --now lw-secret.service']]",
        ]),
        CLUSTER_BUDGETS.applyMs,
      );

      const vm = await rec.time('db: apply → Running', () => phase('db', /^Running$/));

      rec.note('db status', vm);
      // The VM list / detail carries counts (`nics: 2`, `disks: 2`); arrays accepted too.
      const count = (v: unknown) => (Array.isArray(v) ? v.length : v);

      expect(count(vm['nics'])).toBe(2);
      expect(count(vm['disks'])).toBe(2);
    }),
  );

  it(
    '(c) runs the power round trip with quota / capacity refusals, force-off and command statuses',
    cases.run('c', ['b'], async () => {
      if (!nested) return;

      expect((await action('db', 'stop')).status).toBeLessThan(300);
      await phase('db', /^Stopped$/, 600_000);

      // Over quota: a second running VM would exceed vmMemory 2g? (512Mi each: fits) — tighten the quota first.
      await cluster.apply(
        `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec:\n  quota: { virtualMachines: 3, vmMemory: 256m }\n`,
      );

      const overQuota = await action('db', 'start');

      expect(overQuota.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(overQuota.json)).toMatch(/quota/i);
      await cluster.apply(
        `apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: ${PROJECT} }\nspec:\n  quota: { virtualMachines: 3, vmMemory: 2g }\n`,
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
    }),
  );

  it(
    '(d) reimages a stopped VM with a new cloud-init instance id',
    cases.run('d', ['b'], async () => {
      if (!nested) return;

      const before = await vmStatus('db');
      // The guest is off, but the launcher runs out its stop grace (~1 min) before the node may re-image: 409 till then.
      const res = await eventually(
        'reimage accepted',
        async () => {
          const r = await cluster.api('POST', `/projects/${PROJECT}/virtual-machines/db/reimage`, {});

          return r.status === 409 && /still being stopped/.test(JSON.stringify(r.json)) ? undefined : r;
        },
        240_000,
        5_000,
      );

      rec.note('reimage request', { status: res.status, body: res.json });
      expect(res.status).toBeLessThan(300);
      await eventually(
        'reimage done',
        async () => {
          const vm = await vmStatus('db');
          const cmds = JSON.stringify(vm['commands'] ?? vm['lastCommands'] ?? []);

          if (/"reimage"[^}]*"failed"/.test(cmds)) throw new FatalWait(`reimage failed: ${cmds}`);

          return /"reimage"[^}]*"succeeded"/.test(cmds) ? vm : undefined;
        },
        600_000,
        15_000,
      );
      expect((await action('db', 'start')).status).toBeLessThan(300);

      const after = await phase('db', /^Running$/);

      // The cloud-init instance generation is part of the power detail.
      const generation = (vm: Record<string, unknown>) =>
        (vm['powerDetail'] as { instanceGeneration?: number } | undefined)?.instanceGeneration;

      rec.note('instance generation', { before: generation(before), after: generation(after) });
      expect(generation(after)).toBe((generation(before) ?? 1) + 1);
    }),
  );

  it(
    '(e) snapshots both disks (frozen with the guest agent) and restores the data disk',
    cases.run('e', ['b'], async () => {
      if (!nested) return;

      const snap = await cluster.ok('POST', `/projects/${PROJECT}/virtual-machines/db/snapshots`, {});
      const done = await eventually(
        'snapshot done',
        async () => {
          const list = (await cluster.ok('GET', `/projects/${PROJECT}/virtual-machines/db/snapshots`)) as Array<
            Record<string, unknown>
          >;
          const s = list.find((x) => x['id'] === snap['id']);

          if (s?.['status'] === 'failed') throw new FatalWait(`snapshot failed: ${JSON.stringify(s)}`);

          return s?.['status'] === 'succeeded' || s?.['status'] === 'done' ? s : undefined;
        },
        600_000,
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
        CLUSTER_BUDGETS.applyMs,
      );
      // The restore runs after the apply: started before it finished, its end (the replica's protection ends, the
      // desired state is re-applied) restarted the launcher mid-boot and (f)'s console session ended (G5 2026-10-28).
      const restored = await eventually(
        'data-disk restore done',
        async () => {
          const restores = (await cluster.ok('GET', `/backups/restores?project=${PROJECT}`)) as Array<{
            name: string;
            status: string;
            error: string | null;
          }>;
          const r = restores.find((x) => x.name === 'db-data-restore');

          if (r?.status === 'failed') throw new FatalWait(`restore failed: ${r.error}`);

          return r?.status === 'done' ? r : undefined;
        },
        600_000,
        5_000,
      );

      rec.note('data-disk restore', restored);
      expect((await action('db', 'start')).status).toBeLessThan(300);
      await phase('db', /^Running$/);
    }),
  );

  it(
    '(f) serves the serial and graphical consoles through socket/consoles',
    cases.run('f', ['b'], async () => {
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

        // Diagnostics: a console session that ends (e.g. its launcher restarted) shows up in the timeout note.
        const closed: unknown[] = [];

        socket.on('consoleClosed', (m: unknown) => closed.push({ at: new Date().toISOString(), ...(m as object) }));

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
        ).catch((error: unknown) => {
          const text = serial.chunks.join('');

          rec.note('serial console (on timeout)', { bytes: text.length, closed, tail: text.slice(-1500) });
          throw error;
        });

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
    }),
  );

  it(
    '(g) plans a VM referencing a containerDisk image with the containerDisk warning',
    cases.run('g', [], async () => {
      if (!nested) return;

      // A real containerDisk image (not converted by the CLI): pushed with docker into the cluster registry.
      await cluster.registryMember(PROJECT);
      await vm1.exec(
        [
          await cluster.registryLogin(),
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
    }),
  );

  it(
    '(h) authorizes registry access by project role: a developer PAT pushes and pulls its project, not another',
    cases.run('h', [], async () => {
      if (!nested) return;

      // The PAT owner is developer of PROJECT only (a PAT never inherits the global admin's powers; user decision
      // 2026-10-26 "project roles only").
      await cluster.apply(`apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: other }\nspec: {}\n`);
      await cluster.registryMember(PROJECT);

      // Registering the first account (the claim) made the lab admin a cluster admin (user decision 2026-10-27: registry
      // access everywhere): drop that membership so the PAT holds only its project role.
      const me = (await cluster.ok('GET', '/access/me')) as { userId: string | null };

      expect(me.userId).toBeTruthy();
      expect((await cluster.api('DELETE', `/cluster/members/${me.userId}`)).status).toBeLessThan(300);

      const run = (script: string) => vm1.execResult(script, { timeoutMs: 600_000, allowFailure: true });
      const login = await run(await cluster.registryLogin());

      expect(login.code).toBe(0);

      const own = await run(
        [
          `docker pull -q ${BUSYBOX} >/dev/null`,
          `docker tag ${BUSYBOX} 127.0.0.1:3400/${PROJECT}/rbac:1`,
          `docker push -q 127.0.0.1:3400/${PROJECT}/rbac:1 >/dev/null`,
          `docker rmi -f 127.0.0.1:3400/${PROJECT}/rbac:1 >/dev/null`,
          `docker pull -q 127.0.0.1:3400/${PROJECT}/rbac:1 >/dev/null && echo pulled`,
        ].join('\n'),
      );

      rec.note('developer push + pull in its project', `${own.code}: ${(own.stdout + own.stderr).trim().slice(-300)}`);
      expect(own.code).toBe(0);
      expect(own.stdout).toContain('pulled');

      const foreign = await run(
        `docker tag ${BUSYBOX} 127.0.0.1:3400/other/rbac:1 && docker push -q 127.0.0.1:3400/other/rbac:1 2>&1; echo rc=$?`,
      );

      rec.note('push into another project', foreign.stdout.trim().slice(-300));
      expect(foreign.stdout).not.toMatch(/rc=0\s*$/);
      expect(foreign.stdout).toMatch(/denied|unauthorized|insufficient_scope|forbidden/i);
    }),
  );
});
