import { z } from 'zod';

import { replicaIdSchema, volumeIdSchema } from './live';

/**
 * Full virtual machines on the node stream (3.35, feature `virtual-machines`): power actions the guest handles
 * (ACPI reboot / shutdown, reset) and re-imaging a boot disk. Start / stop are not messages: they change
 * `workloads[].vm.power` in the desired state. Only nodes that advertise `virtual-machines` receive these
 * (`CONTROL_PLANE_MESSAGE_GATES`).
 */

/** `sha256:<64 hex>`. */
export const sha256RefSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** A VM image artifact pinned at plan time: the manifest digest and its disk layer (`vm-image.ts` in util-model). */
export const vmImageRefSchema = z
  .object({
    ref: z.string().max(512),
    digest: sha256RefSchema,
    format: z.enum(['qcow2', 'raw']),
    layerDigest: sha256RefSchema,
  })
  .strict();
export type VmImageRef = z.infer<typeof vmImageRefSchema>;

/** Power actions of `vmPower`. */
export const VM_POWER_ACTIONS = ['reboot', 'reset', 'shutdown', 'destroy'] as const;
export type VmPowerAction = (typeof VM_POWER_ACTIONS)[number];

/**
 * To the node running the VM: `vm-ctl <action>` in its launcher (`virsh reboot | reset | shutdown | destroy`).
 * `destroy` is a hard power-off without the ACPI grace ("force-off").
 */
export const vmPowerSchema = z
  .object({
    replica: replicaIdSchema,
    action: z.enum(VM_POWER_ACTIONS),
  })
  .strict();
export type VmPower = z.infer<typeof vmPowerSchema>;

/**
 * To the node holding the primary of a stopped VM's boot disk ("reimage"): write the image's disk layer onto the
 * block volume again (`qemu-img convert` in the launcher's import mode) and record it as initialized from it.
 */
export const vmImageImportSchema = z
  .object({
    import: z.string().uuid(),
    replica: replicaIdSchema,
    volume: volumeIdSchema,
    image: vmImageRefSchema,
  })
  .strict();
export type VmImageImport = z.infer<typeof vmImageImportSchema>;
