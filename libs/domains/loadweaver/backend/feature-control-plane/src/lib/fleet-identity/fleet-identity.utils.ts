import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

import type { RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import type { ClusterRole } from '../entities/cluster-member.entity';
import { PROJECT_ROLES, type ProjectRole } from '../entities/project-access.entity';

/**
 * Signed fleet identity (3.24, "Approvals through the fleet"): the fleet sends the acting user as a compact JWS
 * (EdDSA / Ed25519) bound to this cluster, the request (method, URL, body hash), a short lifetime and a nonce. A
 * cluster admin registers the fleet's public keys natively ("trusted fleets"); a verified claim makes the request's
 * acting person `fleet:<iss>:<sub>` with the fleet grant's roles, capped by the service user's own roles.
 */
export const FLEET_IDENTITY_HEADER = 'x-loadweaver-fleet-identity';
/** Version of the claim protocol, reported by `GET /fleet-identity` (feature detection by the fleet). */
export const FLEET_IDENTITY_VERSION = 1;
export const FLEET_CLAIM_MAX_LIFETIME_S = 60;
export const FLEET_CLAIM_SKEW_S = 30;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_PROJECT_GRANTS = 500;
export const MAX_TRUSTED_FLEET_KEYS = 3;

export type FleetGrantRole = 'viewer' | 'operator' | 'admin';
const FLEET_ROLES: readonly FleetGrantRole[] = ['viewer', 'operator', 'admin'];

export const FLEET_ISSUER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const FLEET_KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const SUBJECT_PATTERN = /^[A-Za-z0-9._@:-]{1,128}$/;
const JTI_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const PROJECT_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface FleetIdentityClaims {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  role: FleetGrantRole | null;
  prj?: Record<string, FleetGrantRole>;
  htm: string;
  htu: string;
  bh: string;
  iat: number;
  exp: number;
  jti: string;
}

/** The acting person of a request after a successful verification. */
export interface VerifiedFleetIdentity {
  person: string;
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  role: FleetGrantRole | null;
  projects: Readonly<Record<string, FleetGrantRole>>;
  jti: string;
  expiresAt: Date;
}

export type FleetIdentityRequest = RequestWithUser & {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  /** Raw JSON body (captured by the body parser only when the identity header is present). */
  rawBody?: Buffer;
  fleetIdentity?: VerifiedFleetIdentity;
};

export interface DecodedFleetClaim {
  kid: string;
  claims: FleetIdentityClaims;
  signingInput: string;
  signature: Buffer;
}

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** `fleet:<iss>:<sub>` — how creators / approvers through a fleet are stored. */
export function fleetPersonId(issuer: string, subject: string): string {
  return `fleet:${issuer}:${subject}`;
}

export function isFleetPerson(id: string | null | undefined): boolean {
  return !!id && id.startsWith('fleet:') && id.split(':').length >= 3;
}

/** Base64url SHA-256 of the body bytes the fleet forwarded (empty body → hash of nothing). */
export function fleetBodyHash(body?: Buffer | null): string {
  return createHash('sha256')
    .update(body ?? Buffer.alloc(0))
    .digest('base64url');
}

/** Declared SHA-256 (hex) of a streamed upload (release bundles); checked against the received bytes. */
export const CONTENT_SHA256_HEADER = 'x-loadweaver-content-sha256';

/**
 * Routes that receive a streamed body and verify the declared length + SHA-256 after receipt, so a fleet claim may
 * bind those instead of the body hash (2026-10-27): `METHOD /api/<path>` without the query.
 */
export const FLEET_STREAM_BOUND_ROUTES: ReadonlySet<string> = new Set(['POST /api/updates/bundles']);

/** `stream:<length>:<sha256 hex>` — the fleet's binding of a streamed upload (`fleetStreamBinding` there). */
export function fleetStreamBinding(length: number, sha256Hex: string): string {
  return `stream:${length}:${sha256Hex.toLowerCase()}`;
}

/** The declared length + SHA-256 of a request (`Content-Length`, `X-Loadweaver-Content-SHA256`), or null. */
export function declaredContent(
  headers: Record<string, string | string[] | undefined> | undefined,
): { length: number; sha256: string } | null {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const length = Number(first(headers?.['content-length']));
  const sha256 = first(headers?.[CONTENT_SHA256_HEADER]);

  if (!Number.isSafeInteger(length) || length <= 0 || !sha256 || !/^[0-9a-fA-F]{64}$/.test(sha256)) return null;

  return { length, sha256: sha256.toLowerCase() };
}

/**
 * The body binding a claim of this request must carry: the hash of the raw JSON body, or — on a stream route
 * without a buffered body and with declared length + digest — {@link fleetStreamBinding} (the handler then checks
 * the received bytes against the declaration).
 */
export function expectedBodyBinding(req: FleetIdentityRequest): string {
  if (req.rawBody) return fleetBodyHash(req.rawBody);

  const url = req.originalUrl ?? req.url ?? '';
  const route = `${(req.method ?? '').toUpperCase()} ${url.split('?')[0]}`;
  const declared = FLEET_STREAM_BOUND_ROUTES.has(route) ? declaredContent(req.headers) : null;

  return declared ? fleetStreamBinding(declared.length, declared.sha256) : fleetBodyHash(null);
}

/** The header value of a request (first one when repeated). */
export function fleetIdentityHeader(req: FleetIdentityRequest | undefined): string | undefined {
  const raw = req?.headers?.[FLEET_IDENTITY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;

  return value ? value.trim() : undefined;
}

function isFleetRole(value: unknown): value is FleetGrantRole {
  return typeof value === 'string' && (FLEET_ROLES as readonly string[]).includes(value);
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Structure only (no signature yet): `null` for anything that isn't a well-formed EdDSA JWS with our claims. */
export function decodeFleetClaim(token: string): DecodedFleetClaim | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;

  const parts = token.split('.');

  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;

  const header = decodeJson(parts[0]) as { alg?: unknown; kid?: unknown; typ?: unknown } | null;
  const claims = decodeJson(parts[1]) as Partial<FleetIdentityClaims> | null;

  if (!header || header.alg !== 'EdDSA' || typeof header.kid !== 'string' || !FLEET_KID_PATTERN.test(header.kid))
    return null;

  if (!claims || typeof claims !== 'object') return null;

  const { iss, aud, sub, htm, htu, bh, iat, exp, jti, role, prj, email, email_verified } = claims;

  if (typeof iss !== 'string' || !FLEET_ISSUER_PATTERN.test(iss)) return null;

  if (typeof aud !== 'string' || typeof sub !== 'string' || !SUBJECT_PATTERN.test(sub)) return null;

  if (typeof htm !== 'string' || typeof htu !== 'string' || typeof bh !== 'string') return null;

  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null;

  if (typeof jti !== 'string' || !JTI_PATTERN.test(jti)) return null;

  if (role !== null && !isFleetRole(role)) return null;

  if (prj !== undefined) {
    if (!prj || typeof prj !== 'object' || Array.isArray(prj)) return null;

    const entries = Object.entries(prj);

    if (entries.length > MAX_PROJECT_GRANTS) return null;

    if (entries.some(([p, r]) => !PROJECT_PATTERN.test(p) || !isFleetRole(r))) return null;
  }

  if (email !== undefined && (typeof email !== 'string' || email.length > 320)) return null;

  if (email_verified !== undefined && typeof email_verified !== 'boolean') return null;

  return {
    kid: header.kid,
    claims: claims as FleetIdentityClaims,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], 'base64url'),
  };
}

/** An Ed25519 public key from PEM (SPKI), or null. */
export function ed25519PublicKey(pem: string): KeyObject | null {
  try {
    const key = createPublicKey(pem);

    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

export type FleetClaimCheck = { ok: true; identity: VerifiedFleetIdentity } | { ok: false; reason: string };

/**
 * Everything but the nonce: signature with the trusted key, audience (this cluster), method / URL / body binding and
 * the time window (lifetime ≤ 60 s, 30 s clock skew).
 */
export function checkFleetClaim(
  decoded: DecodedFleetClaim,
  expected: { key: KeyObject; audience: string; method: string; url: string; bodyHash: string; now?: Date },
): FleetClaimCheck {
  const { claims } = decoded;
  const now = Math.floor((expected.now ?? new Date()).getTime() / 1000);

  if (!verifySignature(null, Buffer.from(decoded.signingInput), expected.key, decoded.signature))
    return { ok: false, reason: 'invalid signature' };

  if (claims.aud !== expected.audience) return { ok: false, reason: 'claim is for another cluster' };

  if (claims.htm.toUpperCase() !== expected.method.toUpperCase()) return { ok: false, reason: 'method mismatch' };

  if (claims.htu !== expected.url) return { ok: false, reason: 'URL mismatch' };

  if (claims.bh !== expected.bodyHash) return { ok: false, reason: 'body mismatch' };

  if (claims.exp - claims.iat > FLEET_CLAIM_MAX_LIFETIME_S || claims.exp <= claims.iat)
    return { ok: false, reason: 'claim lifetime too long' };

  if (claims.iat > now + FLEET_CLAIM_SKEW_S) return { ok: false, reason: 'claim issued in the future' };

  if (claims.exp + FLEET_CLAIM_SKEW_S < now) return { ok: false, reason: 'claim expired' };

  return {
    ok: true,
    identity: {
      person: fleetPersonId(claims.iss, claims.sub),
      issuer: claims.iss,
      subject: claims.sub,
      email: claims.email ? claims.email.trim().toLowerCase() : null,
      emailVerified: !!claims.email && claims.email_verified === true,
      role: claims.role,
      projects: { ...(claims.prj ?? {}) },
      jti: claims.jti,
      expiresAt: new Date((claims.exp + FLEET_CLAIM_SKEW_S) * 1000),
    },
  };
}

/** The verified fleet identity of a request (set by the fleet identity interceptor), if any. */
export function fleetIdentityOf(req: RequestWithUser | undefined): VerifiedFleetIdentity | undefined {
  return (req as FleetIdentityRequest | undefined)?.fleetIdentity;
}

/**
 * A fleet registering its own keys (2026-10-29, automatic trust): `PUT /api/trusted-fleets/<issuer>` by a fleet's
 * service user. The identity interceptor leaves this route to {@link TrustedFleetsService.put}, which verifies the
 * claim against the key being registered (proof of possession) instead of the keys already trusted.
 */
export function isTrustedFleetRegistration(req: FleetIdentityRequest | undefined): boolean {
  const path = (req?.originalUrl ?? req?.url ?? '').split('?')[0];

  return (req?.method ?? '').toUpperCase() === 'PUT' && /\/api\/trusted-fleets\/[^/]+\/?$/.test(path);
}

/** PAT callers that may relay for a fleet (`fleet:on-behalf-of`): the fleet's service user. */
export function isFleetRelayCaller(req: RequestWithUser | undefined, scope: string): boolean {
  const user = req?.user;

  return !!user && !req?.apiKeyAuthenticated && (user.amr ?? []).includes('pat') && (user.scopes ?? []).includes(scope);
}

/**
 * Whether the cluster's API key may carry fleet identity claims (2026-10-29, user decision): `on` (default) / `off`
 * (`off`, `false`, `0`, `no`: the API key's claims are ignored, as before).
 */
export const API_KEY_FLEET_DELEGATION_ENV = 'LOADWEAVER_API_KEY_FLEET_DELEGATION';

export function apiKeyFleetDelegationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[API_KEY_FLEET_DELEGATION_ENV] ?? '').trim().toLowerCase();

  return !['off', 'false', '0', 'no'].includes(value);
}

/** The static API key principal (no user, cluster-admin equivalent). */
export function isApiKeyCaller(req: RequestWithUser | undefined): boolean {
  return !!req?.apiKeyAuthenticated;
}

/**
 * Credentials whose fleet identity claims the cluster verifies (3.24): a PAT with `fleet:on-behalf-of`, and — while
 * {@link apiKeyFleetDelegationEnabled} — the cluster's API key (2026-10-29). The claim is verified the same way for
 * both; the person's roles are capped by the credential's own (the API key: cluster admin).
 */
export function mayCarryFleetIdentity(
  req: RequestWithUser | undefined,
  scope: string,
  apiKeyDelegation = apiKeyFleetDelegationEnabled(),
): boolean {
  return isFleetRelayCaller(req, scope) || (apiKeyDelegation && isApiKeyCaller(req));
}

/** Why a credential's claim is ignored (the identity probe's answer, the fleet's "Not in effect" reason). */
export function fleetIdentityIgnoredReason(
  req: RequestWithUser | undefined,
  scope: string,
  apiKeyDelegation = apiKeyFleetDelegationEnabled(),
): string {
  if (isApiKeyCaller(req)) return `API key fleet delegation is off on this cluster (${API_KEY_FLEET_DELEGATION_ENV})`;

  return apiKeyDelegation
    ? `only PATs with ${scope} or the cluster API key send fleet identities`
    : `only PATs with ${scope} send fleet identities`;
}

/**
 * Approvals / acceptances by a fleet's service user need a verified person (3.24): without a claim every decision
 * would be the one service user's, so the two-person rules would mean nothing.
 */
export function assertFleetApprovalIdentity(req: RequestWithUser | undefined, scope: string): void {
  if (isFleetRelayCaller(req, scope) && !fleetIdentityOf(req))
    throw new ForbiddenException(
      'approvals through a fleet need a verified fleet identity: a cluster admin registers the fleet under trusted fleets',
    );
}

/**
 * The backup key's recovery kit through a fleet (2026-10-30: re-issue, share hand-out, confirm) needs a verified
 * person too: the shares would otherwise be handled by the fleet's service credential alone, with nobody named in
 * the kit's audit trail.
 */
export function assertFleetKitIdentity(req: RequestWithUser | undefined, scope: string): void {
  if (isFleetRelayCaller(req, scope) && !fleetIdentityOf(req))
    throw new ForbiddenException(
      'the recovery kit through a fleet needs a verified fleet identity: a cluster admin registers the fleet under trusted fleets',
    );
}

/**
 * Items created through the fleet before identity claims existed carry the service user as creator: they are
 * approved in the cluster's own console only (3.24).
 */
export function assertNotLegacyFleetItem(
  req: RequestWithUser | undefined,
  creator: string | null | undefined,
  serviceUserId: string | undefined,
): void {
  // Through the API key (2026-10-29): items it created without a person are stored as `api-key` (also the fleet's
  // own before API keys carried identities), so a fleet person can't approve them — they may be that person's own.
  const credential = isApiKeyCaller(req) ? 'api-key' : serviceUserId;

  if (fleetIdentityOf(req) && credential && creator && creator === credential)
    throw new ForbiddenException(
      'created through the fleet before identity claims existed: approve it in the cluster’s own console',
    );
}

// ------------------------------------------------------------------------------------------ role capping

const CLUSTER_RANK: Record<ClusterRole, number> = { auditor: 0, 'infra-operator': 1, 'cluster-admin': 2 };
const PROJECT_RANK: Record<ProjectRole, number> = Object.fromEntries(PROJECT_ROLES.map((r, i) => [r, i])) as Record<
  ProjectRole,
  number
>;

/** Fleet grant → cluster role, like the console's mapping (admin → cluster admin, operator → infra operator, …). */
export function fleetClusterRole(role: FleetGrantRole | null | undefined): ClusterRole | undefined {
  if (role === 'admin') return 'cluster-admin';

  if (role === 'operator') return 'infra-operator';

  return role === 'viewer' ? 'auditor' : undefined;
}

export function fleetProjectRole(role: FleetGrantRole | null | undefined): ProjectRole | undefined {
  return role ?? undefined;
}

export function minClusterRole(a: ClusterRole | undefined, b: ClusterRole | undefined): ClusterRole | undefined {
  if (!a || !b) return undefined;

  return CLUSTER_RANK[a] <= CLUSTER_RANK[b] ? a : b;
}

export function minProjectRole(a: ProjectRole | undefined, b: ProjectRole | undefined): ProjectRole | undefined {
  if (!a || !b) return undefined;

  return PROJECT_RANK[a] <= PROJECT_RANK[b] ? a : b;
}

export function maxProjectRole(a: ProjectRole | undefined, b: ProjectRole | undefined): ProjectRole | undefined {
  if (!a) return b;

  if (!b) return a;

  return PROJECT_RANK[a] >= PROJECT_RANK[b] ? a : b;
}

/** The roles a caller holds, as the access services see them. */
export interface CallerRoles {
  clusterRole?: ClusterRole;
  projects: ReadonlyMap<string, ProjectRole>;
  /** A project role in every project (cluster-wide fleet grants). */
  allProjects?: ProjectRole;
}

function serviceProjectRole(base: CallerRoles, project: string): ProjectRole | undefined {
  return base.clusterRole === 'cluster-admin' ? 'admin' : (base.projects.get(project) ?? base.allProjects);
}

/**
 * The fleet person's roles: the fleet grant mapped like the console (cluster-wide operator / viewer act as project
 * operator / viewer everywhere), each capped by the service user's own role — a claim narrows, never widens.
 */
export function capRolesToFleetIdentity(base: CallerRoles, identity: VerifiedFleetIdentity): CallerRoles {
  const clusterRole = minClusterRole(base.clusterRole, fleetClusterRole(identity.role));
  const claimAll = fleetProjectRole(identity.role);
  const serviceAll = base.clusterRole === 'cluster-admin' ? 'admin' : base.allProjects;
  const allProjects = minProjectRole(serviceAll, claimAll);
  const projects = new Map<string, ProjectRole>();

  for (const project of new Set([...base.projects.keys(), ...Object.keys(identity.projects)])) {
    const claimed = maxProjectRole(claimAll, fleetProjectRole(identity.projects[project]));
    const role = minProjectRole(serviceProjectRole(base, project), claimed);

    if (role) projects.set(project, role);
  }

  return { clusterRole, projects, ...(allProjects ? { allProjects } : {}) };
}
