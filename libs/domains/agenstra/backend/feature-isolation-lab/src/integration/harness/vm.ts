import { startUserNetVm, type UserNetVm } from '@forepath/shared/backend/util-vm-lab';

import {
  buildIsolationLabQemuArgs,
  buildIsolationLabRunUserData,
  ISOLATION_LAB_LABEL,
  ISOLATION_LAB_PREFIX,
  type IsolationLabVmOptions,
} from '../../lib/isolation-lab.config';

import { ensureGoldenImage, ensureQemuImage } from './images';

/**
 * A lab VM: the shared VM-lab harness's user-network VM (`@forepath/shared/backend/util-vm-lab`, M7.6) with the
 * isolation lab's golden image (Ubuntu 22.04 + Docker), QEMU arguments, cloud-init and names. Same behaviour as
 * before the shared harness, plus the heavy / VM-lab locks, the memory guard and cleanup on process exit.
 */
export type LabVm = UserNetVm;

/**
 * Start a lab VM: one container per VM (own memory cgroup, `--device /dev/kvm`) running QEMU on a
 * per-run overlay of the golden image. The test process reaches the guest with SSH through the container.
 */
export async function startLabVm(name: string, options: IsolationLabVmOptions = {}): Promise<LabVm> {
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) {
    throw new Error(`Invalid lab VM name: ${name}`);
  }

  const goldenVolume = await ensureGoldenImage();
  const qemuImage = await ensureQemuImage();
  const memoryMb = options.memoryMb ?? 3072;

  return await startUserNetVm(
    {
      prefix: ISOLATION_LAB_PREFIX,
      label: ISOLATION_LAB_LABEL,
      qemuImage,
      goldenVolume,
      diskGb: 30,
      overheadMb: 768,
      sshPort: 2222,
      qemuArgs: (paths) => buildIsolationLabQemuArgs({ ...options, memoryMb, ...paths }),
      userData: (sshPublicKey) => buildIsolationLabRunUserData({ hostname: name, sshPublicKey }),
      // Boot to SSH, then wait for this instance's cloud-init (lab user, keys) to finish.
      readiness: { script: 'cloud-init status --wait >/dev/null 2>&1; systemctl is-active docker', stdout: 'active' },
      bootTimeoutMs: 8 * 60_000,
    },
    name,
    memoryMb,
  );
}
