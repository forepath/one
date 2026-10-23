import type { VmPower as VmPowerMessage, VmPowerState } from '@forepath/loadweaver/shared/util-agent-protocol';
import { MICROVM_TOOLS_DIR } from '@forepath/shared/backend/util-microvm-bridge';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { BackupJobs, type JobOutput } from '../backups/backup-jobs';
import { DOCKER } from '../host/docker.provider';
import { MANAGED_LABEL } from '../host/managed-containers';
import { VM_LABEL } from '../live/guest-target';
import { WORKLOAD_LABEL } from '../workloads/workload-container';

/** Power and guest-agent actions in a VM's launcher (`vm-ctl`, wraps `virsh` as the VMM user; never user input). */
export const VM_CTL_PATH = `${MICROVM_TOOLS_DIR}/vm-ctl`;
export type VmCtlAction = 'reboot' | 'reset' | 'shutdown' | 'destroy' | 'state' | 'fsfreeze' | 'fsthaw';

/** ACPI reboot / shutdown give the guest time; reset, destroy and state answer at once. */
const ACTION_TIMEOUT_MS = 30_000;
/** `virsh domfsfreeze` waits for the guest agent; without one it fails after its own timeout. */
const FREEZE_TIMEOUT_MS = 60_000;
const STATE_TIMEOUT_MS = 10_000;

/** `virsh domstate` output → the reported power state (`workloadStatus.vm.power`). */
export function parseDomainState(stdout: string): VmPowerState {
  switch (stdout.trim().split('\n')[0]?.trim().toLowerCase()) {
    case 'running':
    case 'idle':
    case 'blocked':
      return 'running';
    case 'paused':
      return 'paused';
    case 'in shutdown':
      return 'shutting-down';
    case 'shut off':
      return 'shut-off';
    case 'crashed':
      return 'crashed';
    case 'pmsuspended':
      return 'suspended';
    default:
      return 'unknown';
  }
}

/**
 * The VM replica a disk volume belongs to: `<project>/lw-vm/<vm>.<disk>` → `<project>/lw-vm/<vm>/0` (VM and disk
 * names are DNS labels, so the first dot separates them); null for other volumes.
 */
export function vmReplicaOfVolume(volumeId: string): string | null {
  const match = /^([a-z0-9-]+)\/lw-vm\/([a-z0-9-]+)\.[a-z0-9-]+$/.exec(volumeId);

  return match ? `${match[1]}/lw-vm/${match[2]}/0` : null;
}

/** Volume id prefix of a VM replica's disks (`<project>/lw-vm/<vm>/0` → `<project>/lw-vm/<vm>.`). */
export function vmDiskPrefix(replica: string): string | null {
  const match = /^([a-z0-9-]+)\/lw-vm\/([a-z0-9-]+)\/0$/.exec(replica);

  return match ? `${match[1]}/lw-vm/${match[2]}.` : null;
}

/**
 * Power of full VMs on this node (3.35): `vmPower` (ACPI reboot / shutdown, hard reset) through `docker exec
 * <launcher> vm-ctl <action>`, the guest's power state for the status report, and the guest agent's fsfreeze / thaw
 * for consistent disk snapshots. Start / stop are not actions: they change the replica's presence (`vm.power`).
 */
@Injectable()
export class VmPower {
  private readonly logger = new Logger(VmPower.name);

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly jobs: BackupJobs,
  ) {}

  /** The running launcher container of a VM replica on this node, if any. */
  async launcherOf(replica: string): Promise<Docker.ContainerInfo | undefined> {
    const containers = await this.docker.listContainers({
      filters: { label: [`${MANAGED_LABEL}=true`, VM_LABEL, `${WORKLOAD_LABEL}=${replica}`], status: ['running'] },
    });

    return containers.find((c) => c.Labels?.[WORKLOAD_LABEL] === replica);
  }

  /** `vm-ctl <action>` in a launcher; throws when it fails or times out. */
  async ctl(containerId: string, action: VmCtlAction, timeoutMs = ACTION_TIMEOUT_MS): Promise<JobOutput> {
    const result = await this.jobs.exec(containerId, [VM_CTL_PATH, action], timeoutMs);

    if (result.exitCode === null) throw new Error(`vm-ctl ${action} timed out after ${Math.round(timeoutMs / 1000)} s`);

    if (result.exitCode !== 0)
      throw new Error(`vm-ctl ${action} failed (exit ${result.exitCode}): ${result.combined.trim().slice(-500)}`);

    return result;
  }

  /**
   * A `vmPower` message: the VM must run here. `destroy` (force-off) powers the domain off without the ACPI grace
   * — also while the launcher is already stopping (its wait loop exits once the domain is gone); a VM that no longer
   * runs here is off already.
   */
  async power(message: VmPowerMessage): Promise<void> {
    const launcher = await this.launcherOf(message.replica);

    if (!launcher && message.action === 'destroy') {
      this.logger.log(`VM ${message.replica}: destroy — not running here (already off)`);

      return;
    }

    if (!launcher) throw new Error(`virtual machine ${message.replica} doesn't run on this node`);

    await this.ctl(launcher.Id, message.action);
    this.logger.log(`VM ${message.replica}: ${message.action}`);
  }

  /** The guest's power state in a running launcher (`unknown` when libvirt doesn't answer, e.g. while booting). */
  async state(containerId: string): Promise<VmPowerState> {
    try {
      return parseDomainState((await this.ctl(containerId, 'state', STATE_TIMEOUT_MS)).stdout);
    } catch {
      return 'unknown';
    }
  }

  /**
   * Freezes the guest's file systems through qemu-guest-agent (consistent snapshots). False when the guest has no
   * (responding) agent: the snapshot is then crash-consistent.
   */
  async freeze(containerId: string): Promise<boolean> {
    try {
      await this.ctl(containerId, 'fsfreeze', FREEZE_TIMEOUT_MS);

      return true;
    } catch (error) {
      this.logger.warn(`fsfreeze failed, the snapshot is crash-consistent: ${(error as Error).message}`);

      return false;
    }
  }

  async thaw(containerId: string): Promise<void> {
    await this.ctl(containerId, 'fsthaw', FREEZE_TIMEOUT_MS);
  }
}
