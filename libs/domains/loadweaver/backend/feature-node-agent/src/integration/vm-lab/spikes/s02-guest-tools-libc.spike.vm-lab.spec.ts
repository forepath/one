import { eventually, genericMicrovm, inspectHubImage, podNetwork } from '../m7/m7-lab';

import { type SpikeLab, spikeRecorder, startSpikeLab } from './spike-lab';

/**
 * Spike S2 — guest tools independent of the image's libc: the generic guest runs the bridge with its own Node.js
 * through an explicit loader (`/tools/lib/ld.so --library-path /tools/lib`), `tini` / `lw-pty` static. Does that work
 * on musl (alpine), on an image without any libc or shell (`hello-world`, distroless-like) and on busybox:musl, and
 * how much guest RAM do the tools take?
 */
const rec = spikeRecorder({
  id: 'S2',
  title: 'guest tools on musl / libc-less guests, lw-pty, tools RAM footprint',
  validates:
    'M7.2 "Guest init contract for arbitrary images": the guest tools (node via explicit loader, static tini / lw-pty / busybox) never depend on the image',
  ifFails:
    'ship a static (musl) Node.js build or a small static Go/Rust guest agent instead of node + loader; for lw-pty under musl: build lw-pty with musl-gcc -static (W5 builder stage)',
});

describe('spike S2: guest tools on any libc', () => {
  let s: SpikeLab;

  beforeAll(async () => {
    s = await startSpikeLab(rec, {
      vms: [{ name: 'vm1', site: 'a', memoryMb: 3072, cpus: 2, nested: true, dataDiskGb: 6 }],
      packages: ['attr'],
    });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await s?.lab.stop();
  }, 300_000);

  it('boots alpine (musl), busybox:musl and hello-world (no libc, no shell) and execs into them', async () => {
    if (!s.nested) return;

    const [vm] = s.vms;
    const [driver] = s.drivers;
    const images = {
      alpine: await inspectHubImage('alpine:3.22'),
      busybox: await inspectHubImage('busybox:1.37.0-musl'),
      hello: await inspectHubImage('hello-world:latest'),
    };
    const specs = [
      genericMicrovm({ id: 'spike/s2/alpine/0', addresses: ['10.244.1.21'] }, images.alpine, {
        process: { entrypoint: ['/bin/sh', '-c'], cmd: ['echo s2-alpine; exec sleep 1000000'] },
      }),
      genericMicrovm({ id: 'spike/s2/busybox/0', addresses: ['10.244.1.22'] }, images.busybox, {
        process: { cmd: ['sh', '-c', 'echo s2-busybox; exec sleep 1000000'] },
      }),
      genericMicrovm({ id: 'spike/s2/hello/0', addresses: ['10.244.1.23'], restart: 'no' }, images.hello, {}),
    ];

    await driver.apply({ workloads: specs, network: podNetwork('10.244.1.0/24') });

    for (const [name, marker] of [
      ['alpine', 's2-alpine'],
      ['busybox', 's2-busybox'],
      ['hello', 'Hello from Docker!'],
    ] as const) {
      const replica = `spike/s2/${name}/0`;
      const launcher = await eventually(
        `${name} launcher`,
        async () => (await driver.containerOf(replica)) || undefined,
        300_000,
        2_000,
      );
      const ok = await eventually(
        `${name} output`,
        async () => ((await vm.exec(`docker logs ${launcher} 2>&1`)).includes(marker) ? true : undefined),
        300_000,
        2_000,
      ).catch(() => false);

      expect(rec.verdict(`${name}: guest tools run, workload output in docker logs`, ok === true)).toBe(true);
    }

    // hello-world exits 0 → the launcher exits 0 (no shell / libc needed for the exit path either).
    const helloExit = await eventually(
      'hello exit',
      async () => {
        const id = await driver.containerOf('spike/s2/hello/0');
        const state = (await vm.exec(`docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' ${id}`)).trim();

        return state.startsWith('exited') ? state : undefined;
      },
      300_000,
      3_000,
    );

    rec.verdict('hello-world exit code propagated (0)', helloExit === 'exited 0', helloExit);

    // Exec + lw-pty under musl, and the tools' RAM in the guest.
    const tty = await driver.exec('spike/s2/alpine/0', ['/bin/sh', '-c', 'tty; echo rc=$?']);

    rec.verdict('machine exec into a musl guest', tty.exitCode === 0, tty.text.trim());

    const mem = await driver.exec('spike/s2/busybox/0', [
      'sh',
      '-c',
      'for p in /proc/[0-9]*; do n=$(cat $p/comm 2>/dev/null); case "$n" in node*|tini*|lw-pty*) echo "$n $(grep VmRSS $p/status | tr -s " " | cut -d" " -f2)";; esac; done; grep -E "MemTotal|MemAvailable" /proc/meminfo',
    ]);

    rec.note('guest tools RSS (kB) and guest memory', mem.text.trim());

    // /proc/meminfo isn't namespaced: guest RAM in use with an idle busybox ≈ guest kernel + tools.
    const total = Number(/MemTotal:\s+(\d+)/.exec(mem.text)?.[1] ?? 0);
    const available = Number(/MemAvailable:\s+(\d+)/.exec(mem.text)?.[1] ?? 0);

    rec.measure(
      'guest RAM in use (kernel + guest tools, idle busybox)',
      Math.round((total - available) / 1024),
      'MiB',
      96,
    );
  });
});
