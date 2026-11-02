import { z } from 'zod';

import { labelsSchema, resourceNameSchema } from '../metadata';
import { selectorSchema } from '../selector';

/**
 * Full virtual machines (3.35, kind `VirtualMachine`, project scope): one QEMU instance per resource (no replicas)
 * in the hardened launcher container on a KVM-capable node. Disks are DRBD volumes in block mode (virtio-blk), the
 * boot disk is initialized from an OCI VM image (`vm-image.ts`), first boot is configured through a cloud-init
 * NoCloud seed. Each NIC gets its own address(es) and joins groups / policies like a service.
 */

/** Deployment name the control plane reserves for virtual machines: replicas are `<project>/lw-vm/<name>/0`. */
export const VM_DEPLOYMENT_NAME = 'lw-vm';

export const VM_MAX_DISKS = 8;
export const VM_MAX_NICS = 8;
export const VM_MAX_VCPUS = 64;
export const VM_MIN_MEMORY_BYTES = 256 * 1024 ** 2;

const QUANTITY_UNITS: Record<string, number> = {
  '': 1,
  b: 1,
  k: 1024,
  kb: 1024,
  ki: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mi: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gi: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  ti: 1024 ** 4,
};

const QUANTITY = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]{0,2})$/;

/**
 * A VM byte quantity (`4Gi`, `512Mi`, `20g`, `1048576`) in bytes; all units are binary (`G` = `Gi`). Null if
 * malformed.
 */
export function parseVmQuantity(value: string | number): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;

  const match = QUANTITY.exec(value.trim());

  if (!match) return null;

  const unit = QUANTITY_UNITS[match[2].toLowerCase()];
  const bytes = unit === undefined ? NaN : Math.round(Number(match[1]) * unit);

  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

const quantitySchema = z.union([
  z.string().max(32).regex(QUANTITY, 'invalid size (e.g. 4Gi, 512Mi, 20g)'),
  z.number().int().positive(),
]);

/** An interface name in the guest (`eth0`, `data1`): a Linux interface name (at most 15 characters). */
export const vmNicNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]{0,14}$/, 'must be a lowercase interface name (at most 15 characters)');

export const vmDiskSchema = z
  .object({
    name: resourceNameSchema,
    /** Disk size; the image disk must be at least the image's `virtualSize` (checked at plan time). */
    size: quantitySchema,
    /** `image`: initialized from the VM image (the boot disk, exactly one); `blank`: an empty disk. */
    source: z.enum(['image', 'blank']).default('blank'),
    /** Copies of the disk (DRBD), as for volumes (3.5); default: the cluster's volume default. */
    replicas: z.number().int().min(1).max(5).optional(),
    crossSite: z.enum(['async', 'sync', 'none']).optional(),
    bus: z.literal('virtio').default('virtio'),
    cache: z.enum(['none', 'writeback']).default('none'),
  })
  .strict();
export type VmDisk = z.infer<typeof vmDiskSchema>;

/**
 * A network interface (M7 decision: one or more per VM). Each NIC gets its own address(es) from the pod pools and is
 * a member of the policy model on its own: it belongs to the listed workload groups explicitly, and workload-group
 * selectors match the VM's labels merged with the NIC's `labels`. The first NIC is the primary one (default route,
 * the VM's DNS name).
 */
export const vmNicSchema = z
  .object({
    name: vmNicNameSchema,
    /** Workload groups (of the VM's project) this interface is a member of. */
    groups: z.array(resourceNameSchema).max(16).default([]),
    /** Extra labels of this interface for workload-group selectors (merged over the VM's labels). */
    labels: labelsSchema.optional(),
    /** Address families; default: every family the cluster has a pod pool for. */
    ipv4: z.boolean().optional(),
    ipv6: z.boolean().optional(),
  })
  .strict()
  .refine((nic) => nic.ipv4 !== false || nic.ipv6 !== false, 'a NIC needs at least one address family');
export type VmNic = z.infer<typeof vmNicSchema>;

const secretRefSchema = z.string().regex(/^secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(@\d+)?$/, 'secret reference');

export const vmCloudInitSchema = z
  .object({
    /** `#cloud-config` user data; values may contain `secret://` references (resolved on the node, tmpfs only). */
    userData: z.string().max(65_536).optional(),
    /** User data from a secret instead of inline. */
    userDataSecret: secretRefSchema.optional(),
    sshAuthorizedKeys: z.array(z.string().max(8192)).max(64).optional(),
    /** `auto`: static network config from the allocation (every NIC); `none`: the image configures itself. */
    networkConfig: z.enum(['auto', 'none']).default('auto'),
  })
  .strict()
  .refine((c) => !(c.userData !== undefined && c.userDataSecret !== undefined), {
    message: 'use either userData or userDataSecret',
    path: ['userDataSecret'],
  });
export type VmCloudInit = z.infer<typeof vmCloudInitSchema>;

export const virtualMachineSpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    /** OCI VM image artifact (or a KubeVirt containerDisk image); pinned to its digest at plan time. */
    image: z.string().min(1).max(512),
    /** `bios` is amd64 only. */
    firmware: z.enum(['uefi', 'bios']).default('uefi'),
    cpu: z
      .object({
        vcpus: z.number().int().min(1).max(VM_MAX_VCPUS),
        /** `host-model` migrates across same-vendor nodes; `host-passthrough` pins live migration to identical CPUs. */
        model: z.enum(['host-model', 'host-passthrough']).default('host-model'),
      })
      .strict(),
    memory: quantitySchema,
    disks: z.array(vmDiskSchema).min(1).max(VM_MAX_DISKS),
    nics: z.array(vmNicSchema).min(1).max(VM_MAX_NICS),
    cloudInit: vmCloudInitSchema.optional(),
    placement: z
      .object({ selector: selectorSchema.optional(), spread: z.enum(['node', 'site']).optional() })
      .strict()
      .optional(),
    /** `restartElsewhere: false` pins the VM to its node (no failover on node loss). */
    ha: z
      .object({ restartElsewhere: z.boolean().default(true) })
      .strict()
      .default({ restartElsewhere: true }),
    /** QEMU live migration for planned moves (3.10); freeze budget = the cluster default. */
    liveMigration: z
      .object({ enabled: z.boolean().default(true) })
      .strict()
      .default({ enabled: true }),
    /** `Always`: runs (power via API only reboot / reset); `Manual`: powered via the API; `Halted`: stopped. */
    runStrategy: z.enum(['Always', 'Manual', 'Halted']).default('Always'),
    console: z
      .object({ graphical: z.boolean().default(true) })
      .strict()
      .default({ graphical: true }),
  })
  .strict()
  .superRefine((vm, ctx) => {
    const memory = parseVmQuantity(vm.memory);

    if (memory === null) ctx.addIssue({ code: 'custom', path: ['memory'], message: 'invalid memory size' });
    else if (memory < VM_MIN_MEMORY_BYTES)
      ctx.addIssue({ code: 'custom', path: ['memory'], message: 'a virtual machine needs at least 256Mi of memory' });

    const diskNames = new Set<string>();

    vm.disks.forEach((disk, i) => {
      if (diskNames.has(disk.name))
        ctx.addIssue({ code: 'custom', path: ['disks', i, 'name'], message: `duplicate disk name ${disk.name}` });

      diskNames.add(disk.name);

      if (parseVmQuantity(disk.size) === null)
        ctx.addIssue({ code: 'custom', path: ['disks', i, 'size'], message: 'invalid disk size' });
    });

    const imageDisks = vm.disks.filter((d) => d.source === 'image').length;

    if (imageDisks !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['disks'],
        message: `exactly one disk must have source: image (the boot disk), found ${imageDisks}`,
      });

    const nicNames = new Set<string>();

    vm.nics.forEach((nic, i) => {
      if (nicNames.has(nic.name))
        ctx.addIssue({ code: 'custom', path: ['nics', i, 'name'], message: `duplicate NIC name ${nic.name}` });

      nicNames.add(nic.name);
    });
  });
export type VirtualMachineSpec = z.infer<typeof virtualMachineSpecSchema>;

/** The boot disk (the one with `source: image`). */
export function vmBootDisk(spec: Pick<VirtualMachineSpec, 'disks'>): VmDisk | undefined {
  return spec.disks.find((d) => d.source === 'image');
}

/** Workload id of a VM's single replica: `<project>/lw-vm/<name>/0`. */
export function vmReplicaId(project: string, name: string): string {
  return `${project}/${VM_DEPLOYMENT_NAME}/${name}/0`;
}

/** Volume id of a VM disk: `<project>/lw-vm/<name>.<disk>`. */
export function vmDiskVolumeId(project: string, name: string, disk: string): string {
  return `${project}/${VM_DEPLOYMENT_NAME}/${name}.${disk}`;
}
