import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Virtual machines (3.35, M7.3): the operational state the lifecycle API keeps next to the declarative
 * `VirtualMachine` resources — power of `Manual` VMs, node commands (`vmPower`, `vmImageImport`), snapshots (one
 * backup per disk) and VM image imports into the built-in registry.
 */

export const VM_POWER_STATES = ['running', 'stopped'] as const;
export type VmPowerState = (typeof VM_POWER_STATES)[number];

/**
 * Operational state of a VM: power of a `Manual` VM (`start` / `stop` / `force-off`; absent = running) and the
 * cloud-init instance generation (bumped by `reimage`, so cloud-init treats the re-imaged disk as a new instance).
 */
@Entity('lw_vm_power')
export class VmPowerEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 16, name: 'desired' })
  desired!: VmPowerState;

  /** `false` after `force-off`: the guest gets no ACPI grace period (W3 / W9 honour it once supported). */
  @Column({ type: 'boolean', name: 'graceful', default: true })
  graceful!: boolean;

  /** cloud-init `instance-id` generation (`<uid>-<generation>`); starts at 1, `reimage` increments it. */
  @Column({ type: 'integer', name: 'instance_generation', default: 1 })
  instanceGeneration!: number;

  /** `user:<id>`, `api-key`. */
  @Column({ type: 'varchar', length: 255, name: 'changed_by', nullable: true })
  changedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'changed_at' })
  changedAt!: Date;
}

export const VM_COMMAND_TYPES = ['vmPower', 'vmImageImport'] as const;
export type VmCommandType = (typeof VM_COMMAND_TYPES)[number];
/** pending → sent → (running →) succeeded / failed; outcomes come from the agent's events (`vm-command-outcome`). */
export type VmCommandStatus = 'pending' | 'sent' | 'running' | 'succeeded' | 'failed';

/**
 * A node command of a VM: written by the API, sent by whichever control-plane replica holds the node's session
 * (claimed with a conditional update, so exactly one replica sends it). The agent reports the outcome as an event,
 * folded back into `status` / `error`.
 */
@Entity('lw_vm_commands')
@Index('IDX_lw_vm_commands_vm', ['project', 'name', 'createdAt'])
@Index('IDX_lw_vm_commands_status', ['status'])
export class VmCommandEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @Column({ type: 'varchar', length: 63, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  @Column({ type: 'varchar', length: 32, name: 'type' })
  type!: VmCommandType;

  /** The API action (`reboot`, `reset`, `shutdown`, `destroy` (force-off), `reimage`). */
  @Column({ type: 'varchar', length: 32, name: 'action' })
  action!: string;

  /** The message payload (`vmPower` / `vmImageImport`). */
  @Column({ type: 'jsonb', name: 'payload' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: VmCommandStatus;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'requested_by', nullable: true })
  requestedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt!: Date | null;
}

/** A VM snapshot (3.35): one Kopia backup per disk, started together (crash-consistent unless the guest agent freezes). */
@Entity('lw_vm_snapshots')
@Index('IDX_lw_vm_snapshots_vm', ['project', 'name', 'createdAt'])
export class VmSnapshotEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @Column({ type: 'varchar', length: 63, name: 'name' })
  name!: string;

  /** disk → backup id (`lw_backups`). */
  @Column({ type: 'jsonb', name: 'backups' })
  backups!: Record<string, string>;

  /** `application` when the image declares the guest agent (fsfreeze), else `crash`. */
  @Column({ type: 'varchar', length: 16, name: 'consistency' })
  consistency!: 'crash' | 'application';

  @Column({ type: 'varchar', length: 1024, name: 'description', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type VmImageImportStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/**
 * A VM image import (3.35, `POST /projects/:p/vm-images/import`): a background job that downloads a disk image
 * (qcow2, raw, or a KubeVirt containerDisk tar), verifies its sha256 and pushes it into the built-in registry as an
 * OCI VM image artifact `registry.lw/<project>/<repository>:<tag>`.
 */
@Entity('lw_vm_image_imports')
@Index('IDX_lw_vm_image_imports_project', ['project', 'createdAt'])
@Index('IDX_lw_vm_image_imports_status', ['status'])
export class VmImageImportEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  /** Repository inside the project namespace (`debian-13`). */
  @Column({ type: 'varchar', length: 190, name: 'repository' })
  repository!: string;

  @Column({ type: 'varchar', length: 128, name: 'tag' })
  tag!: string;

  @Column({ type: 'varchar', length: 2048, name: 'url' })
  url!: string;

  /** Expected sha256 of the downloaded file (hex). */
  @Column({ type: 'varchar', length: 64, name: 'sha256' })
  sha256!: string;

  @Column({ type: 'varchar', length: 8, name: 'arch' })
  arch!: 'amd64' | 'arm64';

  @Column({ type: 'jsonb', name: 'firmware' })
  firmware!: ('uefi' | 'bios')[];

  @Column({ type: 'boolean', name: 'guest_agent', default: false })
  guestAgent!: boolean;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: VmImageImportStatus;

  /** `download`, `verify`, `convert`, `push` while running. */
  @Column({ type: 'varchar', length: 16, name: 'step', nullable: true })
  step!: string | null;

  /** `qcow2` / `raw`; `containerDisk` sources are recorded with the format of their disk. */
  @Column({ type: 'varchar', length: 8, name: 'format', nullable: true })
  format!: 'qcow2' | 'raw' | null;

  @Column({ type: 'boolean', name: 'container_disk', default: false })
  containerDisk!: boolean;

  @Column({ type: 'bigint', name: 'downloaded_bytes', default: 0 })
  downloadedBytes!: string;

  @Column({ type: 'bigint', name: 'virtual_size', nullable: true })
  virtualSize!: string | null;

  /** Manifest digest once pushed. */
  @Column({ type: 'varchar', length: 71, name: 'digest', nullable: true })
  digest!: string | null;

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'requested_by', nullable: true })
  requestedBy!: string | null;

  /** The control-plane replica running it (stale runs are retried). */
  @Column({ type: 'varchar', length: 128, name: 'worker', nullable: true })
  worker!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'heartbeat_at', nullable: true })
  heartbeatAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;
}

export const VIRTUAL_MACHINE_ENTITIES = [VmPowerEntity, VmCommandEntity, VmSnapshotEntity, VmImageImportEntity];
