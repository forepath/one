import { randomBytes, randomUUID } from 'node:crypto';

import { docker, LabRecorder } from '@forepath/shared/backend/util-vm-lab';
import {
  migrationFreezeSchema,
  migrationPrepareSchema,
  migrationRestoreSchema,
  type MigrationProgress,
  type MigrationReportPhase,
  type TransferEndpoint,
  type VolumeAssignment,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';

import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import {
  downloadDebianCloudImage,
  eventually,
  genericMicrovm,
  IMAGE_HINTS,
  inspectHubImage,
  labCertificates,
  type LabVmOptions,
  LAUNCHER_IMAGE,
  loadImages,
  log,
  nestedDescribe,
  type NodeDriver,
  podNetwork,
  pushVmArtifact,
  requireImages,
  requireNested,
  restartNodeDriver,
  sleep,
  startLabRegistry,
  startNodeDriver,
  trustLabRegistry,
  vmVolumes,
  volume,
  vmWorkload,
  workload,
} from './m7-lab';

/**
 * QEMU live migration and KVM-level checkpoints on real kernels (M7 W10, 3.10 / 3.35): two Debian 13 VMs with nested
 * KVM run the M7 node driver (real `VmMigrationService`, mTLS transfer relay to the launcher's libvirt session, DRBD
 * dual-primary window, launcher incoming mode, `MigrationService` for gVisor). The test plays the control plane's
 * `vm-live` session (`migration-state.utils.ts` `vmSessionCommands`): prepare (target) → `vmMigrationStart` (source)
 * → [`vmMigrationSwitchover`] → freeze / restore reported → commit, or abort target first. A client in the lab
 * switch holds a TCP connection to the guest (routes stand in for BIRD's kept-address routes).
 *
 * (a) a VM with a memory writer migrates live: freeze within the budget, the TCP connection survives, the address is
 *     kept on the target, DRBD back to single-primary; (b) a forced switch-over of a non-converging pre-copy;
 *     (c) the target killed mid-precopy → abort, the VM keeps running on the source, never two running guests;
 *     (d) `maxSeconds` exceeded → abort (short stop next); (e) abort after QEMU's switch-over → the source can't resume
 *     (`resumed: false`, the control plane cold-starts it), still never two guests; (f) the source agent killed
 *     mid-migration → recovered session, abort closes the dual-primary window; (g) `drbdadm adjust` is deferred
 *     while dual-primary; (h) gVisor on KVM: checkpoint / restore between two KVM nodes keeps the platform, and a
 *     target without KVM (opted out) refuses it; (i) a generic microVM migrates live (W10b `microvm-live`): writes to
 *     the writable layer during the pre-copy, whiteouts / opaque dirs / setuid, tmpfs content, the filesystem volume
 *     handed over in the freeze (never mounted on both nodes), the TCP connection kept, the source's exec ends with
 *     "replica migrated"; (j) a microVM attempt aborted before the hand-over resumes on the source. Timings (freeze,
 *     precopy, restore) are measured — they calibrate the planner's `overheadMs.qemu` / `runsc-kvm`, `microvmSyncMs`.
 * CPU mismatch (`host-passthrough` between unequal CPUs → short stop) is a control-plane eligibility rule: covered in
 * scheduling.vm-lab.spec.ts with a node whose CPU lacks a flag.
 */

const SUBNET = '10.244.1.0/24';
const FREEZE_BUDGET_MS = 3_000;
const VM_IP = '10.244.1.50';

nestedDescribe('VM live migration')('QEMU live migration on real kernels (VM lab, M7 W10)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let vm2: Vm;
  let n1: NodeDriver;
  let n2: NodeDriver;
  let nested = false;
  let web: LabVmOptions;
  let spec: WorkloadSpec;
  const rec = new LabRecorder('m7-vm-live-migration');
  const drivers = () =>
    new Map([
      [vm1.name, n1],
      [vm2.name, n2],
    ]);

  /** A shell in the lab switch (the client outside both nodes; routes there stand in for BIRD's). */
  const sw = (script: string) => docker(['exec', lab.switchName, 'bash', '-c', script]);
  const routeVia = (vm: Vm) => sw(`ip route replace ${VM_IP}/32 via ${vm.ip}`);
  const report = (driver: NodeDriver, migration: string, phase: MigrationReportPhase, timeoutMs = 300_000) =>
    eventually(
      `${driver.vm.name} ${phase} of ${migration}`,
      async () =>
        (await driver.messages(0))
          .filter((m) => m.type === 'migrationProgress')
          .map((m) => m.payload as MigrationProgress)
          .filter((p) => p.migration === migration && p.phase === phase && p.status !== 'running')
          .pop(),
      timeoutMs,
      300,
    );
  const latest = async (driver: NodeDriver, migration: string, phase: MigrationReportPhase) =>
    (await driver.messages(0))
      .filter((m) => m.type === 'migrationProgress')
      .map((m) => m.payload as MigrationProgress)
      .filter((p) => p.migration === migration && p.phase === phase)
      .pop();
  const guestsRunning = async () => {
    let n = 0;

    for (const vm of [vm1, vm2])
      n +=
        Number((await vm.exec(`docker ps -q --filter label=loadweaver.com/workload=${spec.id} | wc -l`)).trim()) > 0 &&
        (
          await vm.exec(
            `docker exec $(docker ps -q --filter label=loadweaver.com/workload=${spec.id} | head -n1) /usr/lib/agenstra-microvm/vm-ctl state 2>/dev/null || true`,
          )
        ).includes('running')
          ? 1
          : 0;

    return n;
  };
  const dualPrimary = async (vm: Vm) =>
    (await vm.exec('drbdsetup show 2>/dev/null | grep -c "allow-two-primaries\\s*yes" || true')).trim() !== '0';
  const clientAlive = async () => (await sw('cat /tmp/lw-client.state 2>/dev/null || true')).includes('connected');

  const startClient = async () => {
    await sw(
      `rm -f /tmp/lw-client.state; nohup bash -c 'for i in $(seq 1 200); do exec 3<>/dev/tcp/${VM_IP}/9000 && break; sleep 1; done; echo connected > /tmp/lw-client.state; while echo "$(date +%s.%N)" >&3; do sleep 0.1; done; echo dead > /tmp/lw-client.state' >/dev/null 2>&1 &`,
    );
    await eventually('client connected', async () => ((await clientAlive()) ? true : undefined), 300_000, 2_000);
  };

  const theVm = () => spec;

  /** One `vm-live` attempt up to the given point, as the control plane drives it. */
  const migrate = async (
    source: Vm,
    target: Vm,
    options: {
      maxSeconds?: number;
      maxBandwidthBps?: number;
      switchoverAfterMs?: number;
      during?: (migration: string) => Promise<void>;
      /** Another workload (a generic microVM, W10b) instead of the VM; `volumes` = its filesystem volumes. */
      workload?: WorkloadSpec;
      volumes?: string[];
    } = {},
  ) => {
    const s = drivers().get(source.name) as NodeDriver;
    const t = drivers().get(target.name) as NodeDriver;
    const spec = options.workload ?? theVm();
    const migration = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const base = { migration, attempt: 1, replica: spec.id };
    const volumes = options.volumes ?? spec.vm?.disks.map((d) => d.volume) ?? [];
    const started = Date.now();

    await t.migration('vmMigrationPrepare', {
      ...base,
      source: source.name,
      token,
      addresses: spec.addresses,
      volumes,
      expiresInSeconds: 900,
      spec,
    });

    const prepared = await report(t, migration, 'prepare');

    if (prepared.status !== 'done') return { migration, base, volumes, prepared, outcome: 'prepare-failed' as const };

    await s.migration('vmMigrationStart', {
      ...base,
      target: target.name,
      endpoint: prepared.endpoint as TransferEndpoint,
      token,
      downtimeLimitMs: FREEZE_BUDGET_MS,
      maxSeconds: options.maxSeconds ?? 120,
      ...(options.maxBandwidthBps ? { maxBandwidthBps: options.maxBandwidthBps } : {}),
    });

    if (options.during) await options.during(migration);

    if (options.switchoverAfterMs !== undefined) {
      await sleep(options.switchoverAfterMs);

      if ((await latest(s, migration, 'freeze'))?.status !== 'done') await s.migration('vmMigrationSwitchover', base);
    }

    const precopy = await report(s, migration, 'precopy', (options.maxSeconds ?? 120) * 1000 + 120_000);

    rec.note(`${migration} precopy`, precopy);

    if (precopy.status !== 'done')
      return { migration, base, volumes, prepared, precopy, outcome: 'precopy-failed' as const };

    const freeze = await report(s, migration, 'freeze');
    const restore = await report(t, migration, 'restore');

    rec.measure(`${migration.slice(0, 8)} prepare → restore`, Math.round((Date.now() - started) / 100) / 10, 's');

    return { migration, base, volumes, prepared, precopy, freeze, restore, outcome: 'restored' as const };
  };
  const commit = async (source: Vm, target: Vm, base: { migration: string; attempt: number; replica: string }) => {
    const s = drivers().get(source.name) as NodeDriver;
    const t = drivers().get(target.name) as NodeDriver;

    await s.migration('migrationCommit', { ...base, role: 'source' });
    await t.migration('migrationCommit', { ...base, role: 'target' });
    expect(await report(s, base.migration, 'commit')).toMatchObject({ status: 'done' });
    expect(await report(t, base.migration, 'commit')).toMatchObject({ status: 'done' });
  };
  /** Abort as the control plane does: target first, then the source. */
  const abort = async (
    source: Vm,
    target: Vm,
    base: { migration: string; attempt: number; replica: string },
    volumes: string[],
  ) => {
    const s = drivers().get(source.name) as NodeDriver;
    const t = drivers().get(target.name) as NodeDriver;
    const reason = 'migration attempt aborted';

    await t.migration('migrationAbort', { ...base, role: 'target', reason, volumes });
    await report(t, base.migration, 'abort');
    await s.migration('migrationAbort', { ...base, role: 'source', reason, volumes });

    return await report(s, base.migration, 'abort');
  };
  const volumesFor = (primary: Vm): VolumeAssignment[] =>
    vmVolumes(web, [vm1, vm2], primary, { minor: 1300, port: 7980 });
  const mvVolume = (primary: Vm) =>
    volume('lab/mvm/data', [vm1, vm2], primary, { minor: 1350, port: 8050, sizeBytes: 256 * 1024 ** 2 });
  const applyBoth = async (primary: Vm, running: Vm | null) => {
    await n1.apply({
      workloads: running === vm1 ? [spec] : [],
      volumes: volumesFor(primary),
      network: podNetwork(SUBNET),
    });
    await n2.apply({
      workloads: running === vm2 ? [spec] : [],
      volumes: volumesFor(primary),
      network: podNetwork(SUBNET),
    });
  };

  beforeAll(async () => {
    await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE] });
    lab = await rec.time('lab up', () =>
      startVmLab({
        vms: [
          { name: 'vm1', site: 'a', memoryMb: 2560, cpus: 2, nested: true, dataDiskGb: 10, rootDiskGb: 16 },
          { name: 'vm2', site: 'a', memoryMb: 2560, cpus: 2, nested: true, dataDiskGb: 10 },
        ],
        packages: ['attr', 'qemu-utils'],
        log,
      }),
    );
    ({ vm1, vm2 } = lab.vms as Record<'vm1' | 'vm2', Vm>);
    nested = (await requireNested(vm1, 'VM live migration')) && (await requireNested(vm2, 'VM live migration'));

    if (!nested) return;

    await Promise.all([loadImages(vm1, [LAUNCHER_IMAGE]), loadImages(vm2, [LAUNCHER_IMAGE])]);

    const reg = await startLabRegistry(vm1);

    await trustLabRegistry(vm2, reg.host, reg.ca);

    const certs = await labCertificates([vm1, vm2]);

    [n1, n2] = await Promise.all([
      startNodeDriver(vm1, { storage: true, labCa: reg.ca, certs: certs['vm1'], peers: [vm2] }),
      startNodeDriver(vm2, { storage: true, labCa: reg.ca, certs: certs['vm2'], peers: [vm1] }),
    ]);

    const image = await pushVmArtifact(vm1, reg.host, 'lab/debian', '13', {
      path: await downloadDebianCloudImage(vm1),
      format: 'qcow2',
    });

    web = {
      name: 'web',
      image,
      disks: [{ name: 'boot', sizeBytes: 4 * 1024 ** 3 }],
      nics: [{ name: 'nic0', addresses: [VM_IP] }],
      memoryMiB: 512,
      // A TCP sink on :9000 and a memory writer (dirty pages for the pre-copy), started by cloud-init.
      userData: [
        '#cloud-config',
        'runcmd:',
        "  - [systemd-run, --unit, lw-sink, python3, -c, \"import socket\\ns=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('0.0.0.0',9000));s.listen(4)\\nwhile True:\\n c,_=s.accept()\\n f=open('/root/recv','ab')\\n while True:\\n  d=c.recv(4096)\\n  if not d: break\\n  f.write(d);f.flush()\"]",
        '  - [systemd-run, --unit, lw-writer, python3, -c, "import time\\nb=bytearray(160*1024*1024)\\ni=0\\nwhile True:\\n for o in range(0,len(b),4096): b[o]=(i+o)%256\\n i+=1;time.sleep(0.05)"]',
      ].join('\n'),
    };
    spec = vmWorkload(web);
    await applyBoth(vm1, vm1);
    await routeVia(vm1);
    await startClient();
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await lab?.stop();
  }, 300_000);

  it('(a) migrates a VM under a memory writer live: freeze within budget, connection and address kept, single-primary after', async () => {
    if (!nested) return;

    const attempt = await migrate(vm1, vm2);

    expect(attempt.outcome).toBe('restored');

    const freezeMs = attempt.freeze?.freezeMs ?? -1;

    rec.measure('VM live migration freeze', freezeMs, 'ms', FREEZE_BUDGET_MS);
    expect(freezeMs).toBeLessThanOrEqual(FREEZE_BUDGET_MS);
    await routeVia(vm2);
    await commit(vm1, vm2, attempt.base);
    await sleep(3_000);
    expect(await clientAlive()).toBe(true);
    expect(await guestsRunning()).toBe(1);
    expect(await dualPrimary(vm1)).toBe(false);
    expect(await dualPrimary(vm2)).toBe(false);
    expect(await vm2.exec(`ip route show ${VM_IP}`)).toMatch(new RegExp(VM_IP.replace(/\./g, '\\.')));
    await applyBoth(vm2, vm2);
  });

  it('(b) forces the switch-over of a pre-copy that does not converge', async () => {
    if (!nested) return;

    const attempt = await migrate(vm2, vm1, { maxBandwidthBps: 8 * 1024 ** 2, switchoverAfterMs: 20_000 });

    expect(attempt.outcome).toBe('restored');
    rec.measure('forced switch-over freeze', attempt.freeze?.freezeMs ?? -1, 'ms');
    await routeVia(vm1);
    await commit(vm2, vm1, attempt.base);
    expect(await clientAlive()).toBe(true);
    await applyBoth(vm1, vm1);
  });

  it('(c) keeps the VM on the source when the target dies mid-precopy (never two guests)', async () => {
    if (!nested) return;

    const attempt = await migrate(vm1, vm2, {
      maxBandwidthBps: 4 * 1024 ** 2,
      during: async () => {
        await sleep(5_000);
        await vm2.exec(
          `docker kill $(docker ps -q --filter label=loadweaver.com/workload=${spec.id}) >/dev/null || true`,
        );
      },
    });

    expect(attempt.outcome).not.toBe('restored');

    const aborted = await abort(vm1, vm2, attempt.base, attempt.volumes);

    expect(aborted).toMatchObject({ status: 'done', resumed: true });
    expect(await guestsRunning()).toBe(1);
    expect(await clientAlive()).toBe(true);
    expect(await dualPrimary(vm1)).toBe(false);
  });

  it('(d) gives up after maxSeconds (abort → short stop next)', async () => {
    if (!nested) return;

    const attempt = await migrate(vm1, vm2, { maxSeconds: 5, maxBandwidthBps: 1024 ** 2 });

    expect(attempt.outcome).toBe('precopy-failed');
    expect(JSON.stringify(attempt.precopy)).toMatch(/maxSeconds|too long|gave up|timed? ?out/i);
    expect(await abort(vm1, vm2, attempt.base, attempt.volumes)).toMatchObject({ resumed: true });
    expect(await guestsRunning()).toBe(1);
  });

  it('(e) aborts after QEMU switched over: the source cannot resume, still never two guests', async () => {
    if (!nested) return;

    const attempt = await migrate(vm1, vm2);

    expect(attempt.outcome).toBe('restored');

    const aborted = await abort(vm1, vm2, attempt.base, attempt.volumes);

    rec.note('abort after switch-over', aborted);
    expect(aborted.resumed).toBe(false);
    expect(await guestsRunning()).toBeLessThanOrEqual(1);
    // The control plane's short stop: a cold start on the source.
    await applyBoth(vm1, null);
    await applyBoth(vm1, vm1);
    await routeVia(vm1);
    await eventually(
      'guest back',
      async () =>
        (await vm1.exec(`ping -c1 -W2 ${VM_IP} >/dev/null && echo ok || true`)).includes('ok') ? true : undefined,
      600_000,
      5_000,
    );
    await startClient();
  });

  it('(f) recovers after the source agent was killed mid-migration; abort closes the dual-primary window', async () => {
    if (!nested) return;

    const attempt = await migrate(vm1, vm2, {
      maxBandwidthBps: 4 * 1024 ** 2,
      during: async () => {
        await sleep(4_000);
        await vm1.exec('systemctl kill -s SIGKILL lw-m7; sleep 1');
        await restartNodeDriver(vm1);
      },
    });

    rec.note('attempt with a killed source agent', attempt.outcome);

    if (attempt.outcome === 'restored') await commit(vm1, vm2, attempt.base);
    else await abort(vm1, vm2, attempt.base, attempt.volumes);

    expect(await guestsRunning()).toBe(1);
    expect(await dualPrimary(vm1)).toBe(false);
    expect(await dualPrimary(vm2)).toBe(false);
  });

  it('(g) defers drbdadm adjust while a disk is dual-primary', async () => {
    if (!nested) return;

    const holder = (await vm1.exec(`docker ps -q --filter label=loadweaver.com/workload=${spec.id}`)).trim()
      ? vm1
      : vm2;
    const other = holder === vm1 ? vm2 : vm1;
    let adjustedDuring = false;
    const attempt = await migrate(holder, other, {
      maxBandwidthBps: 4 * 1024 ** 2,
      during: async () => {
        await sleep(3_000);
        // An apply with a changed volume (size) during the window: the reconcile must not adjust it now.
        const grown = volumesFor(holder).map((v) => ({ ...v, sizeBytes: v.sizeBytes + 64 * 1024 ** 2 }));

        await (drivers().get(holder.name) as NodeDriver).apply({
          workloads: [spec],
          volumes: grown,
          network: podNetwork(SUBNET),
        });
        adjustedDuring = !(await dualPrimary(holder));
      },
    });

    rec.verdict('no adjust during the dual-primary window', !adjustedDuring);

    if (attempt.outcome === 'restored') {
      await routeVia(other);
      await commit(holder, other, attempt.base);
    } else await abort(holder, other, attempt.base, attempt.volumes);
  });

  it('(h) checkpoints gVisor on KVM between two KVM nodes on the same platform, refuses a target without KVM', async () => {
    if (!nested) return;

    const gk = workload({
      id: 'lab/gk/counter/0',
      addresses: ['10.244.1.30'],
      runtime: 'sandboxed',
      isolation: 'sandboxed-kvm',
      command: ['sh', '-c', 'i=0; while true; do i=$((i+1)); echo "tick $i"; sleep 0.2; done'],
    });
    await n1.apply({ workloads: [gk], volumes: volumesFor(vm1), network: podNetwork(SUBNET) });
    await eventually('gVisor KVM counter', async () => (await n1.containerOf(gk.id)) || undefined);

    const migration = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const base = { migration, attempt: 1, replica: gk.id };

    await n2.migration(
      'migrationPrepare',
      migrationPrepareSchema.parse({
        ...base,
        source: 'vm1',
        runtime: 'runsc',
        token,
        addresses: gk.addresses,
        expiresInSeconds: 900,
        spec: gk,
      }),
    );

    const prepared = await report(n2, migration, 'prepare');

    expect(prepared.status).toBe('done');
    await n1.migration(
      'migrationFreeze',
      migrationFreezeSchema.parse({
        ...base,
        target: 'vm2',
        endpoint: prepared.endpoint,
        token,
        runtime: 'runsc',
        volumes: [],
        freezeBudgetMs: 10_000,
      }),
    );

    const freeze = await report(n1, migration, 'freeze');

    expect(freeze.status).toBe('done');
    await report(n1, migration, 'transfer');
    await n2.migration(
      'migrationRestore',
      migrationRestoreSchema.parse({ ...base, runtime: 'runsc', volumes: [], addresses: gk.addresses }),
    );

    const restored = await report(n2, migration, 'restore');

    rec.measure('gVisor KVM stop-and-copy freeze', freeze.freezeMs ?? -1, 'ms');
    expect(restored.status).toBe('done');
    expect(await vm2.exec('ps -eo args | grep runsc | grep -c -- "--platform=kvm" || true')).not.toMatch(/^0\s*$/);
    await commit(vm1, vm2, base);

    // A target without KVM (opted out) refuses a KVM checkpoint (same-platform rule).
    await n1.host({ kvm: 'disabled' });

    const refused = randomUUID();

    await n1.migration(
      'migrationPrepare',
      migrationPrepareSchema.parse({
        migration: refused,
        attempt: 1,
        replica: gk.id,
        source: 'vm2',
        runtime: 'runsc',
        token,
        addresses: gk.addresses,
        expiresInSeconds: 900,
        spec: gk,
      }),
    );

    const r = await report(n1, refused, 'prepare');

    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/kvm|platform/i);
    await n1.host({ kvm: 'auto' });
  });

  let mv: WorkloadSpec | undefined;

  it('(i) migrates a generic microVM live (W10b): writable layer synced, tmpfs and volume handed over, connection kept', async () => {
    if (!nested) return;

    const caps = await Promise.all([n1.capabilities(), n2.capabilities()]);

    if (
      !rec.verdict(
        'both nodes report microvmMigration',
        caps.every((c) => c['microvmMigration'] === true),
      )
    )
      return;

    // The VM leaves the nodes first (memory); the microVM takes its address and the client's port 9000.
    await applyBoth(vm1, null);

    const alpine = await inspectHubImage('alpine:3.22');
    const app = genericMicrovm(
      {
        id: 'lab/mvm/app/0',
        addresses: [VM_IP],
        volumes: [
          { type: 'volume', volume: 'lab/mvm/data', target: '/data', readOnly: false },
          { type: 'tmpfs', target: '/scratch', sizeBytes: 16 * 1024 ** 2 },
        ],
      },
      alpine,
      {
        memoryMiB: 256,
        process: {
          entrypoint: ['/bin/sh', '-c'],
          cmd: [
            'echo kept > /scratch/t; mkdir -p /opq && touch /opq/a; cp /bin/busybox /usr/local/bin/suid && chmod 4755 /usr/local/bin/suid; ' +
              '(while true; do nc -l -p 9000 >> /data/recv; done &) ; ' +
              'i=0; while true; do i=$((i+1)); echo $i > /root/count; echo $i >> /data/log; touch /root/f$i; rm -f /root/f$((i-5)); sleep 0.1; done',
          ],
        },
      },
    );

    mv = app;
    await n2.apply({ workloads: [], volumes: [...volumesFor(vm1), mvVolume(vm1)], network: podNetwork(SUBNET) });
    await n1.apply({ workloads: [app], volumes: [...volumesFor(vm1), mvVolume(vm1)], network: podNetwork(SUBNET) });
    await eventually(
      'microVM ticking',
      async () => ((await n1.exec(app.id, ['cat', '/root/count'])).text.trim() ? true : undefined),
      300_000,
      2_000,
    );
    await routeVia(vm1);
    await startClient();

    // An exec session on the source ends with "replica migrated" at the commit.
    const channel = `exec:${randomBytes(4).toString('hex')}`;

    await n1.live('terminal', channel, {
      target: { kind: 'replica', replica: app.id },
      command: ['sleep', '600'],
      cols: 80,
      rows: 24,
      tty: false,
    });

    // The volume's mount over time (sampled every 500 ms): never mounted on both nodes.
    let bothMounted = false;
    const mountedOn = (vm: Vm) =>
      vm.exec("findmnt -rn -o SOURCE | grep -c '^/dev/drbd1350' || true", { timeoutMs: 20_000 });
    const watch = setInterval(() => {
      void Promise.all([mountedOn(vm1), mountedOn(vm2)])
        .then(([a, b]) => {
          if (Number(a.trim()) > 0 && Number(b.trim()) > 0) bothMounted = true;
        })
        .catch(() => undefined);
    }, 500);

    try {
      const attempt = await migrate(vm1, vm2, { workload: app, volumes: ['lab/mvm/data'] });

      expect(attempt.outcome).toBe('restored');
      rec.measure('microVM live migration freeze', attempt.freeze?.freezeMs ?? -1, 'ms', FREEZE_BUDGET_MS);
      await routeVia(vm2);
      await commit(vm1, vm2, attempt.base);
    } finally {
      clearInterval(watch);
    }

    expect(rec.verdict('the volume was never mounted on both nodes', !bothMounted)).toBe(true);

    const facts = await n2.exec(app.id, [
      '/bin/sh',
      '-c',
      'cat /scratch/t; ls /opq; stat -c %a /usr/local/bin/suid; cat /root/count; ls /root | grep -c "^f"; tail -n1 /data/log',
    ]);

    rec.note('microVM on the target', facts.text);
    expect(facts.text).toContain('kept');
    expect(facts.text).toContain('4755');
    expect(await clientAlive()).toBe(true);

    const ended = await eventually(
      'source exec ended',
      async () => (await n1.channelOutput(channel)).messages.find((m) => m.type === 'execExit'),
      60_000,
      1_000,
    );

    expect(JSON.stringify(ended.payload)).toMatch(/migrated/);
    expect((await n2.exec(app.id, ['true'])).exitCode).toBe(0);
  });

  it('(j) aborts a microVM migration before the hand-over: the guest resumes on the source', async () => {
    if (!nested || !mv) return;

    const app = mv;
    const attempt = await migrate(vm2, vm1, {
      workload: app,
      volumes: ['lab/mvm/data'],
      maxBandwidthBps: 1024 ** 2,
      during: async (migration) => {
        // Abort while the pre-copy runs (before the freeze / hand-over).
        await sleep(3_000);
        await abort(vm2, vm1, { migration, attempt: 1, replica: app.id }, ['lab/mvm/data']).then((r) =>
          rec.note('abort before the hand-over', r),
        );
      },
    }).catch((error: unknown) => {
      rec.note('attempt after the abort', String(error));

      return null;
    });

    rec.note('outcome', attempt?.outcome ?? 'aborted');
    expect((await n2.exec(app.id, ['cat', '/root/count'])).exitCode).toBe(0);
    expect((await vm1.exec(`docker ps -q --filter label=loadweaver.com/workload=${app.id} | wc -l`)).trim()).toBe('0');
  });
});
