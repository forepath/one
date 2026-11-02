import { z } from 'zod';

import { selectorSchema } from '../selector';

export const VULNERABILITY_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

/** A PEM public key (cosign key pair); verified by the control plane, so only its shape is checked here. */
const publicKeyPem = z
  .string()
  .max(4096)
  .regex(
    /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/,
    'expected a PEM public key',
  );

/**
 * Image policies (3.22): require cosign signatures and / or block vulnerabilities of given severities (Trivy scans on
 * pull and periodically), for the services a selector picks (all of the project's, or of the cluster's for a
 * cluster-wide policy). `monitor` reports only, like everywhere else.
 */
export const imagePolicySpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    mode: z.enum(['enforce', 'monitor']).default('enforce'),
    /** Services by name / labels; none: every service in scope. */
    selector: selectorSchema.optional(),
    requireSignature: z
      .object({ keys: z.array(publicKeyPem).min(1).max(16) })
      .strict()
      .optional(),
    vulnerabilities: z
      .object({
        block: z.array(z.enum(VULNERABILITY_SEVERITIES)).min(1).max(4),
        /** Only vulnerabilities with a fixed version count (nothing to update to otherwise). */
        ignoreUnfixed: z.boolean().default(true),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (p) => !!p.requireSignature || !!p.vulnerabilities,
    'an image policy needs requireSignature or vulnerabilities',
  );
export type ImagePolicySpec = z.infer<typeof imagePolicySpecSchema>;
