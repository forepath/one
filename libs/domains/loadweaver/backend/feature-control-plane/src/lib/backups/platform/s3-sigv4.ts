import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * AWS Signature Version 4 for the platform-backup S3 gateway (3.20): verifies what WAL-G / OpenSearch send with
 * their gateway credentials and signs the forwarded request with the gateway's own Garage key. Header
 * authentication only (no presigned URLs: none of the clients use them).
 */

export const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256';
export const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
export const STREAMING_SIGNED = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
export const STREAMING_SIGNED_TRAILER = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER';
export const STREAMING_UNSIGNED_TRAILER = 'STREAMING-UNSIGNED-PAYLOAD-TRAILER';
/** Largest accepted difference between the request's `x-amz-date` and the gateway's clock (AWS uses 15 min). */
export const MAX_CLOCK_SKEW_MS = 15 * 60_000;

export type PayloadMode =
  | { kind: 'hash'; sha256: string }
  | { kind: 'unsigned' }
  | { kind: 'streaming'; signed: boolean; trailer: boolean };

export interface ParsedAuthorization {
  accessKeyId: string;
  /** `YYYYMMDD` of the credential scope. */
  date: string;
  region: string;
  service: string;
  signedHeaders: string[];
  signature: string;
}

export class SigV4Error extends Error {
  constructor(
    readonly code: 'AccessDenied' | 'SignatureDoesNotMatch' | 'InvalidAccessKeyId' | 'RequestTimeTooSkewed',
    message: string,
  ) {
    super(message);
  }
}

const AUTH_RE =
  /^AWS4-HMAC-SHA256\s+Credential=([^/\s,]+)\/(\d{8})\/([^/\s,]+)\/([^/\s,]+)\/aws4_request\s*,\s*SignedHeaders=([a-z0-9;\-.]+)\s*,\s*Signature=([0-9a-f]{64})\s*$/;

export function parseAuthorization(header: string | undefined): ParsedAuthorization {
  const match = header ? AUTH_RE.exec(header.trim()) : null;

  if (!match) throw new SigV4Error('AccessDenied', 'missing or malformed SigV4 Authorization header');

  return {
    accessKeyId: match[1],
    date: match[2],
    region: match[3],
    service: match[4],
    signedHeaders: match[5].split(';'),
    signature: match[6],
  };
}

/** RFC 3986 encoding as SigV4 wants it: everything but `A-Za-z0-9-._~` (and `/` in paths). */
export function awsUriEncode(value: string, keepSlash: boolean): string {
  let out = '';

  for (const byte of Buffer.from(value, 'utf8')) {
    const c = String.fromCharCode(byte);

    if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === '/')) out += c;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }

  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new SigV4Error('AccessDenied', 'malformed percent-encoding');
  }
}

/** Canonical URI of an S3 request: the decoded path, encoded once (S3 doesn't double-encode). */
export function canonicalUri(rawPath: string): string {
  return awsUriEncode(safeDecode(rawPath || '/'), true);
}

/** Decoded query parameters in order of appearance (`k` without `=` has the value `''`). */
export function parseQuery(rawQuery: string): [string, string][] {
  if (!rawQuery) return [];

  return rawQuery
    .split('&')
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf('=');

      return eq < 0 ? [safeDecode(part), ''] : [safeDecode(part.slice(0, eq)), safeDecode(part.slice(eq + 1))];
    });
}

export function canonicalQuery(params: [string, string][]): string {
  return params
    .map(([k, v]) => [awsUriEncode(k, false), awsUriEncode(v, false)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export type HeaderBag = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name];

  if (value === undefined) return undefined;

  return (Array.isArray(value) ? value : [value]).map((v) => v.trim().replace(/\s+/g, ' ')).join(',');
}

export interface CanonicalInput {
  method: string;
  rawPath: string;
  rawQuery: string;
  /** Lower-case header names (Node's `IncomingMessage.headers`). */
  headers: HeaderBag;
  signedHeaders: string[];
  payloadHash: string;
}

export function canonicalRequest(input: CanonicalInput): string {
  const headers = input.signedHeaders.map((name) => {
    const value = headerValue(input.headers, name);

    if (value === undefined) throw new SigV4Error('SignatureDoesNotMatch', `signed header ${name} is missing`);

    return `${name}:${value}\n`;
  });

  return [
    input.method.toUpperCase(),
    canonicalUri(input.rawPath),
    canonicalQuery(parseQuery(input.rawQuery)),
    headers.join(''),
    input.signedHeaders.join(';'),
    input.payloadHash,
  ].join('\n');
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

export function credentialScope(date: string, region: string, service: string): string {
  return `${date}/${region}/${service}/aws4_request`;
}

export function stringToSign(amzDate: string, scope: string, canonical: string): string {
  return [SIGV4_ALGORITHM, amzDate, scope, sha256Hex(canonical)].join('\n');
}

export function signatureHex(key: Buffer, toSign: string): string {
  return createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  return left.length === right.length && timingSafeEqual(left, right);
}

/** `20261019T120000Z` → epoch ms (NaN when malformed). */
export function parseAmzDate(value: string | undefined): number {
  const m = value ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value) : null;

  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

export function formatAmzDate(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function payloadMode(contentSha256: string | undefined): PayloadMode {
  switch (contentSha256) {
    case undefined:
      throw new SigV4Error('AccessDenied', 'x-amz-content-sha256 is required');
    case UNSIGNED_PAYLOAD:
      return { kind: 'unsigned' };
    case STREAMING_SIGNED:
      return { kind: 'streaming', signed: true, trailer: false };
    case STREAMING_SIGNED_TRAILER:
      return { kind: 'streaming', signed: true, trailer: true };
    case STREAMING_UNSIGNED_TRAILER:
      return { kind: 'streaming', signed: false, trailer: true };
    default:
      if (/^[0-9a-f]{64}$/.test(contentSha256)) return { kind: 'hash', sha256: contentSha256 };

      throw new SigV4Error('AccessDenied', 'unsupported x-amz-content-sha256');
  }
}

export interface VerifiedRequest {
  accessKeyId: string;
  payload: PayloadMode;
  /** Seed for chunk signatures (the request signature) and the key / scope they are signed with. */
  seedSignature: string;
  signingKey: Buffer;
  scope: string;
  amzDate: string;
}

export interface VerifyInput {
  method: string;
  rawPath: string;
  rawQuery: string;
  headers: HeaderBag;
  /** The secret of the access key named in the request, or null when the key is unknown. */
  secretFor: (accessKeyId: string) => string | null;
  now?: number;
  region?: string;
}

/**
 * Verifies a header-signed S3 request. `host` and `x-amz-date` / `x-amz-content-sha256` must be signed; the
 * credential scope must be for `s3` in the gateway's region and today's (request) date.
 */
export function verifyRequest(input: VerifyInput): VerifiedRequest {
  const auth = parseAuthorization(headerValue(input.headers, 'authorization'));
  const secret = input.secretFor(auth.accessKeyId);

  if (secret === null) throw new SigV4Error('InvalidAccessKeyId', 'unknown access key');

  if (auth.service !== 's3') throw new SigV4Error('AccessDenied', 'credential scope is not for s3');

  if (input.region && auth.region !== input.region)
    throw new SigV4Error('AccessDenied', `credential scope region must be ${input.region}`);

  for (const required of ['host', 'x-amz-date', 'x-amz-content-sha256']) {
    if (!auth.signedHeaders.includes(required))
      throw new SigV4Error('AccessDenied', `${required} must be a signed header`);
  }

  const amzDate = headerValue(input.headers, 'x-amz-date') ?? '';
  const at = parseAmzDate(amzDate);

  if (Number.isNaN(at) || amzDate.slice(0, 8) !== auth.date)
    throw new SigV4Error('AccessDenied', 'x-amz-date is malformed or outside the credential scope');

  if (Math.abs((input.now ?? Date.now()) - at) > MAX_CLOCK_SKEW_MS)
    throw new SigV4Error('RequestTimeTooSkewed', 'request time too skewed');

  const contentSha256 = headerValue(input.headers, 'x-amz-content-sha256');
  const payload = payloadMode(contentSha256);
  const scope = credentialScope(auth.date, auth.region, auth.service);
  const canonical = canonicalRequest({
    method: input.method,
    rawPath: input.rawPath,
    rawQuery: input.rawQuery,
    headers: input.headers,
    signedHeaders: auth.signedHeaders,
    payloadHash: contentSha256 as string,
  });
  const key = signingKey(secret, auth.date, auth.region, auth.service);
  const expected = signatureHex(key, stringToSign(amzDate, scope, canonical));

  if (!constantTimeEqualHex(expected, auth.signature))
    throw new SigV4Error('SignatureDoesNotMatch', 'signature does not match');

  return { accessKeyId: auth.accessKeyId, payload, seedSignature: auth.signature, signingKey: key, scope, amzDate };
}

export interface SignInput {
  method: string;
  /** Encoded path as it will be sent (canonicalised the same way). */
  rawPath: string;
  rawQuery: string;
  host: string;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Extra headers to send and sign (lower-case names), e.g. `content-md5`, `x-amz-copy-source`. */
  headers?: Record<string, string>;
  now?: Date;
}

/** Headers for an upstream request signed with the gateway's key (`authorization`, `x-amz-*`, `host`). */
export function signRequest(input: SignInput): Record<string, string> {
  const amzDate = formatAmzDate(input.now ?? new Date());
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: input.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': input.payloadHash,
  };
  const signedHeaders = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonical = canonicalRequest({
    method: input.method,
    rawPath: input.rawPath,
    rawQuery: input.rawQuery,
    headers,
    signedHeaders,
    payloadHash: input.payloadHash,
  });
  const scope = credentialScope(date, input.region, 's3');
  const signature = signatureHex(
    signingKey(input.secretAccessKey, date, input.region, 's3'),
    stringToSign(amzDate, scope, canonical),
  );

  return {
    ...headers,
    authorization: `${SIGV4_ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  };
}

/** String to sign of one `aws-chunked` chunk (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`). */
export function chunkStringToSign(amzDate: string, scope: string, previousSignature: string, chunk: Buffer): string {
  return ['AWS4-HMAC-SHA256-PAYLOAD', amzDate, scope, previousSignature, EMPTY_SHA256, sha256Hex(chunk)].join('\n');
}

/** String to sign of the trailer of an `aws-chunked` body with trailing checksums. */
export function trailerStringToSign(
  amzDate: string,
  scope: string,
  previousSignature: string,
  trailer: string,
): string {
  return ['AWS4-HMAC-SHA256-TRAILER', amzDate, scope, previousSignature, sha256Hex(trailer)].join('\n');
}
