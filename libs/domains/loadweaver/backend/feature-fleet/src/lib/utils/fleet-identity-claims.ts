import { createHash, createPublicKey, randomBytes, sign, type KeyObject } from 'node:crypto';

import type { FleetRole } from '../constants/fleet.constants';

/**
 * Signed fleet identity (3.24): a compact JWS (EdDSA / Ed25519) the fleet sends with every relayed request it can
 * bind, so a cluster that trusts this fleet's key knows the acting person (`fleet:<iss>:<sub>`) and the fleet grant.
 * The format is the control plane's `fleet-identity.utils.ts` (claim protocol version 1).
 */
export const FLEET_IDENTITY_HEADER = 'x-loadweaver-fleet-identity';
export const FLEET_CLAIM_LIFETIME_S = 60;
/** Bodies the fleet buffers to bind them (the control plane's JSON body limit). */
export const FLEET_CLAIM_MAX_BODY_BYTES = 3 * 1024 * 1024;
/** Subject of the fleet's own probe (`GET /api/fleet-identity`). */
export const FLEET_PROBE_SUBJECT = 'fleet-probe';

/**
 * The identity probe's reasons for a cluster that trusts this fleet but ignores its claims on this connection (the
 * console's "Not in effect"): the credential is a PAT without `fleet:on-behalf-of`, or the API key with delegation off.
 */
const CLAIMS_IGNORED =
  /^(?:only PATs with \S+(?: or the cluster API key)? send fleet identities|API key fleet delegation is off on this cluster(?: \(\S+\))?)$/i;

/** Whether the identity probe says the cluster ignores this connection's claims (trust itself may be in place). */
export function fleetClaimsIgnored(
  health: { identity?: string; identityReason?: string | null } | null | undefined,
): boolean {
  return health?.identity === 'untrusted' && CLAIMS_IGNORED.test(health.identityReason ?? '');
}

export interface FleetClaimInput {
  issuer: string;
  audience: string;
  subject: string;
  email?: string | null;
  emailVerified?: boolean;
  role: FleetRole | null;
  projects?: Readonly<Record<string, FleetRole>>;
  method: string;
  /** `/api/<path>[?<query>]` exactly as forwarded. */
  url: string;
  body?: Buffer | null;
  /** Streamed uploads: the binding instead of the body hash ({@link fleetStreamBinding}). */
  bodyBinding?: string;
}

/** Header with the declared SHA-256 (hex) of a streamed upload; the cluster checks it after receipt. */
export const FLEET_CONTENT_SHA256_HEADER = 'x-loadweaver-content-sha256';

/**
 * Claim body binding of a streamed upload (2026-10-27): the declared length and SHA-256 instead of the hash of
 * buffered bytes, `stream:<length>:<sha256 hex>`. The cluster accepts it only on its stream routes and only when the
 * request's `Content-Length` and `X-Loadweaver-Content-SHA256` match, then verifies the received bytes against both.
 */
export function fleetStreamBinding(length: number, sha256Hex: string): string {
  return `stream:${length}:${sha256Hex.toLowerCase()}`;
}

/** The declared length + digest of a streamed upload, or null when either is missing / malformed. */
export function declaredStreamBody(headers: Record<string, unknown>): { length: number; sha256: string } | null {
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
  const length = Number(first(headers['content-length']));
  const sha256 = first(headers[FLEET_CONTENT_SHA256_HEADER]);

  if (!Number.isSafeInteger(length) || length <= 0 || typeof sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(sha256))
    return null;

  return { length, sha256: sha256.toLowerCase() };
}

export function fleetBodyHash(body?: Buffer | null): string {
  return createHash('sha256')
    .update(body ?? Buffer.alloc(0))
    .digest('base64url');
}

/** The URL a claim binds: `/api/<path>` plus the forwarded query string. */
export function fleetClaimUrl(path: string, query: string): string {
  return `/api/${path.replace(/^\/+/, '')}${query ? `?${query}` : ''}`;
}

/** `SHA256:<base64url>` of an Ed25519 public key (SPKI DER) — the control plane shows the same. */
export function fleetKeyFingerprint(publicKeyPem: string): string {
  return `SHA256:${createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('base64url')}`;
}

export function mintFleetClaim(privateKey: KeyObject, kid: string, input: FleetClaimInput, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const claims = {
    iss: input.issuer,
    aud: input.audience,
    sub: input.subject,
    ...(input.email ? { email: input.email, email_verified: !!input.emailVerified } : {}),
    role: input.role,
    prj: { ...(input.projects ?? {}) },
    htm: input.method.toUpperCase(),
    htu: input.url,
    bh: input.bodyBinding ?? fleetBodyHash(input.body),
    iat,
    exp: iat + FLEET_CLAIM_LIFETIME_S,
    jti: randomBytes(18).toString('base64url'),
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'EdDSA', typ: 'JWT', kid })}.${encode(claims)}`;

  return `${signingInput}.${sign(null, Buffer.from(signingInput), privateKey).toString('base64url')}`;
}

/** Bodies the fleet can bind: none, or JSON (what the control plane parses and hashes). */
export function isClaimableContentType(contentType: unknown): boolean {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;

  return typeof value !== 'string' || value === '' || /^application\/(?:[\w.+-]+\+)?json\b/i.test(value.trim());
}
