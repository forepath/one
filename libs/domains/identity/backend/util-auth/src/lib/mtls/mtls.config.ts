import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** `Authorization` scheme of certificate assertions (`Authorization: Certificate <jws>`). */
export const MTLS_AUTHORIZATION_SCHEME = 'Certificate';

/** JOSE `typ` every certificate assertion must carry (explicit typing, RFC 8725 §3.11). */
export const MTLS_ASSERTION_TYPE = 'cert-assertion+jwt';

/** Default and upper bound of the assertion lifetime (`exp - iat`, seconds). */
export const MTLS_ASSERTION_DEFAULT_MAX_LIFETIME_SECONDS = 300;
export const MTLS_ASSERTION_MAX_LIFETIME_UPPER_BOUND_SECONDS = 3600;

/** Tolerated clock skew between client and server (seconds). */
export const MTLS_ASSERTION_CLOCK_SKEW_SECONDS = 30;

/** Maximum certificates per chain (leaf + intermediates) accepted from a client. */
export const MTLS_MAX_CHAIN_LENGTH = 5;

/** Thrown for missing or invalid mTLS server configuration (fail at boot / reject every request). */
export class MtlsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MtlsConfigurationError';
  }
}

export interface MtlsConfig {
  /** Trusted client CAs (or pinned self-signed client certificates). */
  trustAnchors: readonly X509Certificate[];
  /** PEM bundle of {@link trustAnchors} (for the TLS listener's `ca` option). */
  trustAnchorsPem: string;
  /** SHA-256 fingerprints (lowercase hex) that may authenticate; `null` → any certificate of a trusted CA. */
  allowedFingerprints: ReadonlySet<string> | null;
  /** Subject common names that may authenticate; `null` → any certificate of a trusted CA. */
  allowedSubjects: ReadonlySet<string> | null;
  /** SHA-256 fingerprints (lowercase hex) that are always rejected (revocation). */
  revokedFingerprints: ReadonlySet<string>;
  /** Maximum `exp - iat` of a certificate assertion (seconds). */
  assertionMaxLifetimeSeconds: number;
  /** When set, certificate assertions must carry this `aud`. */
  assertionAudience?: string;
}

type Env = Record<string, string | undefined>;

/** Normalises a SHA-256 fingerprint (`AB:CD:…`, `abcd…`) to lowercase hex without separators. */
export function normalizeFingerprint(value: string): string {
  return value.replace(/[:\s]/g, '').toLowerCase();
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseFingerprintSet(raw: string | undefined, variable: string): Set<string> {
  const fingerprints = parseList(raw).map(normalizeFingerprint);

  for (const fingerprint of fingerprints) {
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
      throw new MtlsConfigurationError(
        `${variable} must contain SHA-256 fingerprints (64 hex digits), comma-separated.`,
      );
    }
  }

  return new Set(fingerprints);
}

/** Reads `<NAME>` (inline value, `\n` escapes allowed) or `<NAME>_FILE` (path); inline wins. */
export function readPemSetting(env: Env, name: string): string | undefined {
  const inline = env[name]?.trim();

  if (inline) {
    return inline.replace(/\\n/g, '\n');
  }

  const file = env[`${name}_FILE`]?.trim();

  if (!file) {
    return undefined;
  }

  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new MtlsConfigurationError(
      `${name}_FILE (${file}) could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Splits a PEM bundle into certificates; throws when a block is not a valid certificate. */
export function parseCertificateBundle(pem: string, variable: string): X509Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];

  if (blocks.length === 0) {
    throw new MtlsConfigurationError(`${variable} does not contain a PEM certificate.`);
  }

  return blocks.map((block) => {
    try {
      return new X509Certificate(block);
    } catch {
      throw new MtlsConfigurationError(`${variable} contains an invalid certificate.`);
    }
  });
}

/**
 * Resolves the mTLS configuration from environment variables:
 *
 * - `MTLS_CA_CERT` / `MTLS_CA_CERT_FILE` (required): PEM bundle of the CAs that issue API client certificates
 * - `MTLS_ALLOWED_FINGERPRINTS`, `MTLS_ALLOWED_SUBJECTS` (optional): when either is set, a certificate must match one
 *   of the listed SHA-256 fingerprints or subject common names
 * - `MTLS_REVOKED_FINGERPRINTS` (optional): fingerprints that are always rejected
 * - `MTLS_ASSERTION_MAX_LIFETIME` (optional, seconds, default 300, max 3600)
 * - `MTLS_ASSERTION_AUDIENCE` (optional): required `aud` of certificate assertions
 */
export function loadMtlsConfig(env: Env = process.env): MtlsConfig {
  const caPem = readPemSetting(env, 'MTLS_CA_CERT');

  if (!caPem) {
    throw new MtlsConfigurationError(
      'mTLS authentication is configured but MTLS_CA_CERT (or MTLS_CA_CERT_FILE) is not set. Provide the CA that issues API client certificates or use a different AUTHENTICATION_METHOD.',
    );
  }

  const trustAnchors = parseCertificateBundle(caPem, 'MTLS_CA_CERT');
  const allowedFingerprints = parseFingerprintSet(env.MTLS_ALLOWED_FINGERPRINTS, 'MTLS_ALLOWED_FINGERPRINTS');
  const allowedSubjects = new Set(parseList(env.MTLS_ALLOWED_SUBJECTS));
  const revokedFingerprints = parseFingerprintSet(env.MTLS_REVOKED_FINGERPRINTS, 'MTLS_REVOKED_FINGERPRINTS');
  const rawLifetime = env.MTLS_ASSERTION_MAX_LIFETIME?.trim();
  let assertionMaxLifetimeSeconds = MTLS_ASSERTION_DEFAULT_MAX_LIFETIME_SECONDS;

  if (rawLifetime) {
    if (!/^\d+$/.test(rawLifetime)) {
      throw new MtlsConfigurationError('MTLS_ASSERTION_MAX_LIFETIME must be a positive number of seconds.');
    }

    assertionMaxLifetimeSeconds = Number(rawLifetime);

    if (
      assertionMaxLifetimeSeconds < 1 ||
      assertionMaxLifetimeSeconds > MTLS_ASSERTION_MAX_LIFETIME_UPPER_BOUND_SECONDS
    ) {
      throw new MtlsConfigurationError(
        `MTLS_ASSERTION_MAX_LIFETIME must be between 1 and ${MTLS_ASSERTION_MAX_LIFETIME_UPPER_BOUND_SECONDS} seconds.`,
      );
    }
  }

  const assertionAudience = env.MTLS_ASSERTION_AUDIENCE?.trim() || undefined;

  return {
    trustAnchors,
    trustAnchorsPem: trustAnchors.map((certificate) => certificate.toString()).join('\n'),
    allowedFingerprints: allowedFingerprints.size > 0 ? allowedFingerprints : null,
    allowedSubjects: allowedSubjects.size > 0 ? allowedSubjects : null,
    revokedFingerprints,
    assertionMaxLifetimeSeconds,
    ...(assertionAudience ? { assertionAudience } : {}),
  };
}

const MTLS_ENV_KEYS = [
  'MTLS_CA_CERT',
  'MTLS_CA_CERT_FILE',
  'MTLS_ALLOWED_FINGERPRINTS',
  'MTLS_ALLOWED_SUBJECTS',
  'MTLS_REVOKED_FINGERPRINTS',
  'MTLS_ASSERTION_MAX_LIFETIME',
  'MTLS_ASSERTION_AUDIENCE',
] as const;
let cached: { key: string; config: MtlsConfig } | undefined;

/**
 * {@link loadMtlsConfig} for `process.env`, cached until one of the `MTLS_*` variables changes (a CA file's content
 * is read once per process; restart after rotating it).
 */
export function getMtlsConfig(): MtlsConfig {
  const key = JSON.stringify(MTLS_ENV_KEYS.map((name) => process.env[name] ?? null));

  if (cached?.key === key) {
    return cached.config;
  }

  const config = loadMtlsConfig(process.env);

  cached = { key, config };

  return config;
}
