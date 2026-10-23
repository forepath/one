import { downloadDebianCloudImage } from '../m7/m7-lab';

import { type SpikeLab, spikeRecorder, startSpikeLab } from './spike-lab';

/**
 * Spike S6 — VM image scanning: can `trivy vm` scan a Debian cloud image converted to raw and the qcow2 itself (the
 * formats VM image artifacts carry), how long does it take, how much memory, and are the findings usable (OS
 * detected, packages found)? No nested KVM needed (trivy reads the disk image).
 */
const rec = spikeRecorder({
  id: 'S6',
  title: 'VM image scanning with trivy vm (raw / qcow2)',
  validates:
    'M7.3 "OCI VM image artifacts": whether VM images can get vulnerability findings like container images (today: signatures only, no scans — documented as a limit)',
  ifFails:
    'keep VM images out of image policies with vulnerability limits (signatures only), or scan the raw disk through a read-only loop mount with `trivy rootfs`',
});

/** The repository's pinned trivy (as in CI). */
const TRIVY = 'docker.io/aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222';

describe('spike S6: trivy vm on VM images', () => {
  let s: SpikeLab;

  beforeAll(async () => {
    s = await startSpikeLab(rec, {
      vms: [{ name: 'vm1', site: 'a', memoryMb: 3072, cpus: 2, nested: false, rootDiskGb: 24 }],
      packages: ['qemu-utils'],
      driver: false,
    });
  }, 3_600_000);

  afterAll(async () => {
    rec.flush();
    await s?.lab.stop();
  }, 300_000);

  it('scans the raw and the qcow2 disk image', async () => {
    const [vm] = s.vms;
    const qcow2 = await downloadDebianCloudImage(vm);

    await vm.exec(`qemu-img convert -O raw ${qcow2} /var/tmp/debian.raw`, { timeoutMs: 900_000 });
    await vm.exec(`docker pull -q ${TRIVY} >/dev/null`, { timeoutMs: 900_000 });

    for (const [label, file] of [
      ['raw', '/var/tmp/debian.raw'],
      ['qcow2', qcow2],
    ] as const) {
      const t0 = Date.now();
      const result = await vm.execResult(
        `docker run --rm --memory 1536m -v /var/tmp:/var/tmp:ro -v lw-trivy-cache:/root/.cache ${TRIVY} vm --quiet --scanners vuln --format json ${file} > /var/tmp/trivy-${label}.json 2>/var/tmp/trivy-${label}.err; echo rc=$?`,
        { timeoutMs: 1_800_000, allowFailure: true },
      );
      const seconds = Math.round((Date.now() - t0) / 1000);
      const summary = await vm.exec(
        `python3 -c 'import json,sys
try:
  d=json.load(open("/var/tmp/trivy-${label}.json"))
except Exception as e:
  print("unparsable", e); sys.exit(0)
rs=d.get("Results") or []
print(d.get("Metadata",{}).get("OS"), sum(len(r.get("Vulnerabilities") or []) for r in rs), len(rs))'; tail -n 5 /var/tmp/trivy-${label}.err`,
        { allowFailure: true },
      );

      rec.measure(`trivy vm ${label}`, seconds, 's');
      rec.note(`trivy vm ${label} (OS, vulnerabilities, results)`, `${result.stdout.trim()} ${summary.trim()}`);
      rec.verdict(
        `trivy vm scans the ${label} image (OS detected)`,
        /debian/i.test(summary) && result.stdout.includes('rc=0'),
        summary.trim().split('\n')[0],
      );
    }

    expect(rec.verdicts.some((v) => v.pass)).toBe(true);
  });
});
