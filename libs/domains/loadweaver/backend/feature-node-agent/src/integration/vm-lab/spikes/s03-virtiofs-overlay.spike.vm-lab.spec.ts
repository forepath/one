import { eventually, genericMicrovm, inspectHubImage, podNetwork } from '../m7/m7-lab';

import { type SpikeLab, spikeRecorder, startSpikeLab, stopSpikeLab } from './spike-lab';

/**
 * Spike S3 — virtiofsd on the host's overlayfs guest root: xattrs, `--announce-submounts` (a volume below the root is
 * its own submount in the guest), inode stability, and `cache=auto` coherence for the host-side file browser (host
 * writes → guest, guest writes → host).
 */
const rec = spikeRecorder({
  id: 'S3',
  title: 'virtiofsd on a host overlayfs (xattrs, submounts, inodes, coherence)',
  validates:
    'M7.2 "Image unpack cache": the guest root is the replica overlay (unpacked layers + writable layer) shared by virtiofsd; the file browser reads the overlay on the host',
  ifFails:
    'xattrs: mount the overlay with userxattr / store security xattrs in the writable layer only; submounts: drop --announce-submounts and give volumes their own virtiofsd; coherence: cache=never for the root (slower) or browse files through vm-exec instead of the host overlay',
});

describe('spike S3: virtiofsd on overlayfs', () => {
  let s: SpikeLab;
  const replica = 'spike/s3/fs/0';
  let merged = '';

  beforeAll(async () => {
    s = await startSpikeLab(rec, {
      vms: [{ name: 'vm1', site: 'a', memoryMb: 2048, cpus: 2, nested: true, dataDiskGb: 6 }],
      packages: ['attr'],
    });

    if (!s.nested) return;

    // Python for xattrs (os.setxattr / os.getxattr): alpine has no setfattr, and the guest needs no egress for it.
    const image = await inspectHubImage('python:3.13-alpine');

    await s.drivers[0].apply({
      workloads: [
        genericMicrovm(
          {
            id: replica,
            addresses: ['10.244.1.30'],
            volumes: [{ type: 'tmpfs', target: '/scratch', sizeBytes: 16 * 1024 ** 2 }],
          },
          image,
          {
            process: { entrypoint: ['/bin/sh', '-c'], cmd: ['echo s3-up; exec sleep 1000000'] },
          },
        ),
      ],
      network: podNetwork('10.244.1.0/24'),
    });

    const launcher = await eventually(
      'launcher',
      async () => (await s.drivers[0].containerOf(replica)) || undefined,
      300_000,
      2_000,
    );

    await eventually(
      'guest up',
      async () => ((await s.vms[0].exec(`docker logs ${launcher} 2>&1`)).includes('s3-up') ? true : undefined),
      300_000,
      2_000,
    );
    merged = (
      await s.vms[0].exec(
        `docker inspect -f '{{range .Mounts}}{{if eq .Destination "/guest"}}{{.Source}}{{end}}{{end}}' ${launcher}`,
      )
    ).trim();
    rec.note('host overlay (merged)', merged);
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await stopSpikeLab(rec, s);
  }, 300_000);

  const guest = (script: string) => s.drivers[0].exec(replica, ['/bin/sh', '-c', script]);

  it('keeps xattrs both ways', async () => {
    if (!s.nested) return;

    const set = await guest(
      "touch /root/x && python3 -c \"import os; os.setxattr('/root/x', 'user.lw', b'from-guest')\" 2>&1 | tail -n 1; echo rc=$?",
    );

    rec.note('setfattr in the guest', set.text.trim());

    const host = await s.vms[0].exec(`getfattr -n user.lw --only-values ${merged}/root/x 2>&1 || true`);

    rec.verdict('user.* xattr written in the guest is on the host overlay', host.includes('from-guest'), host.trim());
    await s.vms[0].exec(`setfattr -n user.host -v from-host ${merged}/root/x`);
    rec.verdict(
      'xattr written on the host is seen in the guest',
      (await guest("python3 -c \"import os; print(os.getxattr('/root/x', 'user.host').decode())\" 2>&1")).text.includes(
        'from-host',
      ),
    );
  });

  it('announces submounts and keeps inodes stable', async () => {
    if (!s.nested) return;

    // `<path>/.`: stat(2) of the mount point itself doesn't trigger the virtio-fs submount (automount), a lookup inside
    // it does.
    const dev = async (path: string) => (await guest(`stat -c %d ${path}/. 2>&1`)).text.trim();
    const [root, scratch, etc] = [await dev('/'), await dev('/scratch'), await dev('/etc')];

    rec.note('st_dev of /, /scratch, /etc', `${root} ${scratch} ${etc}`);

    rec.verdict('a mount below the root is its own submount (--announce-submounts)', root !== scratch);

    const inode = async () => (await guest('stat -c %i /etc/os-release')).text.trim();
    const before = await inode();

    await s.vms[0].exec(`touch ${merged}/etc/os-release`);

    const after = await inode();

    expect(
      rec.verdict(
        'inode stable across a host-side change (copy-up)',
        /^\d+$/.test(before) && before === after,
        `${before} → ${after}`,
      ),
    ).toBeDefined();
  });

  it('is coherent for the file browser (cache=auto)', async () => {
    if (!s.nested) return;

    await guest('echo one > /root/coherent && sync');
    expect(
      rec.verdict(
        'guest write visible on the host at once',
        (await s.vms[0].exec(`cat ${merged}/root/coherent`)).trim() === 'one',
      ),
    ).toBe(true);

    // Baseline: one exec round trip through the live path (the coherence time below includes such round trips).
    const r0 = Date.now();

    await guest('true');
    rec.measure('exec round trip (baseline)', Date.now() - r0, 'ms');

    const t0 = Date.now();

    await s.vms[0].exec(`echo two > ${merged}/root/coherent`);

    const seen = await eventually(
      'host write in the guest',
      async () => ((await guest('cat /root/coherent')).text.trim() === 'two' ? true : undefined),
      30_000,
      200,
    ).catch(() => false);

    rec.measure('host write → visible in the guest', Date.now() - t0, 'ms', 2_000);
    expect(rec.verdict('host write visible in the guest (≤ 30 s)', seen === true)).toBe(true);
  });
});
