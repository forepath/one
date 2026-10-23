import {
  type ExecOptions,
  startSwitchLab,
  type SwitchLab,
  type SwitchLabOptions,
  type SwitchVmSpec,
  type Vm,
} from '@forepath/shared/backend/util-vm-lab';

import { LAB_LABEL, RUN_LABEL } from './docker';
import { ensureGolden, ensureQemuImage, type GoldenVariant } from './golden';

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
export const CONTAINER_OVERHEAD_MB = 700;
/** Prefix of every lab container / volume (`lw-vmlab-<run>-switch`, `lw-vmlab-<run>-<vm>`). */
export const LAB_PREFIX = 'lw-vmlab';

/** Boots the VMs of one lab run; call `stop()` in `afterAll`. */
export async function startVmLab(options: VmLabOptions): Promise<VmLab> {
  const log = options.log ?? (() => undefined);
  const image = await ensureQemuImage();
  const golden = (await ensureGolden(log, options.golden)).volume;

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
    options,
  );
}
