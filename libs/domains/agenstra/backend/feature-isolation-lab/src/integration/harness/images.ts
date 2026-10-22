import { createHash } from 'crypto';

import {
  buildIsolationLabGoldenUserData,
  ISOLATION_LAB_GOLDEN_MARKER,
  ISOLATION_LAB_LABEL,
  ISOLATION_LAB_PREFIX,
  ISOLATION_LAB_QEMU_BASE_IMAGE,
  ISOLATION_LAB_UBUNTU_IMAGE,
} from '../../lib/isolation-lab.config';

import { docker } from './process';

/** QEMU/KVM in a container (Docker Desktop on WSL2 and Linux Docker expose /dev/kvm with --device). */
const QEMU_DOCKERFILE = `FROM ${ISOLATION_LAB_QEMU_BASE_IMAGE}
RUN apt-get update \\
  && apt-get install -y --no-install-recommends qemu-system-x86 qemu-utils cloud-image-utils ca-certificates curl openssh-client \\
  && rm -rf /var/lib/apt/lists/*
LABEL ${ISOLATION_LAB_LABEL}=image
`;

function shortHash(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 12);
}

/** Tag of the QEMU image (content-addressed by its Dockerfile). */
export function qemuImageTag(): string {
  return `${ISOLATION_LAB_PREFIX}-qemu:${shortHash(QEMU_DOCKERFILE)}`;
}

/** Build the QEMU image once (reused while the Dockerfile is unchanged). */
export async function ensureQemuImage(): Promise<string> {
  const tag = qemuImageTag();
  const existing = await docker(['image', 'ls', '-q', tag]);

  if (!existing.trim()) {
    await docker(['build', '-t', tag, '-'], { input: QEMU_DOCKERFILE, timeoutMs: 15 * 60_000 });
  }

  return tag;
}

/** Volume holding the golden image (content-addressed by every pin and the provisioning). */
export function goldenVolumeName(): string {
  return `${ISOLATION_LAB_PREFIX}-golden-${shortHash(
    ISOLATION_LAB_UBUNTU_IMAGE.url,
    ISOLATION_LAB_UBUNTU_IMAGE.sha256,
    buildIsolationLabGoldenUserData(),
    // The guest disk does not depend on the harness tools of the QEMU image, only on its base.
    ISOLATION_LAB_QEMU_BASE_IMAGE,
  )}`;
}

const GOLDEN_BUILD_SCRIPT = `set -euo pipefail
cd /golden
[ -f golden.qcow2 ] && exit 0
curl -fsSL --retry 3 -o base.img "$LAB_IMAGE_URL"
echo "$LAB_IMAGE_SHA256  base.img" | sha256sum -c -
qemu-img convert -O qcow2 base.img build.qcow2
rm -f base.img
qemu-img resize build.qcow2 20G
printf '%s' "$LAB_USER_DATA" | base64 -d > user-data
cloud-localds seed.img user-data
timeout 2400 qemu-system-x86_64 -machine q35,accel=kvm -cpu host -m 2048 -smp 2 -nographic \\
  -drive file=build.qcow2,if=virtio,format=qcow2 -drive file=seed.img,if=virtio,format=raw \\
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0 > build.log 2>&1 || { tail -n 80 build.log; exit 1; }
grep -q "$LAB_GOLDEN_MARKER" build.log || { echo 'golden provisioning did not finish'; tail -n 80 build.log; exit 1; }
rm -f seed.img user-data
mv build.qcow2 golden.qcow2
`;

/**
 * Build the golden image once: the pinned Ubuntu cloud image booted under QEMU and provisioned by
 * cloud-init with Docker exactly like the Agenstra providers (no gVisor: the lab installs it with the
 * real host preparation scripts).
 */
export async function ensureGoldenImage(): Promise<string> {
  const volume = goldenVolumeName();
  const image = await ensureQemuImage();

  await docker(['volume', 'create', '--label', `${ISOLATION_LAB_LABEL}=golden`, volume]);
  await docker(
    [
      'run',
      '--rm',
      '--label',
      `${ISOLATION_LAB_LABEL}=golden`,
      '--device',
      '/dev/kvm',
      '--memory',
      '3g',
      '-v',
      `${volume}:/golden`,
      '-e',
      `LAB_IMAGE_URL=${ISOLATION_LAB_UBUNTU_IMAGE.url}`,
      '-e',
      `LAB_IMAGE_SHA256=${ISOLATION_LAB_UBUNTU_IMAGE.sha256}`,
      '-e',
      `LAB_USER_DATA=${Buffer.from(buildIsolationLabGoldenUserData()).toString('base64')}`,
      '-e',
      `LAB_GOLDEN_MARKER=${ISOLATION_LAB_GOLDEN_MARKER}`,
      image,
      'bash',
      '-c',
      GOLDEN_BUILD_SCRIPT,
    ],
    { timeoutMs: 45 * 60_000 },
  );

  return volume;
}
