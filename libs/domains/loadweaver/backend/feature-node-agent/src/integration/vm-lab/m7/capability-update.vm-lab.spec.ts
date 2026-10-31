import { LabRecorder, type Tunnel } from '@forepath/shared/backend/util-vm-lab';
import { io, type Socket } from 'socket.io-client';

import { startVmLab, type Vm, type VmLab } from '../vm-lab';

import { startCluster, type LabCluster } from './m7-cluster';
import {
  BUSYBOX,
  CP_IMAGE,
  eventually,
  IMAGE_HINTS,
  LAUNCHER_IMAGE,
  log,
  nestedDescribe,
  requireImages,
  requireNested,
} from './m7-lab';

/**
 * Capability updates keep live sessions (M7 F1): a single-node cluster (nested KVM, control plane of this tree, real
 * agent). A terminal is open through `socket/terminals`; the node's isolation result changes (gVisor's KVM runtime
 * unregistered, then an on-demand `POST /nodes/n1/isolation-probe`), the agent sends `capabilitiesUpdate` on its open
 * stream (feature `capability-updates`, acknowledged in `helloAck`) — the control plane sees the new runtimes, the
 * terminal stays open and keeps working, the agent doesn't reconnect. The runtime comes back the same way.
 */

nestedDescribe('capability updates')('capability updates keep live sessions (VM lab, M7 F1)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let cluster: LabCluster;
  let nested = false;
  let api: Tunnel;
  let socket: Socket;
  const output: string[] = [];
  let closed = false;
  const rec = new LabRecorder('m7-capability-update');
  const SESSION = 'lwcapupdate1';

  const runtimes = async () => ((await cluster.ok('GET', '/nodes/n1'))['runtimes'] ?? []) as string[];
  const typeAndSee = async (marker: string) => {
    // Enter is `\r` on a terminal (as xterm.js sends it); re-sent until the output shows (the shell may not be
    // reading yet right after the session opened).
    const send = () => socket.emit('terminalInput', { sessionId: SESSION, data: `echo ${marker}\r` });

    send();

    // The command's output (a terminal that echoes shows the marker twice; the output alone is what proves the
    // session works — G5: counting the echo assumed one).
    const lines = () =>
      output
        .join('')
        .split(/\r?\n|\r/)
        .filter((line) => line.trim() === marker).length;
    const before = lines();
    let sentAt = Date.now();

    return await eventually(
      `terminal echoes ${marker}`,
      async () => {
        if (lines() > before) return true;

        if (Date.now() - sentAt > 10_000) {
          sentAt = Date.now();
          send();
        }

        return undefined;
      },
      60_000,
      500,
    ).catch((error: unknown) => {
      log(`terminal output so far: ${JSON.stringify(output.join('').slice(-2000))}; closed: ${closed}`);
      throw error;
    });
  };
  const hellos = () =>
    vm1
      .exec(
        "journalctl -u lw-agent --no-pager | grep -ciE 'connected to the control plane|hello sent|stream (opened|connected)' || true",
      )
      .then((o) => Number(o.trim()));

  beforeAll(async () => {
    await requireImages({ [LAUNCHER_IMAGE]: IMAGE_HINTS[LAUNCHER_IMAGE], [CP_IMAGE]: IMAGE_HINTS[CP_IMAGE] });
    lab = await rec.time('lab up', () =>
      startVmLab({
        // LW_LAB_KEEP=1 (development): keep the lab + cluster, re-attach next time.
        keep: 'm7-capability-update',
        vms: [{ name: 'vm1', site: 'a', memoryMb: 3072, cpus: 3, nested: true, dataDiskGb: 6, rootDiskGb: 16 }],
        packages: ['attr'],
        log,
      }),
    );
    ({ vm1 } = lab.vms as Record<'vm1', Vm>);
    nested = await requireNested(vm1, 'capability updates');

    if (!nested) return;

    cluster = await rec.time('cluster up', () =>
      startCluster([{ vm: vm1, name: 'n1' }], { rec, attached: lab.attached }),
    );
    await cluster.apply(
      [
        'apiVersion: loadweaver.com/v1',
        'kind: Project',
        'metadata: { name: caps }',
        'spec: {}',
        '---',
        'apiVersion: loadweaver.com/v1',
        'kind: Deployment',
        'metadata: { name: shell, project: caps }',
        'spec:',
        '  compose: |',
        '    services:',
        `      app: { image: ${BUSYBOX}, command: [sleep, "1000000"] }`,
      ].join('\n'),
    );
    await cluster.running('caps', 'shell');

    // Kept lab (LW_LAB_KEEP=1): a run that ended between "KVM runtime gone" and "back" left it unregistered.
    if (lab.attached && (await vm1.exec('test -f /root/daemon.json.lab && echo yes || true')).trim() === 'yes') {
      await vm1.exec('cp /root/daemon.json.lab /etc/docker/daemon.json && systemctl reload docker');
      await cluster.ok('POST', '/nodes/n1/isolation-probe');
      await eventually(
        'sandboxed-kvm restored (kept lab)',
        async () => ((await runtimes()).includes('sandboxed-kvm') ? true : undefined),
        300_000,
        3_000,
      );
    }

    api = await vm1.forward(3400);
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    socket?.close();
    api?.close();
    await lab?.stop();
  }, 300_000);

  it('keeps an open terminal while the node reports changed capabilities in-stream', async () => {
    if (!nested) return;

    expect(await runtimes()).toContain('sandboxed-kvm');
    socket = io(`http://${api.address}/socket/terminals`, {
      transports: ['websocket'],
      extraHeaders: { Authorization: `Bearer ${cluster.token}` },
    });
    socket.on('terminalOutput', (m: { sessionId: string; data: string }) => {
      if (m.sessionId === SESSION) output.push(m.data);
    });
    socket.on('terminalClosed', (m: { sessionId: string }) => {
      if (m.sessionId === SESSION) closed = true;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('terminalCreated', () => resolve());
      socket.once('error', (e: unknown) => reject(new Error(JSON.stringify(e))));
      socket.emit('createTerminal', {
        sessionId: SESSION,
        target: { replica: 'caps/shell/app/0' },
        shell: '/bin/sh',
        cols: 100,
        rows: 30,
      });
    });
    await typeAndSee('lw-before');

    const hellosBefore = await hellos();

    // gVisor's KVM runtime gone (as an admin or a broken update would leave it), then an on-demand probe.
    await vm1.exec(
      'jq \'del(.runtimes["runsc-kvm"], .runtimes["runsc-kvm-hostnet"])\' /etc/docker/daemon.json > /tmp/d.json && cp /etc/docker/daemon.json /root/daemon.json.lab && mv /tmp/d.json /etc/docker/daemon.json && systemctl reload docker',
    );
    expect((await cluster.api('POST', '/nodes/n1/isolation-probe')).status).toBe(202);
    await rec.time('capability change visible in the control plane', () =>
      eventually(
        'sandboxed-kvm gone',
        async () => ((await runtimes()).includes('sandboxed-kvm') ? undefined : true),
        300_000,
        3_000,
      ),
    );
    await typeAndSee('lw-after-change');
    expect(closed).toBe(false);
    rec.verdict(
      'no reconnect for the capability change',
      (await hellos()) === hellosBefore,
      `hello lines ${hellosBefore} → ${await hellos()}`,
    );

    // And back.
    await vm1.exec('cp /root/daemon.json.lab /etc/docker/daemon.json && systemctl reload docker');
    expect((await cluster.api('POST', '/nodes/n1/isolation-probe')).status).toBe(202);
    await eventually(
      'sandboxed-kvm back',
      async () => ((await runtimes()).includes('sandboxed-kvm') ? true : undefined),
      300_000,
      3_000,
    );
    await typeAndSee('lw-after-restore');
    expect(closed).toBe(false);
  });
});
