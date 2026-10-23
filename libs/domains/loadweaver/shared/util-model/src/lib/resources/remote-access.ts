import { z } from 'zod';

import { resourceNameSchema } from '../metadata';
import { secretRefSchema } from './edge';
import { postureConditionSchema } from '../posture';
import { cidrStringSchema } from './policy';

/**
 * A group of remote clients (3.31): user devices whose identity-provider groups (role names) map here, and machine
 * clients assigned to it. A normal group in the policy model (`{ clients: <name> }`), so "sales may reach the CRM on
 * 443" is just a policy.
 */
export const clientGroupSpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    /** Identity-provider groups (roles) whose users' devices belong here. */
    idpGroups: z.array(z.string().min(1).max(128)).max(64).default([]),
    /** Device keys expire; renewal needs a fresh login. */
    keyLifetimeDays: z.number().int().min(1).max(365).default(30),
    /** Enrollment and renewal only after a login with a second factor. */
    requireMfa: z.boolean().default(false),
    /** All client traffic through the cluster (and its egress policies) instead of only what the policies allow. */
    fullTunnel: z.boolean().default(false),
    /** Device posture the members must meet; failing devices move to `restrictedGroup` (3.31). */
    posture: z
      .object({
        diskEncryption: z.boolean().optional(),
        firewall: z.boolean().optional(),
        screenLock: z.boolean().optional(),
        /** Minimum OS versions per platform (`14.5`, `10.0.22631`, …). */
        minOsVersion: z
          .partialRecord(
            z.enum(['macos', 'windows', 'linux', 'ios', 'android']),
            z.string().regex(/^[0-9][0-9A-Za-z.+-]{0,31}$/),
          )
          .optional(),
        minAppVersion: z.string().max(32).optional(),
        /**
         * Conditions on core checks, posture integrations (MDM / EDR, cluster settings) and device certificates, all of
         * which must hold: `mdm.compliant`, `mdm.intune.compliant`, `edr.risk <= low`, `device.certificate.valid`,
         * `device.certificate.expiresInDays >= 14`, `device.osVersion >= 14.5`, `device.platform != linux`.
         */
        conditions: z.array(postureConditionSchema).max(32).optional(),
        /**
         * Older form: an integration (by name, else by plugin type) and the verdict it must give. `credentials` is
         * ignored since integrations carry their own (encrypted) configuration.
         */
        plugins: z
          .array(
            z
              .object({
                type: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
                require: z.enum(['compliant', 'low-risk']),
                /** API credentials of the MDM / EDR (`secret://…`). */
                credentials: secretRefSchema.optional(),
              })
              .strict(),
          )
          .max(8)
          .optional(),
      })
      .strict()
      .optional(),
    restrictedGroup: resourceNameSchema.optional(),
  })
  .strict();
export type ClientGroupSpec = z.infer<typeof clientGroupSpecSchema>;

/** Remote access gateways (3.31): the `vpn` node group, its public endpoint and the clients' address space. */
export const clusterRemoteAccessSchema = z
  .object({
    nodeGroup: resourceNameSchema,
    /** One hostname for all clients; resolves to the gateway address (failover IP, anycast or DNS failover). */
    endpoint: z
      .string()
      .max(253)
      .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
    /** `IpPool` (purpose `vpn`) the gateway address comes from. */
    pool: resourceNameSchema,
    /** Client addresses (IPv4). */
    clientNetwork: cidrStringSchema,
    port: z.number().int().min(1024).max(65535).default(51800),
  })
  .strict();
export type ClusterRemoteAccess = z.infer<typeof clusterRemoteAccessSchema>;
