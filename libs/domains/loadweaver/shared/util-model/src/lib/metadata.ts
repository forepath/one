import { z } from 'zod';

/** API version of every declarative Loadweaver resource (YAML `apiVersion`). */
export const LOADWEAVER_API_VERSION = 'loadweaver.com/v1';

/** DNS-label style resource name (RFC 1123), 1-63 characters. */
export const resourceNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'must be a lowercase RFC 1123 label');

/** Label keys allow an optional DNS prefix (`example.com/role`) like compose / Docker labels. */
export const labelKeySchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9.-]*[a-z0-9])?\/)?[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/, 'invalid label key');

export const labelValueSchema = z
  .string()
  .max(63)
  .regex(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)?$/, 'invalid label value');

export const labelsSchema = z.record(labelKeySchema, labelValueSchema);
export type Labels = z.infer<typeof labelsSchema>;

export const resourceMetadataSchema = z.object({
  name: resourceNameSchema,
  /** Owning project; absent for cluster-level resources (3.17). */
  project: resourceNameSchema.optional(),
  labels: labelsSchema.optional(),
  annotations: z.record(z.string().max(253), z.string().max(4096)).optional(),
});
export type ResourceMetadata = z.infer<typeof resourceMetadataSchema>;

/** A stable reference to a resource: `kind/project/name` or `kind/name` for cluster scope. */
export interface ResourceRef {
  kind: string;
  name: string;
  project?: string;
}

export function resourceRefKey(ref: ResourceRef): string {
  return ref.project ? `${ref.kind}/${ref.project}/${ref.name}` : `${ref.kind}/${ref.name}`;
}
