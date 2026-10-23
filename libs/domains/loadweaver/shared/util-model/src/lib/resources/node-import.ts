import { z } from 'zod';

import { resourceNameSchema } from '../metadata';

const portNumber = z.number().int().min(1).max(65535);

/** One step of a join plan, as approved (3.21). Executed in order by the control plane's import controller. */
export const nodeImportStepSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9:._/-]{0,199}$/),
    kind: z.enum([
      'components',
      'wipe-identity',
      'reuse-replicas',
      'activate',
      'precopy',
      'stop',
      'final-sync',
      'release',
      'verify',
      'handover',
    ]),
    description: z.string().max(1024),
    /** `project/deployment` the step belongs to. */
    deployment: z
      .string()
      .regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}$/)
      .optional(),
    /** Source containers (stop, handover). */
    containers: z
      .array(z.string().regex(/^[0-9a-f]{12,64}$/))
      .max(1024)
      .optional(),
    /** Data copies: host directory → replicated volume (`project/deployment/volume`). */
    copies: z
      .array(
        z
          .object({
            source: z.string().regex(/^\/[^\0]{0,4095}$/),
            volume: z.string().regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/),
          })
          .strict(),
      )
      .max(256)
      .optional(),
    /** Ports handed over to the ingress. */
    ports: z
      .array(z.object({ protocol: z.enum(['tcp', 'udp']), port: portNumber }).strict())
      .max(1024)
      .optional(),
    /** Volumes whose former replicas on this node are reused (rejoin of the same cluster). */
    volumes: z
      .array(z.string().regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/))
      .max(4096)
      .optional(),
  })
  .strict();
export type NodeImportStep = z.infer<typeof nodeImportStepSchema>;

/**
 * The join plan of a pending node (3.21): built by the import wizard from the node's discovery and the selections,
 * applied with the deployments it imports in one plan. Applying it makes the node schedulable for its deployments;
 * the import controller then runs the steps (components, activation, data copies with a short stop, release of the
 * imported deployments, port handover). Once per generation, like `Restore`.
 */
export const nodeImportSpecSchema = z
  .object({
    node: resourceNameSchema,
    /** The wizard's selection (`lw_import_selections`) this plan was built from. */
    selection: z.string().uuid(),
    /** The discovery the plan was built from; a newer discovery makes the plan stale. */
    discovery: z.string().uuid(),
    steps: z.array(nodeImportStepSchema).min(1).max(2048),
    /** Explicitly discard the identity and keys of a former, different cluster (3.21). */
    wipeFormerIdentity: z.boolean().default(false),
    /** Ports the node keeps for the host (WireGuard listen ports avoid them). */
    reservedPorts: z
      .object({ tcp: z.array(portNumber).max(4096).default([]), udp: z.array(portNumber).max(4096).default([]) })
      .strict()
      .default({ tcp: [], udp: [] }),
  })
  .strict();
export type NodeImportSpec = z.infer<typeof nodeImportSpecSchema>;
