import { z } from 'zod';

import { isIp } from '@forepath/loadweaver/shared/util-network';

/**
 * Release components on a node (3.26, protocol v2, feature `components`). The control plane sets a node's target
 * release when the update rollout reaches the node; the agent verifies the signed manifest itself (compiled-in release
 * keys) and takes every digest and checksum from it, so a control plane can only choose *which* signed release a node
 * runs, never what is inside it. Only nodes advertising `components` receive the field (`CONTROL_PLANE_FIELD_GATES`).
 */

const releaseVersion = z
  .string()
  .max(64)
  .regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/);
const stepId = z.string().uuid();
const route = z
  .string()
  .max(200)
  .regex(/^\/api(\/[A-Za-z0-9._-]+)+$/);
const componentName = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/);
const ipAddress = z
  .string()
  .max(64)
  .refine((v) => isIp(v), 'invalid IP address');

/** One apt source of the cluster-local snapshot: `deb [signed-by=<keyring>] <cp><aptBase>/<name> <suite> <components>`. */
export const aptSourceSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
    suites: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9.-]{0,40}$/))
      .min(1)
      .max(8),
    components: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/))
      .min(1)
      .max(8),
    /** The distribution's keyring on the host: apt verifies the frozen `InRelease` signatures itself. */
    keyring: z
      .string()
      .max(200)
      .regex(/^\/(usr\/share|etc\/apt)\/keyrings?\/[A-Za-z0-9._-]+\.(gpg|asc)$/),
  })
  .strict();
export type AptSource = z.infer<typeof aptSourceSchema>;

/**
 * A host update step (OS packages, kernel, DRBD module, gVisor): the control plane drained the node first when it
 * needs a reboot. Idempotent per `id`; `reboot` is set once the controller allows this node to restart.
 */
export const hostUpdateSchema = z
  .object({
    id: stepId,
    /** The frozen apt index snapshot (taken at plan time) the node installs from. */
    snapshot: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    aptBase: route,
    sources: z.array(aptSourceSchema).max(16),
    /** Upgrade every installed package to the snapshot's versions (OS security updates), not only the pins. */
    upgrade: z.boolean(),
    /**
     * The cluster is online (not air-gapped: the snapshot came from the upstream archives and bundles aren't
     * upload-only): a kernel without a bundled DRBD compat patch / prebuilt module may build with LINBIT's SPAAS
     * (feature `drbd-spaas`). Absent: offline builds only, uncovered kernels are refused before any change.
     */
    spaas: z.boolean().optional(),
    /** Reboot token: the agent reboots once per token (after reporting), then rejoins. */
    reboot: z.string().uuid().optional(),
  })
  .strict();
export type HostUpdate = z.infer<typeof hostUpdateSchema>;

export const nodeComponentsSchema = z
  .object({
    /** The release this node moves to (images, agent binary, and in host steps gVisor / DRBD / pinned packages). */
    release: releaseVersion,
    /** The release manifest in canonical JSON: exactly the signed bytes. */
    manifest: z.string().max(1024 * 1024),
    /** The signature document (JSON); absent for unsigned development bundles (the agent needs its own opt-in). */
    signature: z.string().max(4096).optional(),
    /** Artifacts by SHA-256: `<artifactBase>/<sha256>` on the control plane. */
    artifactBase: route,
    /** Bundle images were imported into the cluster registry (`lw-system/<component>`): pulled there if upstream fails. */
    clusterImages: z.array(componentName).max(64).optional(),
    host: hostUpdateSchema.optional(),
    /** Coordinated actions (3.26): Patroni switchover to an updated replica before the leader's member updates. */
    actions: z
      .object({
        patroniSwitchover: z.object({ id: stepId, candidate: ipAddress }).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type NodeComponents = z.infer<typeof nodeComponentsSchema>;

/** Progress of the node's last update action. */
export const updateActionSchema = z
  .object({
    id: z.string().max(64),
    kind: z.enum(['self-update', 'host', 'switchover', 'images']),
    phase: z.enum([
      'pending',
      'downloading',
      'installing',
      'building-module',
      'restarting',
      'rebooting',
      'done',
      'failed',
      'rolled-back',
    ]),
    error: z.string().max(2048).optional(),
    at: z.string().datetime(),
  })
  .strict();
export type UpdateAction = z.infer<typeof updateActionSchema>;

/** What the node runs, reported in the hello and every heartbeat (agent → control plane, all optional). */
export const componentVersionsSchema = z
  .object({
    /** Release whose images / agent the node applied; absent before its first release. */
    release: releaseVersion.optional(),
    /** Image of each running platform container by component. */
    images: z.record(componentName, z.string().max(300)).optional(),
    /** Boot id (`/proc/sys/kernel/random/boot_id`): a new one after a reboot. */
    bootId: z.string().max(64).optional(),
    kernel: z.string().max(128).optional(),
    /** A reboot is pending (new kernel installed, `/run/reboot-required`). */
    rebootRequired: z.boolean().optional(),
    /** Versions of the host packages Loadweaver pins (dpkg). */
    packages: z.record(z.string().max(64), z.string().max(100)).optional(),
    gvisor: z.string().max(64).optional(),
    drbd: z.string().max(64).optional(),
    /** Snapshot of the last applied host update. */
    snapshot: z.string().max(64).optional(),
    /**
     * DRBD replication on this node: resources it holds, resyncing ones (a peer catching up, e.g. after a reboot) and
     * degraded ones (a peer missing or a local disk not UpToDate). Rollouts wait for zero before the next node.
     */
    replication: z
      .object({
        volumes: z.number().int().min(0).max(100_000),
        syncing: z.number().int().min(0).max(100_000),
        degraded: z.number().int().min(0).max(100_000),
      })
      .strict()
      .optional(),
    /** Components whose image the node takes from a development override (`LOADWEAVER_*_IMAGE`), not the release. */
    overrides: z.array(componentName).max(64).optional(),
    /** Patroni role on control-plane members. */
    postgres: z.enum(['leader', 'replica', 'unknown']).optional(),
    /** Replication lag of a Patroni replica in bytes (Patroni's `/cluster`); absent on the leader or when unknown. */
    postgresLag: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    /** etcd on members and witnesses: its `/health` and the member count it sees (the rollout's quorum gate). */
    etcd: z
      .object({ healthy: z.boolean(), members: z.number().int().min(0).max(64) })
      .strict()
      .optional(),
    actions: z.array(updateActionSchema).max(8).optional(),
  })
  .strict();
export type ComponentVersions = z.infer<typeof componentVersionsSchema>;
