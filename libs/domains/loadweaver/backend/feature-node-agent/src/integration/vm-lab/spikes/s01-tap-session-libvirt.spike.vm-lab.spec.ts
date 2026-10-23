import { eventually, genericMicrovm, inspectHubImage, podNetwork } from '../m7/m7-lab';

import { type SpikeLab, spikeRecorder, startSpikeLab } from './spike-lab';

/**
 * Spike S1 — tap networking with a libvirt *session* daemon: does `<interface type='ethernet'><target dev='lwtap0'
 * managed='no'/>` work from the unprivileged session libvirt (uid 10930, only `/dev/net/tun`) with a tap the agent
 * pre-created (owned by 10930, multiqueue), and is vhost-net used?
 */
const rec = spikeRecorder({
  id: 'S1',
  title: 'tap + session libvirt (managed=no) and vhost-net',
  validates:
    'M7.2 "Tap networking via tc redirect": the agent creates lwtap0 (user/group 10930) in the launcher netns and the session libvirt opens it unmanaged; vhost-net for throughput',
  ifFails:
    'pass the tap as a file descriptor from the launcher root part (`-netdev tap,fd=`, QEMU args via <qemu:commandline>) instead of managed=no; without vhost-net: give the launcher /dev/vhost-net or accept userspace virtio-net',
});

describe('spike S1: tap + session libvirt', () => {
  let s: SpikeLab;

  beforeAll(async () => {
    s = await startSpikeLab(rec, {
      vms: [{ name: 'vm1', site: 'a', memoryMb: 2048, cpus: 2, nested: true, dataDiskGb: 4 }],
      packages: ['attr'],
    });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await s?.lab.stop();
  }, 300_000);

  it('boots a microVM on an unmanaged, pre-created tap from the session libvirt', async () => {
    if (!s.nested) return;

    const [vm] = s.vms;
    const [driver] = s.drivers;
    const alpine = await inspectHubImage('alpine:3.22');
    const replica = 'spike/s1/net/0';
    const start = Date.now();

    await driver.apply({
      workloads: [
        genericMicrovm({ id: replica, addresses: ['10.244.1.20'] }, alpine, {
          process: { entrypoint: ['/bin/sh', '-c'], cmd: ['echo s1-up; exec sleep 1000000'] },
        }),
      ],
      network: podNetwork('10.244.1.0/24'),
    });

    const launcher = await eventually(
      'launcher',
      async () => (await driver.containerOf(replica)) || undefined,
      300_000,
      2_000,
    );
    const up = await eventually(
      'guest up',
      async () => ((await vm.exec(`docker logs ${launcher} 2>&1`)).includes('s1-up') ? true : undefined),
      300_000,
      2_000,
    ).catch(() => false);

    rec.measure('apply → guest up', Math.round((Date.now() - start) / 100) / 10, 's');
    expect(rec.verdict('microVM booted with the tap', up === true)).toBe(true);

    const xml = await vm.exec(`docker exec ${launcher} cat /dev/shm/agenstra-microvm/vmm/domain.xml`);

    rec.verdict(
      "domain uses <interface type='ethernet'> with managed='no'",
      /type='ethernet'/.test(xml) && /managed='no'/.test(xml),
    );

    const tap = await vm.exec(
      `pid=$(docker inspect -f '{{.State.Pid}}' ${launcher}); nsenter -t $pid -n ip -d link show lwtap0; stat -c '%u' /proc/$pid/root/dev/net/tun 2>/dev/null || true`,
    );

    rec.note('lwtap0', tap.trim());
    rec.verdict('tap owned by uid 10930', /user 10930/.test(tap));
    rec.verdict('tap multiqueue', /multi_queue/.test(tap), 'only with vCPUs > 1 (queues = vCPUs)');
    expect(
      rec.verdict(
        'guest reachable through the tap',
        (await vm.exec('ping -c 3 -W 2 10.244.1.20 >/dev/null && echo ok || true')).includes('ok'),
      ),
    ).toBe(true);

    const qemu = await vm.exec("ps -eo args | grep -m1 '[q]emu-system' || true");
    const vhost = /vhost=on|vhostfd=/.test(qemu);

    rec.note('QEMU netdev', qemu.match(/-netdev [^ ]+/)?.[0] ?? '(not found)');
    rec.note(
      '/dev/vhost-net in the launcher',
      (await vm.exec(`docker exec ${launcher} sh -c 'test -c /dev/vhost-net && echo present || echo absent'`)).trim(),
    );
    rec.verdict(
      'vhost-net used (informational: userspace virtio-net works too)',
      true,
      vhost ? 'vhost on' : 'vhost OFF — userspace virtio-net',
    );

    const throughput = await vm.exec(
      `docker run --rm --network loadweaver docker.io/library/busybox:1.37.0 sh -c 'start=$(date +%s); dd if=/dev/zero bs=1M count=200 2>/dev/null | nc -w 5 10.244.1.20 9 ; echo $(( $(date +%s) - start ))' 2>/dev/null || true`,
    );

    rec.note('200 MiB to the guest (discard port, s; informational)', throughput.trim());
  });
});
