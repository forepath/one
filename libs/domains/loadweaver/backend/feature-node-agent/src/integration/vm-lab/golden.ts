import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { docker, dockerOk, LAB_LABEL, run, tarFiles } from './docker';

/**
 * Everything the golden image is built from, pinned (M6 spike facts): base image by sha512, Docker's apt repository
 * by key fingerprint + exact package versions, Debian packages by version, downloads by checksum. Any change here
 * (or in the provisioning script / QEMU image) yields a new golden volume name, so stale images are never reused.
 */
export const GOLDEN_PINS = {
  debianImage: {
    url: 'https://cloud.debian.org/images/cloud/trixie/20261017-2634/debian-13-genericcloud-amd64-20261017-2634.qcow2',
    sha512:
      'ec584ccabfef7120b4c4f7482adf0e615894d9292cedec446b64194b951ebe5dd97c336b5dcbae458333764b0edd516334506017f33c4f2020ef8d38b569ffe3',
  },
  dockerKeyFingerprint: '9DC858229FC7DD38854AE2D88D81803C0EBFCD88',
  dockerVersion: '5:29.9.1-1~debian.13~trixie',
  containerdVersion: '2.4.2-2~debian.13~trixie',
  runcVersion: '1.5.2',
  criuVersion: '4.1.1-1',
  drbdUtilsVersion: '9.22.0-1.1',
  drbd: {
    version: '9.2.20',
    url: 'https://pkg.linbit.com//downloads/drbd/9/drbd-9.2.20.tar.gz',
    sha256: '4a6ecd048cd41aef6427b99bfcb2b14e16f36f0b1e1626e5751d345ecd2b0962',
  },
  /** gVisor release tarball (`runsc` + `gvisor-bin/` sidecars, unpacked as a whole: `gvisor_sentry` sits next to it). */
  gvisor: {
    release: '20261012.0',
    sha512:
      '9606445eed5aedfcf05310e7ccef61d994089914c6622fc82624c24d2b18db1b2210f40e40a7be27b8b7772859de7d95c501b4eba66423053c960bf671377c5e',
  },
  node: { version: '24.14.1', sha256: '84d38715d449447117d05c3e71acd78daa49d5b1bfa8aacf610303920c3322be' },
  busyboxImage:
    'docker.io/library/busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e',
} as const;

/**
 * Golden variants: `default` is built from `GOLDEN_PINS.debianImage`; `older-kernel` from an older Debian 13 cloud
 * image whose kernel (6.12.107, headers still in trixie main) is older than the newest one in the archive (security:
 * 6.12.113 at the time of pinning), so a host update from a frozen snapshot is a real kernel-ABI change: new kernel,
 * DRBD module rebuilt for it, GRUB default, reboot (`updates.vm-lab` (d)). Same provisioning; own volume name.
 */
export type GoldenVariant = 'default' | 'older-kernel';

export const OLDER_KERNEL_IMAGE = {
  url: 'https://cloud.debian.org/images/cloud/trixie/20260914-2601/debian-13-genericcloud-amd64-20260914-2601.qcow2',
  sha512:
    '95e110dfcdbd0ed8a82a75ed9579802f9950cabf51a810dcc6388e81bc778188713878b9f28d583a0ea602fbf48b35996ae9ad37f584166d8fbd6489df248f53',
  kernel: '6.12.107+deb13-cloud-amd64',
} as const;

function baseImage(variant: GoldenVariant): { url: string; sha512: string } {
  return variant === 'older-kernel' ? OLDER_KERNEL_IMAGE : GOLDEN_PINS.debianImage;
}

/** Guest used for the one-time golden build (not the lab VMs). */
const BUILD_GUEST = { memoryMb: 2048, cpus: 4, diskGb: 12, timeoutS: 2400 };

const HERE = __dirname;

function sha256(...parts: (string | Buffer)[]): string {
  const hash = createHash('sha256');

  for (const part of parts) hash.update(part);

  return hash.digest('hex');
}

const dockerfile = () => readFileSync(join(HERE, 'qemu.Dockerfile'));

/** QEMU / switch / builder image, tagged by the Dockerfile's hash. */
export function qemuImage(): string {
  return `loadweaver-vm-lab-qemu:${sha256(dockerfile()).slice(0, 12)}`;
}

export async function ensureQemuImage(): Promise<string> {
  const image = qemuImage();

  if (!(await dockerOk(['image', 'inspect', image])))
    await docker(['build', '-q', '--label', `${LAB_LABEL}=image`, '-t', image, '-'], {
      input: dockerfile(),
      timeoutMs: 900_000,
    });

  return image;
}

function provisionScript(): string {
  const pins = GOLDEN_PINS;
  const vars = {
    LW_DOCKER_KEY_FPR: pins.dockerKeyFingerprint,
    LW_DOCKER_VERSION: pins.dockerVersion,
    LW_CONTAINERD_VERSION: pins.containerdVersion,
    LW_RUNC_VERSION: pins.runcVersion,
    LW_CRIU_VERSION: pins.criuVersion,
    LW_DRBD_UTILS_VERSION: pins.drbdUtilsVersion,
    LW_DRBD_VERSION: pins.drbd.version,
    LW_DRBD_URL: pins.drbd.url,
    LW_DRBD_SHA256: pins.drbd.sha256,
    LW_GVISOR_RELEASE: pins.gvisor.release,
    LW_GVISOR_SHA512: pins.gvisor.sha512,
    LW_NODE_VERSION: pins.node.version,
    LW_NODE_SHA256: pins.node.sha256,
    LW_BUSYBOX_IMAGE: pins.busyboxImage,
  };
  const script = readFileSync(join(HERE, 'golden-provision.sh'), 'utf8');
  const header = Object.entries(vars)
    .map(([k, v]) => `${k}='${v}'`)
    .join('\n');

  return script.replace(/^set -euo pipefail$/m, `set -euo pipefail\n${header}`);
}

const BUILDER = `set -eu
cd /g
rm -f golden.qcow2 golden.qcow2.tmp ready console.log
if [ ! -f base.ok ]; then
  curl -fsSL -o base.qcow2 "$LW_IMAGE_URL"
  echo "$LW_IMAGE_SHA512  base.qcow2" | sha512sum -c -
  touch base.ok
fi
qemu-img create -q -f qcow2 -F qcow2 -b base.qcow2 build.qcow2 "$LW_DISK_GB"G
cloud-localds seed.img user-data meta-data
timeout "$LW_TIMEOUT_S" qemu-system-x86_64 -enable-kvm -cpu host -smp "$LW_CPUS" -m "$LW_MEMORY_MB" -nographic -no-reboot \\
  -drive file=build.qcow2,if=virtio,cache=none,aio=native,discard=unmap \\
  -drive file=seed.img,if=virtio,format=raw \\
  -netdev user,id=n0 -device virtio-net-pci,netdev=n0 -device virtio-rng-pci < /dev/null | tee console.log
grep -q LW-GOLDEN-OK console.log
qemu-img convert -O qcow2 build.qcow2 golden.qcow2.tmp
mv golden.qcow2.tmp golden.qcow2
rm -f base.qcow2 base.ok build.qcow2 seed.img user-data meta-data
touch ready
`;

/** Name of the golden volume for the current pins / scripts ("one golden qcow2 per lab version"). */
export function goldenVolume(variant: GoldenVariant = 'default'): string {
  const key = sha256(
    JSON.stringify(GOLDEN_PINS),
    JSON.stringify(BUILD_GUEST),
    provisionScript(),
    BUILDER,
    dockerfile(),
    // The default variant's name stays what it was before variants existed (cached golden reused).
    ...(variant === 'default' ? [] : [JSON.stringify({ variant, base: baseImage(variant) })]),
  );

  return `lw-vmlab-golden-${key.slice(0, 12)}`;
}

export interface GoldenInfo {
  volume: string;
  built: boolean;
  seconds: number;
  /** `qemu-img info` virtual / file size of golden.qcow2. */
  size: string;
}

async function goldenReady(image: string, volume: string): Promise<boolean> {
  return (
    (await dockerOk(['volume', 'inspect', volume])) &&
    (await run('docker', ['run', '--rm', '-v', `${volume}:/g:ro`, image, 'test', '-f', '/g/ready'])).code === 0
  );
}

/**
 * Builds the golden qcow2 once (Debian 13 genericcloud + Docker CE / containerd / runc / criu / DRBD 9 module /
 * gVisor / node tooling, see golden-provision.sh) into a named Docker volume, or reuses it. Lab VMs are qcow2 overlays on it.
 * The build boots the base image under QEMU user networking, provisions it with cloud-init and powers it off.
 */
export async function ensureGolden(
  log: (line: string) => void = () => undefined,
  variant: GoldenVariant = 'default',
): Promise<GoldenInfo> {
  const image = await ensureQemuImage();
  const volume = goldenVolume(variant);
  const start = Date.now();
  let built = false;

  if (!(await goldenReady(image, volume))) {
    const logFile = join(tmpdir(), `${volume}.log`);
    const name = `${volume}-build`;

    built = true;
    writeFileSync(logFile, '');
    log(`building golden image ${volume} (log: ${logFile}); this takes several minutes`);
    await docker(['volume', 'create', '--label', `${LAB_LABEL}=golden`, volume]);
    await docker(['run', '-i', '--rm', '-v', `${volume}:/g`, image, 'tar', '-C', '/g', '-xf', '-'], {
      input: await tarFiles({
        'user-data': `#cloud-config\n${JSON.stringify({
          write_files: [
            {
              path: '/root/lw-golden.sh',
              permissions: '0700',
              encoding: 'b64',
              content: Buffer.from(provisionScript()).toString('base64'),
            },
          ],
          runcmd: [['bash', '/root/lw-golden.sh']],
        })}\n`,
        'meta-data': 'instance-id: lw-vmlab-golden\nlocal-hostname: lw-golden\n',
      }),
    });
    await run('docker', ['rm', '-f', name]);

    let partial = '';
    const result = await run(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        name,
        '--label',
        `${LAB_LABEL}=golden-build`,
        '--device',
        '/dev/kvm',
        '--memory',
        `${BUILD_GUEST.memoryMb + 700}m`,
        '-v',
        `${volume}:/g`,
        '-e',
        `LW_IMAGE_URL=${baseImage(variant).url}`,
        '-e',
        `LW_IMAGE_SHA512=${baseImage(variant).sha512}`,
        '-e',
        `LW_DISK_GB=${BUILD_GUEST.diskGb}`,
        '-e',
        `LW_TIMEOUT_S=${BUILD_GUEST.timeoutS}`,
        '-e',
        `LW_CPUS=${BUILD_GUEST.cpus}`,
        '-e',
        `LW_MEMORY_MB=${BUILD_GUEST.memoryMb}`,
        image,
        'sh',
        '-c',
        BUILDER,
      ],
      {
        timeoutMs: (BUILD_GUEST.timeoutS + 600) * 1000,
        onStdout: (chunk) => {
          const lines = (partial + chunk).split('\n');

          partial = lines.pop() ?? '';
          appendFileSync(logFile, chunk);

          for (const line of lines)
            if (/LW-GOLDEN-(STEP|OK|FAIL)/.test(line)) log(`golden: ${line.replace(/^.*?(LW-GOLDEN-)/, '$1').trim()}`);
        },
      },
    );

    if (result.code !== 0 || !(await goldenReady(image, volume)))
      throw new Error(
        `golden image build failed (exit ${result.code}); log: ${logFile}\n${result.stderr.slice(-2000)}`,
      );
  }

  const size = await docker([
    'run',
    '--rm',
    '-v',
    `${volume}:/g:ro`,
    image,
    'sh',
    '-c',
    `qemu-img info /g/golden.qcow2 | grep -E '^(virtual|disk) size' | tr '\\n' ' '`,
  ]);
  const seconds = Math.round((Date.now() - start) / 1000);

  log(`golden image ${volume} ${built ? `built in ${seconds}s` : 'reused'} (${size.trim()})`);

  return { volume, built, seconds, size: size.trim() };
}
