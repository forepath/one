import { z } from 'zod';

/**
 * Device posture (3.31): the report protocol clients (desktop / mobile apps, CLI) send, and the condition syntax
 * client groups use. Shared so the apps and the control plane validate the same shapes.
 */

export const POSTURE_PLATFORMS = ['macos', 'windows', 'linux', 'ios', 'android'] as const;
export type PosturePlatform = (typeof POSTURE_PLATFORMS)[number];

/** Normalized risk levels of EDR integrations, lowest first. */
export const POSTURE_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type PostureRiskLevel = (typeof POSTURE_RISK_LEVELS)[number];

/** Integration categories that conditions address (`mdm.compliant`, `edr.risk <= low`). */
export const POSTURE_CATEGORIES = ['mdm', 'edr'] as const;
export type PostureCategory = (typeof POSTURE_CATEGORIES)[number];

/** Names of posture integrations (cluster settings): `intune`, `crowdstrike-eu`. */
export const POSTURE_INTEGRATION_NAME = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;

/**
 * What a client reports (protocol v1, `POST /vpn/devices/{id}/posture`). Core checks are self-reported; MDM / EDR
 * integrations and device certificates are the independent sources.
 */
export const postureReportSchema = z
  .object({
    platform: z.enum(POSTURE_PLATFORMS),
    osVersion: z.string().regex(VERSION),
    appVersion: z.string().regex(VERSION).optional(),
    diskEncryption: z.boolean().optional(),
    firewall: z.boolean().optional(),
    screenLock: z.boolean().optional(),
    /** MDM / EDR device id (Intune / Entra device id, Defender machine id, CrowdStrike AID, …). */
    deviceId: z
      .string()
      .regex(/^[0-9A-Za-z._:-]{1,128}$/)
      .optional(),
    /** Hardware serial number, the preferred key for matching MDM / EDR records. */
    serialNumber: z
      .string()
      .regex(/^[0-9A-Za-z._-]{1,64}$/)
      .optional(),
    /** The OS hostname (short name or FQDN). */
    hostname: z
      .string()
      .max(253)
      .regex(/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/)
      .optional(),
    /** Device certificate (company CA or the cluster's enrollment CA) with a proof of possession. */
    certificate: z
      .object({
        pem: z.string().min(1).max(16_384),
        proof: z
          .object({
            /** ISO timestamp; accepted within 5 minutes of the control plane's clock. */
            timestamp: z.string().datetime(),
            /** Base64 signature over `postureProofMessage(deviceId, timestamp)` with the certificate's key. */
            signature: z
              .string()
              .max(2_048)
              .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PostureReportInput = z.infer<typeof postureReportSchema>;

/** The message a device signs to prove it holds its certificate's private key. */
export function postureProofMessage(clientId: string, timestamp: string): string {
  return `loadweaver-posture-v1:${clientId}:${timestamp}`;
}

export type PostureConditionOperator = '==' | '!=' | '<=' | '>=' | '<' | '>';

/** A parsed posture condition. */
export type PostureCondition =
  | { kind: 'boolean'; fact: PostureBooleanFact; expected: boolean; text: string }
  | { kind: 'integration-compliant'; category: PostureCategory; integration?: string; expected: boolean; text: string }
  | {
      kind: 'integration-risk';
      category: PostureCategory;
      integration?: string;
      op: PostureConditionOperator;
      value: PostureRiskLevel;
      text: string;
    }
  | {
      kind: 'version';
      fact: 'device.osVersion' | 'device.appVersion';
      op: PostureConditionOperator;
      value: string;
      text: string;
    }
  | {
      kind: 'number';
      fact: 'device.certificate.expiresInDays';
      op: PostureConditionOperator;
      value: number;
      text: string;
    }
  | { kind: 'platform'; op: '==' | '!='; value: PosturePlatform; text: string };

export const POSTURE_BOOLEAN_FACTS = [
  'device.diskEncryption',
  'device.firewall',
  'device.screenLock',
  'device.certificate.valid',
] as const;
export type PostureBooleanFact = (typeof POSTURE_BOOLEAN_FACTS)[number];

const CONDITION = /^\s*([a-z][A-Za-z0-9.-]*)\s*(?:(==|!=|<=|>=|<|>)\s*([A-Za-z0-9.+-]+))?\s*$/;
const ORDERED: readonly PostureConditionOperator[] = ['==', '!=', '<=', '>=', '<', '>'];

function booleanValue(op: string | undefined, value: string | undefined): boolean | string {
  if (!op) return true;

  if ((op !== '==' && op !== '!=') || (value !== 'true' && value !== 'false'))
    return 'boolean facts take `== true|false` or `!= true|false`';

  return (value === 'true') === (op === '==');
}

/**
 * Parses a condition such as `mdm.compliant`, `mdm.intune.compliant`, `edr.risk <= low`,
 * `edr.crowdstrike.risk < high`, `device.certificate.valid`, `device.certificate.expiresInDays >= 14`,
 * `device.osVersion >= 14.5`, `device.platform != linux`, `device.diskEncryption == true`.
 * Returns the condition or an error message.
 */
export function parsePostureCondition(text: string): PostureCondition | string {
  const match = CONDITION.exec(text);

  if (!match) return `invalid condition "${text}"`;

  const [, fact, op, value] = match;
  const trimmed = text.trim();

  if ((POSTURE_BOOLEAN_FACTS as readonly string[]).includes(fact)) {
    const expected = booleanValue(op, value);

    return typeof expected === 'string'
      ? `${fact}: ${expected}`
      : { kind: 'boolean', fact: fact as PostureBooleanFact, expected, text: trimmed };
  }

  if (fact === 'device.osVersion' || fact === 'device.appVersion') {
    if (!op || !value || !VERSION.test(value)) return `${fact} needs a comparison with a version (\`>= 14.5\`)`;

    return { kind: 'version', fact, op: op as PostureConditionOperator, value, text: trimmed };
  }

  if (fact === 'device.certificate.expiresInDays') {
    if (!op || !value || !/^[0-9]{1,4}$/.test(value)) return `${fact} needs a comparison with a number of days`;

    return { kind: 'number', fact, op: op as PostureConditionOperator, value: Number(value), text: trimmed };
  }

  if (fact === 'device.platform') {
    if ((op !== '==' && op !== '!=') || !(POSTURE_PLATFORMS as readonly string[]).includes(value ?? ''))
      return `device.platform takes == or != with one of ${POSTURE_PLATFORMS.join(', ')}`;

    return { kind: 'platform', op, value: value as PosturePlatform, text: trimmed };
  }

  const parts = fact.split('.');
  const category = parts[0] as PostureCategory;

  if ((POSTURE_CATEGORIES as readonly string[]).includes(category) && (parts.length === 2 || parts.length === 3)) {
    const integration = parts.length === 3 ? parts[1] : undefined;
    const attribute = parts[parts.length - 1];

    if (integration !== undefined && !POSTURE_INTEGRATION_NAME.test(integration))
      return `invalid integration name "${integration}"`;

    if (attribute === 'compliant') {
      const expected = booleanValue(op, value);

      if (typeof expected === 'string') return `${fact}: ${expected}`;

      return {
        kind: 'integration-compliant',
        category,
        ...(integration ? { integration } : {}),
        expected,
        text: trimmed,
      };
    }

    if (attribute === 'risk') {
      if (!op || !ORDERED.includes(op as PostureConditionOperator) || !value)
        return `${fact} needs a comparison with a risk level (\`<= low\`)`;

      if (!(POSTURE_RISK_LEVELS as readonly string[]).includes(value))
        return `${fact}: risk levels are ${POSTURE_RISK_LEVELS.join(', ')}`;

      return {
        kind: 'integration-risk',
        category,
        ...(integration ? { integration } : {}),
        op: op as PostureConditionOperator,
        value: value as PostureRiskLevel,
        text: trimmed,
      };
    }
  }

  return `unknown posture fact "${fact}"`;
}

/** A condition string, validated by `parsePostureCondition`. */
export const postureConditionSchema = z
  .string()
  .min(1)
  .max(128)
  .superRefine((text, ctx) => {
    const parsed = parsePostureCondition(text);

    if (typeof parsed === 'string') ctx.addIssue({ code: 'custom', message: parsed });
  });

/** `a op b` for ordered values (compare result of a vs. b). */
export function compareWith(op: PostureConditionOperator, comparison: number): boolean {
  switch (op) {
    case '==':
      return comparison === 0;
    case '!=':
      return comparison !== 0;
    case '<=':
      return comparison <= 0;
    case '>=':
      return comparison >= 0;
    case '<':
      return comparison < 0;
    case '>':
      return comparison > 0;
  }
}

export function riskRank(level: PostureRiskLevel): number {
  return POSTURE_RISK_LEVELS.indexOf(level);
}
