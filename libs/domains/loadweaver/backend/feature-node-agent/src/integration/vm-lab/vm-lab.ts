import {
  type ExecOptions,
  startSwitchLab,
  type SwitchLab,
  type SwitchLabOptions,
  type SwitchVmSpec,
  type Vm,
} from '@forepath/shared/backend/util-vm-lab';

import { LAB_LABEL, RUN_LABEL } from './docker';
import { ensureGolden, ensureQemuImage, GOLDEN_LAB_PACKAGES, type GoldenVariant } from './golden';

/**
 * VM lab (M6): real Debian 13 VMs (QEMU/KVM inside containers) cloned from the cached golden image.
 *
 * Topology: one small "switch" container owns a network namespace with one Linux bridge per site (gateway `.1`)
 * and one persistent tap per VM; it routes between the sites (optionally with netem delay) and NATs to the
 * internet. Each VM runs in its own container (own memory cgroup, `--network container:<switch>`), so it can be
 * crashed / restarted alone. The test process reaches the guests through ssh from inside the switch container.
 *
 * Since M7.6 this is the shared VM-lab harness (`@forepath/shared/backend/util-vm-lab`, `startSwitchLab`) with
 * Loadweaver's golden image, names (`lw-vmlab-<run>-…`) and labels: same behaviour, plus nested-KVM VMs (`nested`,
 * default on), the heavy / VM-lab locks, the host memory check and cleanup on process exit.
 */

export type { ExecOptions, Vm };
export type VmSpec = SwitchVmSpec;
export type VmLab = SwitchLab;

export interface VmLabOptions extends SwitchLabOptions {
  /** Golden image the VMs are cloned from (default: the current pins; `older-kernel`: see golden.ts). */
  golden?: GoldenVariant;
}

export const DEFAULT_MEMORY_MB = 1536;
/** Smallest root disk of a lab VM (GiB virtual; the golden image is 12 GiB with ~6 GiB used). */
export const MIN_ROOT_DISK_GB = 16;
export const CONTAINER_OVERHEAD_MB = 700;
/** Prefix of every lab container / volume (`lw-vmlab-<run>-switch`, `lw-vmlab-<run>-<vm>`). */
export const LAB_PREFIX = 'lw-vmlab';

/** First-boot packages the golden image doesn't have already (the golden installs `GOLDEN_LAB_PACKAGES`). */
export function packagesBeyondGolden(packages: readonly string[] | undefined): string[] {
  return (packages ?? []).filter((p) => !GOLDEN_LAB_PACKAGES.includes(p));
}

/**
 * Boots the VMs of one lab run; call `stop()` in `afterAll`. `keep: '<suite>'` lets a development run keep the lab
 * (`LW_LAB_KEEP=1`, see the shared harness's keep.ts) and re-attach to it next time.
 */
export async function startVmLab(options: VmLabOptions): Promise<VmLab> {
  const log = options.log ?? (() => undefined);
  const image = await ensureQemuImage();
  const golden = (await ensureGolden(log, options.golden)).volume;
  const packages = packagesBeyondGolden(options.packages);

  return await startSwitchLab(
    {
      prefix: LAB_PREFIX,
      label: LAB_LABEL,
      runLabel: RUN_LABEL,
      qemuImage: image,
      goldenVolume: golden,
      defaultMemoryMb: DEFAULT_MEMORY_MB,
      overheadMb: CONTAINER_OVERHEAD_MB,
      switchMemoryMb: 128,
      subnetPrefix: '10.77',
    },
    {
      ...options,
      // The golden carries ~6 GiB since the lab speed-ups (platform images, Debian test images): VMs get ≥ 16 GiB
      // root disks (cloud-init grows the file system) so a spec's images still fit.
      vms: options.vms.map((v) => ({ ...v, rootDiskGb: Math.max(v.rootDiskGb ?? 0, MIN_ROOT_DISK_GB) })),
      packages: packages.length ? packages : undefined,
    },
  );
}
