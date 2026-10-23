import { randomBytes } from 'node:crypto';

import { LabRecorder } from '@forepath/shared/backend/util-vm-lab';
import type { VolumeAssignment, WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import {
  AGENSTRA_MICROVM_IMAGE,
  downloadDebianCloudImage,
  eventually,
  genericMicrovm,
  hasLocalImage,
  IMAGE_HINTS,
  inspectHubImage,
  LAUNCHER_IMAGE,
  type LabVmOptions,
  loadImages,
  log,
  nestedDescribe,
  type NodeDriver,
  podNetwork,
  pushVmArtifact,
  requireImages,
  requireNested,
  serialText,
  sleep,
  startLabRegistry,
  startNodeDriver,
  vmVolumes,
  vmWorkload,
  workload,
} from './m7-lab';

/**
 * Terminals, machine exec, the file browser and VM consoles on real kernels (M7 W7 / W8, 3.19 + 3.35), through the
 * node agent's live path (`LiveSessionsService` in the M7 node driver; the test reads the agent's `execOutput` /
 * `execExit` / `fileResponse` messages as the control plane would).
 *
 * (a) generic microVM terminal: TTY size visible in the guest and resize; (b) machine exec: exit codes, user,
 *     working dir, env values never in the launcher's process list; (c) file browser on the guest root, coherent both
 *     ways; (d) bundled microVM terminal (optional, needs Agenstra's lab image); (e) full VM serial console: the node's
 *     collector has the UEFI / kernel boot from the container start, replay after reconnect, two viewers share the
 *     line, VNC answers with the RFB handshake, the log continues across a guest reboot (`vmPower reboot`) and starts
 *     anew with a container restart; exec / file browser on a VM are refused.
 * The control plane's `socket/consoles` namespace and noVNC in the browser are covered by vm-api.vm-lab.spec.ts.
 */

const SUBNET = '10.244.1.0/24';

nestedDescribe('live sessions')('terminals, exec, files and consoles (VM lab, M7 W7 / W8)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let n1: NodeDriver;
  let nested = false;
  const rec = new LabRecorder('m7-live-sessions');
  const MV = 'lab/live/alpine/0';
  let vmOptions: LabVmOptions;
  let desired: WorkloadSpec[] = [];
  let volumes: VolumeAssignment[] = [];
  const VM = 'lab/lw-vm/console/0';

  const open = async (replica: string, cols: number, rows: number) => {
    const channel = `term:${randomBytes(6).toString('hex')}`;

    await n1.live('terminal', channel, { target: { kind: 'replica', replica }, command: ['/bin/sh'], cols, rows });

    return channel;
  };
  const type = (channel: string, text: string) =>
    n1.live('input', channel, { data: Buffer.from(text).toString('base64') });
  const screen = (channel: string, pattern: RegExp) =>
    eventually(
      `terminal shows ${pattern}`,
      async () => {
        const out = await n1.channelOutput(channel);

        return pattern.test(out.text) ? out.text : undefined;
      },
      60_000,
      500,
    );

  beforeAll(async () => {
    await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE] });

    const alpine = await inspectHubImage('alpine:3.22');

    lab = await rec.time('lab up', () =>
      startVmLab({
        vms: [{ name: 'vm1', site: 'a', memoryMb: 3584, cpus: 3, nested: true, dataDiskGb: 12, rootDiskGb: 16 }],
        packages: ['attr', 'zstd', 'qemu-utils'],
        log,
      }),
    );
    ({ vm1 } = lab.vms as Record<'vm1', Vm>);
    nested = await requireNested(vm1, 'live sessions');

    if (!nested) return;

    await loadImages(vm1, [LAUNCHER_IMAGE]);

    const reg = await startLabRegistry(vm1);

    n1 = await startNodeDriver(vm1, { storage: true, labCa: reg.ca });

    const disk = await downloadDebianCloudImage(vm1);
    const image = await pushVmArtifact(vm1, reg.host, 'lab/debian', '13', { path: disk, format: 'qcow2' });

    vmOptions = {
      name: 'console',
      image,
      disks: [{ name: 'boot', sizeBytes: 4 * 1024 ** 3 }],
      nics: [{ name: 'nic0', addresses: ['10.244.1.50'] }],
      memoryMiB: 512,
      userData: [
        '#cloud-config',
        'bootcmd:',
        "  - [sh, -c, 'echo LW-LAB-BOOT $(cat /proc/sys/kernel/random/boot_id) > /dev/ttyS0']",
      ].join('\n'),
    };
    desired = [
      genericMicrovm({ id: MV, addresses: ['10.244.1.20'] }, alpine, {
        process: { entrypoint: ['/bin/sh', '-c'], cmd: ['adduser -D -u 1234 labuser; exec sleep 1000000'] },
      }),
      vmWorkload(vmOptions),
    ];
    volumes = vmVolumes(vmOptions, [vm1], vm1, { minor: 1100, port: 7900 });
    await n1.apply({ workloads: desired, volumes, network: podNetwork(SUBNET) });
    await eventually(
      'microVM up',
      async () => ((await n1.exec(MV, ['true'])).exitCode === 0 ? true : undefined),
      300_000,
      3_000,
    );
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await lab?.stop();
  }, 300_000);

  it('(a) opens a terminal in a generic microVM with its size and follows resizes', async () => {
    if (!nested) return;

    const channel = await open(MV, 100, 30);

    await type(channel, 'stty size\n');
    expect(await screen(channel, /30 100/)).toBeTruthy();
    await n1.live('resize', channel, { cols: 120, rows: 40 });
    await type(channel, 'stty size\n');
    expect(await screen(channel, /40 120/)).toBeTruthy();
    await type(channel, 'exit 0\n');
    await n1.live('close', channel).catch(() => undefined);
  });

  it('(b) runs machine exec with exit codes, user, working dir and env values kept out of the process list', async () => {
    if (!nested) return;

    expect((await n1.exec(MV, ['/bin/sh', '-c', 'exit 3'])).exitCode).toBe(3);
    expect((await n1.exec(MV, ['id', '-u'], { user: 'labuser' })).text.trim()).toBe('1234');

    const secret = `lw-secret-${randomBytes(6).toString('hex')}`;
    const running = n1.exec(MV, ['/bin/sh', '-c', 'sleep 6; echo "value=$LW_LAB_SECRET"'], {
      env: [`LW_LAB_SECRET=${secret}`],
    });

    await sleep(2_000);

    const ps = await vm1.exec('ps -eo args');
    const out = await running;

    expect(out.text).toContain(`value=${secret}`);
    expect(ps).not.toContain(secret);

    const wd = await n1.api('POST', '/live', {
      op: 'terminal',
      channel: 'exec:wd',
      payload: {
        target: { kind: 'replica', replica: MV },
        command: ['pwd'],
        cols: 80,
        rows: 24,
        tty: false,
        workingDir: '/etc',
      },
    });

    expect(wd).toBeTruthy();
    expect(
      (
        await eventually('pwd', async () => {
          const o = await n1.channelOutput('exec:wd');

          return o.exitCode === null ? undefined : o;
        })
      ).text.trim(),
    ).toBe('/etc');
  });

  it('(c) browses the guest root through the file browser, coherent with the guest', async () => {
    if (!nested) return;

    const target = { kind: 'replica', replica: MV };
    const written = await n1.file({
      op: 'write',
      target,
      path: '/tmp/from-host.txt',
      offset: 0,
      truncate: true,
      data: Buffer.from('written by the file browser\n').toString('base64'),
    });

    expect(written['ok']).toBe(true);
    expect((await n1.exec(MV, ['cat', '/tmp/from-host.txt'])).text).toBe('written by the file browser\n');
    await n1.exec(MV, ['/bin/sh', '-c', 'echo from-guest > /tmp/from-guest.txt && sync']);

    const read = await n1.file({ op: 'read', target, path: '/tmp/from-guest.txt', offset: 0, length: 4096 });

    expect(Buffer.from(String(read['data']), 'base64').toString('utf8')).toBe('from-guest\n');

    const list = await n1.file({ op: 'list', target, path: '/tmp' });

    expect((list['entries'] as Array<{ name: string }>).map((e) => e.name)).toEqual(
      expect.arrayContaining(['from-host.txt', 'from-guest.txt']),
    );
  });

  it('(d) opens a terminal in a bundled microVM', async () => {
    if (!nested) return;

    if (!(await hasLocalImage(AGENSTRA_MICROVM_IMAGE))) {
      rec.verdict('bundled terminal', false, `skipped: ${AGENSTRA_MICROVM_IMAGE} missing`);

      return;
    }

    await loadImages(vm1, [AGENSTRA_MICROVM_IMAGE]);

    const bundled = workload({
      id: 'lab/live/bundled/0',
      addresses: ['10.244.1.40'],
      image: AGENSTRA_MICROVM_IMAGE,
      command: undefined,
      isolation: 'microvm',
      resources: { cpuMillis: 1000, memoryBytes: 512 * 1024 ** 2 },
      microvm: { mode: 'bundled', vcpus: 1, memoryMiB: 512, rootfsBytes: 2 * 1024 ** 3 },
    });
    await n1.apply({ workloads: [...desired, bundled], volumes, network: podNetwork(SUBNET) });
    await eventually(
      'bundled up',
      async () => ((await n1.exec(bundled.id, ['true'])).exitCode === 0 ? true : undefined),
      300_000,
      3_000,
    );

    const channel = await open(bundled.id, 90, 25);

    await type(channel, 'stty size; whoami\n');
    expect(await screen(channel, /25 90/)).toBeTruthy();
  });

  it('(e) serves the VM serial console (boot log, replay, shared line, reboot, restart) and VNC; refuses exec / files', async () => {
    if (!nested) return;

    const boot = await rec.time(
      'VM boot → kernel on the serial console',
      () => serialText(n1, VM, /LW-LAB-BOOT [0-9a-f-]+/, 600_000),
      120,
    );

    expect(boot).toMatch(/Linux version|EFI|BdsDxe/);

    // Replay: a new viewer gets the boot log first.
    const replay = await serialText(n1, VM, /LW-LAB-BOOT/, 30_000);

    expect(replay.indexOf('LW-LAB-BOOT')).toBeGreaterThan(-1);

    // Two viewers share the line: input on one shows up (the getty's answer) on both.
    const a = `console:${randomBytes(4).toString('hex')}`;
    const b = `console:${randomBytes(4).toString('hex')}`;

    await n1.live('console', a, { target: { kind: 'replica', replica: VM }, kind: 'serial' });
    await n1.live('console', b, { target: { kind: 'replica', replica: VM }, kind: 'serial' });

    const before = (await n1.channelOutput(b)).text.length;

    await n1.live('input', a, { data: Buffer.from('\r').toString('base64') });
    await eventually(
      'the other viewer sees the answer',
      async () => ((await n1.channelOutput(b)).text.slice(before).match(/login:/) ? true : undefined),
      60_000,
      1_000,
    );
    await n1.live('close', a);
    await n1.live('close', b);

    // VNC: the relay answers with the RFB protocol version.
    const vnc = `console:${randomBytes(4).toString('hex')}`;

    await n1.live('console', vnc, { target: { kind: 'replica', replica: VM }, kind: 'vnc' });
    expect(
      await eventually(
        'RFB handshake',
        async () => (await n1.channelOutput(vnc)).text.match(/RFB 003\.00[38]/)?.[0],
        60_000,
        500,
      ),
    ).toBeTruthy();
    await n1.live('close', vnc);

    // A guest reboot continues the same log (two boot markers); a container restart starts a new one.
    await n1.vmMessage('vmPower', { replica: VM, action: 'reboot' });

    const twice = await serialText(n1, VM, /LW-LAB-BOOT [\s\S]*LW-LAB-BOOT /, 600_000);

    expect(twice.match(/LW-LAB-BOOT /g)?.length).toBeGreaterThanOrEqual(2);
    await vm1.exec(`docker restart -t 90 ${await n1.containerOf(VM)} >/dev/null`, { timeoutMs: 300_000 });

    const fresh = await serialText(n1, VM, /LW-LAB-BOOT [0-9a-f-]+/, 600_000);

    expect(fresh.match(/LW-LAB-BOOT /g)?.length).toBe(1);

    // Exec and the file browser stop at a VM.
    const refusedExec = await n1.exec(VM, ['true']).catch((error: unknown) => ({ text: String(error), exitCode: -1 }));

    expect(JSON.stringify(refusedExec)).toMatch(/serial console/);

    const refusedFiles = await n1.file({ op: 'list', target: { kind: 'replica', replica: VM }, path: '/' });

    expect(refusedFiles['ok']).toBe(false);
    expect(JSON.stringify(refusedFiles)).toMatch(/not browsable/);
  });
});
