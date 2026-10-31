import { MICROVM_LAUNCHER_OVERHEAD_MIB } from '@forepath/shared/backend/util-microvm-bridge';

import { eventually, genericMicrovm, inspectHubImage, podNetwork } from '../m7/m7-lab';

import { containerMemory, type SpikeLab, spikeRecorder, startSpikeLab, stopSpikeLab } from './spike-lab';

/**
 * Spike S10 — memory accounting: is the guest's memory (QEMU's memfd backend) charged to the launcher container's
 * cgroup, what happens when the guest fills its RAM (guest OOM, not a host OOM kill of the launcher), and does
 * `LAUNCHER_OVERHEAD_MiB = 384` hold for a generic microVM with its second virtiofsd (guest tools) and a volume
 * virtiofsd?
 */
const rec = spikeRecorder({
  id: 'S10',
  title: 'memfd guest memory in the launcher cgroup, OOM behaviour, 384 MiB overhead',
  validates:
    'M7.2 "Sizing and boot budget": launcher memory limit = guest + 384 MiB; requests / quotas add the same overhead (W3)',
  ifFails:
    'raise MICROVM_LAUNCHER_OVERHEAD_MIB (bridge constants, planner + quotas follow) to the measured peak overhead + margin; if memfd is charged elsewhere: set the guest memory backend to `memory-backend-file` on the launcher tmpfs or account it via the node reserve',
});

describe('spike S10: memory accounting', () => {
  let s: SpikeLab;
  const GUEST = 256;
  const replica = 'spike/s10/mem/0';

  beforeAll(async () => {
    s = await startSpikeLab(rec, {
      vms: [{ name: 'vm1', site: 'a', memoryMb: 2048, cpus: 2, nested: true, dataDiskGb: 4 }],
      packages: ['attr'],
    });

    if (!s.nested) return;

    const alpine = await inspectHubImage('alpine:3.22');

    await s.drivers[0].apply({
      workloads: [
        genericMicrovm(
          {
            id: replica,
            addresses: ['10.244.1.20'],
            volumes: [{ type: 'tmpfs', target: '/scratch', sizeBytes: 8 * 1024 ** 2 }],
          },
          alpine,
          {
            memoryMiB: GUEST,
            // F6: the workload itself overfills the guest on a trigger (string doubling in its own RSS), so the
            // guest's OOM victim is deterministic: the workload (oom_score_adj 0), never the bridge agent (-1000).
            process: {
              entrypoint: ['/bin/sh', '-c'],
              cmd: [
                'echo s10-up; while [ ! -e /tmp/s10-go ]; do sleep 1; done; echo s10-overfill; a=x; while :; do a="$a$a"; done',
              ],
            },
          },
        ),
      ],
      network: podNetwork('10.244.1.0/24'),
    });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await stopSpikeLab(rec, s);
  }, 300_000);

  it('charges guest memory to the launcher and stays within guest + overhead', async () => {
    if (!s.nested) return;

    const [vm] = s.vms;
    const [driver] = s.drivers;
    const launcher = await eventually(
      'launcher',
      async () => (await driver.containerOf(replica)) || undefined,
      300_000,
      2_000,
    );

    await eventually(
      'guest up',
      async () => ((await vm.exec(`docker logs ${launcher} 2>&1`)).includes('s10-up') ? true : undefined),
      300_000,
      2_000,
    );

    const idle = await containerMemory(vm, launcher);

    rec.measure('launcher memory.current (idle guest)', Math.round(idle.current / 1024 ** 2), 'MiB');
    rec.measure(
      'launcher memory limit',
      Math.round(idle.limit / 1024 ** 2),
      'MiB',
      GUEST + MICROVM_LAUNCHER_OVERHEAD_MIB,
    );
    rec.note(
      'virtiofsd processes in the launcher',
      (await vm.exec(`docker top ${launcher} -o pid,rss,args | grep -c virtiofsd || true`)).trim(),
    );

    // The guest's free memory first: its initramfs (guest tools incl. node) and the bridge agent live in guest RAM,
    // and a fill beyond MemAvailable makes the guest's OOM killer pick the bridge agent (largest RSS; tmpfs pages
    // belong to no process) → the guest powers off and the launcher exits 255 (G3: the intermittent S10 failure, a
    // fixed 160 MiB fill in a 256 MiB guest). The guest kernel's console log level is raised so an OOM kill shows up
    // in the launcher log (diagnostics).
    const meminfo = await driver.exec(replica, [
      '/bin/sh',
      '-c',
      'echo 7 > /proc/sys/kernel/printk 2>/dev/null; grep -E "^(MemTotal|MemAvailable):" /proc/meminfo',
    ]);
    const availableMiB = Math.floor(Number(/MemAvailable:\s+(\d+)/.exec(meminfo.text)?.[1] ?? 0) / 1024);
    const fillMiB = Math.min(160, Math.max(32, availableMiB - 64));

    rec.note('guest memory before the fill', meminfo.text.trim().replace(/\s+/g, ' '));

    // The guest touches fillMiB of its RAM — a tmpfs mounted inside the guest (the workload root is virtio-fs, so a
    // plain path would land in the host's page cache): the launcher's cgroup grows with it (memfd charged there).
    const fill = await driver.exec(replica, [
      '/bin/sh',
      '-c',
      'mkdir -p /lwfill && mount -t tmpfs -o size=1g tmpfs /lwfill && grep -c " /lwfill tmpfs" /proc/mounts && ' +
        `dd if=/dev/urandom of=/lwfill/fill bs=1M count=${fillMiB} 2>/dev/null; echo done`,
    ]);

    rec.note('guest tmpfs fill', fill.text.trim());

    const filled = await containerMemory(vm, launcher);
    const grown = Math.round((filled.current - idle.current) / 1024 ** 2);

    rec.measure(`launcher growth after the guest touched ${fillMiB} MiB`, grown, 'MiB');
    expect(
      rec.verdict(
        'guest memory is charged to the launcher cgroup',
        grown >= Math.round(fillMiB * 0.75),
        `${grown} MiB`,
      ),
    ).toBe(true);

    // Beyond its RAM: the guest's own OOM killer acts; the launcher is not OOM-killed by the host. The launcher's
    // cgroup is sampled in the background (a workload ended by the guest's OOM restarts the launcher: a new cgroup,
    // whose memory.peak / OOMKilled say nothing about the overfill).
    const cgroup = `/sys/fs/cgroup$(cut -d: -f3 /proc/$(docker inspect -f '{{.State.Pid}}' ${launcher})/cgroup | head -n1)`;

    await vm.exec(
      [
        'rm -f /tmp/s10-max; touch /tmp/s10-sampling',
        `cg=${cgroup}`,
        `setsid nohup bash -c 'm=0; while [ -e /tmp/s10-sampling ]; do c=$(cat '"$cg"'/memory.current 2>/dev/null || echo 0); if [ "$c" -gt "$m" ]; then m=$c; echo $m > /tmp/s10-max; fi; sleep 0.05; done' >/dev/null 2>&1 &`,
      ].join('\n'),
    );

    const hostOomBefore = Number((await vm.exec("dmesg | grep -c 'Killed process .*qemu' || true")).trim());

    // F6: the container's exit code comes from Docker's die event (a restart resets State.ExitCode).
    await vm.exec(
      `rm -f /tmp/s10-die; setsid nohup timeout 600 docker events --filter container=${launcher} --filter event=die --format '{{.Actor.Attributes.exitCode}}' >/tmp/s10-die 2>/dev/null &`,
    );
    await driver.exec(replica, ['/bin/sh', '-c', 'touch /tmp/s10-go']).catch(() => undefined);

    const exitCode = await eventually(
      'launcher die event',
      async () => (await vm.exec('head -n1 /tmp/s10-die 2>/dev/null || true')).trim() || undefined,
      300_000,
      1_000,
    ).catch(() => 'none');

    await vm.exec('sleep 2; rm -f /tmp/s10-sampling');

    const maxBytes = Number((await vm.exec('cat /tmp/s10-max 2>/dev/null || echo 0')).trim());
    const hostOomAfter = Number((await vm.exec("dmesg | grep -c 'Killed process .*qemu' || true")).trim());
    const state = (
      await vm.exec(`docker inspect -f '{{.State.Running}} restarts={{.RestartCount}}' ${launcher}`)
    ).trim();
    const peakMiB = Math.round(maxBytes / 1024 ** 2);
    const overhead = peakMiB - GUEST;

    rec.note('launcher after the overfill', state);
    rec.measure(
      'launcher memory.current max during the overfill',
      peakMiB,
      'MiB',
      GUEST + MICROVM_LAUNCHER_OVERHEAD_MIB,
    );
    rec.measure(
      'peak overhead above the guest size (2 virtiofsd + QEMU + libvirt + bridge)',
      overhead,
      'MiB',
      MICROVM_LAUNCHER_OVERHEAD_MIB,
    );
    rec.verdict(
      'launcher (QEMU) not OOM-killed by the host when the guest overfills',
      hostOomAfter === hostOomBefore && maxBytes > 0,
      `host OOM kills of qemu: ${hostOomBefore} → ${hostOomAfter}`,
    );
    rec.verdict(
      `overhead within ${MICROVM_LAUNCHER_OVERHEAD_MIB} MiB`,
      overhead <= MICROVM_LAUNCHER_OVERHEAD_MIB,
      `${overhead} MiB`,
    );

    // F6: the workload is the OOM victim (exit 137), the agent (-1000) survives and logs the OOM kill before the
    // workload exit is reported. The guest kernel's OOM task dump (console, printk 7) lists every task's
    // oom_score_adj — the only view of the agent from outside the workload's PID namespace.
    const logs = await vm.exec(`docker logs ${launcher} 2>&1`);
    const lines = logs.split('\n');
    const killed = lines.filter((line) => /Killed process \d+ \(/.test(line)).map((line) => line.trim());
    // Task dump rows: `[  pid  ]   uid  tgid … oom_score_adj name`; the agent is node started through the guest
    // tools' loader, so its name is `ld.so` (generic) or `node` (bundled).
    const dump = lines.filter((line) => /\[\s*\d+\]\s+\d+\s+\d+\s+\d+/.test(line));
    const adjOf = (name: RegExp) =>
      dump
        .map((line) => /\s(-?\d+)\s+(\S+)\s*$/.exec(line))
        .filter((m): m is RegExpExecArray => !!m && name.test(m[2]))
        .map((m) => Number(m[1]));
    const agentAdj = adjOf(/^(ld\.so|node|node\.real)$/);
    const oomLine = lines.findIndex((line) => line.includes('guest OOM killer ended'));
    const agentExit = lines.findIndex((line) => line.includes('bridge agent exited'));

    rec.note('launcher die exit code', exitCode);
    rec.note('guest OOM kills', killed.join(' | ') || 'none');
    rec.note('guest OOM task dump', dump.map((l) => l.trim()).join(' | ') || 'none');
    rec.note('agent log', lines[oomLine]?.trim() ?? 'none');
    rec.verdict('F6: container exits 137 (workload OOM-killed in the guest)', exitCode === '137', `exit ${exitCode}`);
    rec.verdict(
      'F6: the guest OOM killer ended the workload, never the bridge agent (node)',
      killed.length > 0 && killed.every((line) => !/\((node|node\.real|ld\.so|tini)\)/.test(line)),
      killed.join(' | ') || 'no OOM kill seen',
    );
    rec.verdict(
      'F6: agent oom_score_adj -1000, workload 0 (guest OOM task dump)',
      agentAdj.length > 0 && agentAdj.every((v) => v === -1000) && adjOf(/^sh$/).includes(0),
      `agent ${agentAdj.join(',') || '?'}; sh ${adjOf(/^sh$/).join(',') || '?'}; tini ${adjOf(/^tini$/).join(',') || '?'}`,
    );
    rec.verdict(
      'F6: "guest OOM killer ended …" logged before the agent ended',
      oomLine >= 0 && (agentExit < 0 || oomLine < agentExit),
      `line ${oomLine} vs ${agentExit}`,
    );
    expect(rec.verdicts.every((v) => v.pass)).toBe(true);
  });
});
