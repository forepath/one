import { createHash } from 'node:crypto';
import * as http from 'node:http';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { AwsChunkedDecoder } from './s3-chunked';
import {
  authorize,
  classifyRequest,
  deleteObjectsXml,
  type DeleteObjectsRequest,
  MalformedDeleteXml,
  parseDeleteObjects,
  GATEWAY_REGION,
  MAX_PART_BYTES,
  s3ErrorXml,
  splitPath,
  type GatewayPrincipal,
  type S3Operation,
} from './s3-gateway.rules';
import {
  canonicalQuery,
  canonicalUri,
  parseAuthorization,
  parseQuery,
  sha256Hex,
  signRequest,
  SigV4Error,
  UNSIGNED_PAYLOAD,
  verifyRequest,
  type VerifiedRequest,
} from './s3-sigv4';

/** Where the gateway forwards to: one Garage S3 endpoint and the gateway's own key. */
export interface UpstreamTarget {
  /** `http://host:port` */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface GatewayRefusal {
  principal: GatewayPrincipal | null;
  method: string;
  key: string;
  code: string;
  message: string;
}

export interface S3GatewayOptions {
  resolvePrincipal: (accessKeyId: string) => Promise<(GatewayPrincipal & { secretAccessKey: string }) | null>;
  upstream: () => Promise<UpstreamTarget>;
  /** Whether deletes of these keys are granted to the principal right now (control-plane retention). */
  deleteGranted: (principal: GatewayPrincipal, keys: string[]) => Promise<boolean>;
  /** A reason while client writes must wait (object-store generation switch), else null. */
  writesPaused?: () => Promise<string | null>;
  onRefused?: (refusal: GatewayRefusal) => void;
  region?: string;
  /** Largest `DeleteObjects` body read into memory. */
  maxDeleteBodyBytes?: number;
  now?: () => number;
}

/** Response headers never copied back to the client. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te']);
/** Request headers forwarded (and signed) upstream; the rest is dropped. */
const FORWARDED = [
  'content-type',
  'content-md5',
  'cache-control',
  'content-disposition',
  'content-language',
  'expires',
  'range',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
];

class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Per-key serialisation of "HEAD, then PUT" inside one gateway process: Garage ignores `If-None-Match: *`, so the
 * gateway itself makes the existence check and the write one step.
 */
export class KeyLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);

    this.tails.set(key, tail);

    try {
      await previous;

      return await fn();
    } finally {
      release();

      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  get size(): number {
    return this.tails.size;
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(req: Readable, max: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;

    if (size > max) throw new GatewayError(400, 'EntityTooLarge', 'request body too large');

    parts.push(chunk as Buffer);
  }

  return Buffer.concat(parts);
}

/**
 * The platform-backup S3 gateway (3.20): verifies SigV4 requests of WAL-G / OpenSearch with their gateway
 * credentials, applies the rules (`s3-gateway.rules.ts`), and forwards allowed requests to Garage re-signed with the
 * gateway's key, streaming bodies both ways.
 */
export class S3Gateway {
  readonly locks = new KeyLocks();
  private readonly region: string;

  constructor(private readonly options: S3GatewayOptions) {
    this.region = options.region ?? GATEWAY_REGION;
  }

  /** Node HTTP handler. */
  readonly handler = (req: IncomingMessage, res: ServerResponse): void => {
    void this.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        const e = error instanceof GatewayError ? error : new GatewayError(500, 'InternalError', 'gateway error');

        this.reply(res, e.status, e.code, e.message);
      } else res.destroy();
    });
  };

  createServer(): http.Server {
    const server = http.createServer({ requestTimeout: 0, headersTimeout: 60_000, keepAliveTimeout: 65_000 });

    server.on('request', this.handler);

    return server;
  }

  private reply(res: ServerResponse, status: number, code: string, message: string): void {
    const body = s3ErrorXml(code, message);

    res.writeHead(status, { 'content-type': 'application/xml', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  }

  private refuse(
    res: ServerResponse,
    principal: GatewayPrincipal | null,
    req: IncomingMessage,
    key: string,
    status: number,
    code: string,
    message: string,
  ): void {
    this.options.onRefused?.({ principal, method: req.method ?? '', key, code, message });
    // The request body is never read: drain it so the connection can be reused.
    req.resume();
    this.reply(res, status, code, message);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const q = url.indexOf('?');
    const rawPath = q < 0 ? url : url.slice(0, q);
    const rawQuery = q < 0 ? '' : url.slice(q + 1);
    const method = (req.method ?? 'GET').toUpperCase();
    let principal: (GatewayPrincipal & { secretAccessKey: string }) | null = null;
    let verified: VerifiedRequest;
    let decodedPath: string;
    let query: Map<string, string>;

    try {
      decodedPath = decodeURIComponent(rawPath);
      query = new Map(parseQuery(rawQuery));

      const auth = parseAuthorization(first(req.headers.authorization));

      principal = await this.options.resolvePrincipal(auth.accessKeyId);
      verified = verifyRequest({
        method,
        rawPath,
        rawQuery,
        headers: req.headers,
        secretFor: () => principal?.secretAccessKey ?? null,
        region: this.region,
        now: this.options.now?.(),
      });
    } catch (error) {
      const code = error instanceof SigV4Error ? error.code : 'AccessDenied';
      const message = error instanceof Error ? error.message : 'invalid request';

      return this.refuse(res, principal, req, '', 403, code, message);
    }

    const { bucket, key } = splitPath(decodedPath);
    const op = classifyRequest(method, key, query, { copySource: req.headers['x-amz-copy-source'] !== undefined });
    const decision = authorize(principal as GatewayPrincipal, bucket, op);

    if ('code' in decision)
      return this.refuse(res, principal, req, key, decision.status, decision.code, decision.message);

    const p = principal as GatewayPrincipal & { secretAccessKey: string };
    const writes = op.kind === 'put-object' || op.kind === 'create-multipart' || op.kind === 'upload-part';

    if ((writes || op.kind === 'complete-multipart') && p.role !== 'control-plane') {
      const paused = await this.options.writesPaused?.();

      if (paused) return this.refuse(res, p, req, key, 503, 'SlowDown', paused);
    }

    let bodyLength: number | null = null;

    if (op.kind === 'put-object' || op.kind === 'upload-part') {
      bodyLength = this.objectLength(req, verified);

      if (bodyLength === null)
        return this.refuse(res, p, req, key, 411, 'MissingContentLength', 'content length required');

      if (bodyLength > Math.min(p.maxObjectBytes, MAX_PART_BYTES))
        return this.refuse(res, p, req, key, 400, 'EntityTooLarge', 'object larger than the gateway allows');
    }

    if (op.kind === 'delete-objects') return await this.deleteObjects(req, res, p, verified, rawPath, rawQuery);

    if (decision.needsDeleteGrant && !(await this.options.deleteGranted(p, [key])))
      return this.refuse(res, p, req, key, 403, 'AccessDenied', 'deletes are reserved to the control-plane retention');

    if (!decision.checkOverwrite) return await this.forward(req, res, verified, method, rawPath, rawQuery, bodyLength);

    // HEAD before PUT, atomically per key within this gateway.
    return await this.locks.run(`${bucket}/${key}`, async () => {
      if (await this.exists(rawPath)) {
        return this.refuse(res, p, req, key, 403, 'AccessDenied', 'object exists; overwrite refused by the gateway');
      }

      await this.forward(req, res, verified, method, rawPath, rawQuery, bodyLength, op);
    });
  }

  /** Object size of a PUT body: the decoded length for `aws-chunked`, else `Content-Length`. */
  private objectLength(req: IncomingMessage, verified: VerifiedRequest): number | null {
    const raw =
      verified.payload.kind === 'streaming'
        ? first(req.headers['x-amz-decoded-content-length'])
        : first(req.headers['content-length']);

    if (raw === undefined || !/^\d{1,15}$/.test(raw)) return null;

    return Number(raw);
  }

  private async exists(rawPath: string): Promise<boolean> {
    const res = await this.upstreamRequest('HEAD', rawPath, '', {}, sha256Hex(''), null);

    res.resume();

    if (res.statusCode === 200) return true;

    if (res.statusCode === 404) return false;

    throw new GatewayError(503, 'ServiceUnavailable', `existence check failed (${res.statusCode})`);
  }

  private async upstreamRequest(
    method: string,
    rawPath: string,
    rawQuery: string,
    headers: Record<string, string>,
    payloadHash: string,
    body: Readable | Buffer | null,
  ): Promise<IncomingMessage> {
    const target = await this.options.upstream();
    const base = new URL(target.endpoint);
    const path = canonicalUri(rawPath);
    const queryString = canonicalQuery(parseQuery(rawQuery));
    const signed = signRequest({
      method,
      rawPath: path,
      rawQuery: queryString,
      host: base.host,
      payloadHash,
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
      region: target.region,
      headers,
    });

    return await new Promise<IncomingMessage>((resolve, reject) => {
      const upstream = http.request(
        {
          protocol: base.protocol,
          hostname: base.hostname.replace(/^\[|\]$/g, ''),
          port: base.port,
          method,
          path: queryString ? `${path}?${queryString}` : path,
          headers: signed as OutgoingHttpHeaders,
        },
        resolve,
      );

      upstream.on('error', (error) => reject(new GatewayError(503, 'ServiceUnavailable', error.message)));

      if (body === null) upstream.end();
      else if (Buffer.isBuffer(body)) upstream.end(body);
      else
        void pipeline(body, upstream).catch((error: unknown) => {
          upstream.destroy(error as Error);
          reject(new GatewayError(400, 'IncompleteBody', error instanceof Error ? error.message : 'body failed'));
        });
    });
  }

  private forwardedHeaders(req: IncomingMessage, contentLength: number | null): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const name of FORWARDED) {
      const value = first(req.headers[name]);

      if (value !== undefined) headers[name] = value;
    }

    for (const [name, value] of Object.entries(req.headers)) {
      if (name.startsWith('x-amz-meta-') && typeof value === 'string') headers[name] = value;
    }

    if (contentLength !== null) headers['content-length'] = String(contentLength);

    return headers;
  }

  private async forward(
    req: IncomingMessage,
    res: ServerResponse,
    verified: VerifiedRequest,
    method: string,
    rawPath: string,
    rawQuery: string,
    bodyLength: number | null,
    op?: S3Operation,
  ): Promise<void> {
    let body: Readable | null = null;
    let payloadHash = verified.payload.kind === 'hash' ? verified.payload.sha256 : UNSIGNED_PAYLOAD;
    let contentLength: number | null = null;

    if (verified.payload.kind === 'streaming') {
      contentLength = bodyLength ?? Number(first(req.headers['x-amz-decoded-content-length']) ?? 0);
      body = req.pipe(new AwsChunkedDecoder(verified, verified.payload, contentLength));
      payloadHash = UNSIGNED_PAYLOAD;
    } else {
      const raw = first(req.headers['content-length']);

      contentLength = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;

      if (contentLength !== null && contentLength > 0) body = req;
      else if (method === 'POST' || method === 'PUT') contentLength = contentLength ?? 0;
    }

    if (op?.kind === 'complete-multipart' && body) {
      // Small XML; read so the length is known.
      const xml = await readBody(body, 1024 ** 2);

      if (verified.payload.kind === 'hash' && sha256Hex(xml) !== verified.payload.sha256)
        throw new GatewayError(400, 'XAmzContentSHA256Mismatch', 'payload hash mismatch');

      const upstream = await this.upstreamRequest(
        method,
        rawPath,
        rawQuery,
        this.forwardedHeaders(req, xml.length),
        verified.payload.kind === 'hash' ? payloadHash : sha256Hex(xml),
        xml,
      );

      return await this.relay(upstream, res);
    }

    const upstream = await this.upstreamRequest(
      method,
      rawPath,
      rawQuery,
      this.forwardedHeaders(req, method === 'GET' || method === 'HEAD' || method === 'DELETE' ? null : contentLength),
      payloadHash,
      body ?? (method === 'PUT' || method === 'POST' ? Buffer.alloc(0) : null),
    );

    await this.relay(upstream, res);
  }

  private async relay(upstream: IncomingMessage, res: ServerResponse): Promise<void> {
    const headers: OutgoingHttpHeaders = {};

    for (const [name, value] of Object.entries(upstream.headers)) {
      if (!HOP_BY_HOP.has(name) && value !== undefined) headers[name] = value;
    }

    res.writeHead(upstream.statusCode ?? 502, headers);
    await pipeline(upstream, res);
  }

  /** `POST ?delete`: every named key must be under the principal's prefix and granted. */
  private async deleteObjects(
    req: IncomingMessage,
    res: ServerResponse,
    principal: GatewayPrincipal,
    verified: VerifiedRequest,
    rawPath: string,
    rawQuery: string,
  ): Promise<void> {
    const max = this.options.maxDeleteBodyBytes ?? 2 * 1024 ** 2;
    let xml: Buffer;

    if (verified.payload.kind === 'streaming') {
      const length = Number(first(req.headers['x-amz-decoded-content-length']) ?? NaN);

      if (!Number.isFinite(length)) throw new GatewayError(411, 'MissingContentLength', 'content length required');

      xml = await readBody(req.pipe(new AwsChunkedDecoder(verified, verified.payload, length)), max);
    } else {
      xml = await readBody(req, max);

      if (verified.payload.kind === 'hash' && sha256Hex(xml) !== verified.payload.sha256)
        throw new GatewayError(400, 'XAmzContentSHA256Mismatch', 'payload hash mismatch');
    }

    let request: DeleteObjectsRequest;

    try {
      request = parseDeleteObjects(xml.toString('utf8'));
    } catch (error) {
      if (error instanceof MalformedDeleteXml) throw new GatewayError(400, 'MalformedXML', error.message);

      throw error;
    }

    const keys = request.keys;

    if (
      keys.some((k) => !k.startsWith(principal.prefix)) ||
      (principal.role !== 'control-plane' && !(await this.options.deleteGranted(principal, keys)))
    ) {
      this.options.onRefused?.({
        principal,
        method: 'POST',
        key: keys[0],
        code: 'AccessDenied',
        message: 'multi-object delete refused',
      });

      return this.reply(res, 403, 'AccessDenied', 'deletes are reserved to the control-plane retention');
    }

    // Forward only the body rebuilt from the checked keys, never the client's bytes (M6 review M1).
    const rebuilt = Buffer.from(deleteObjectsXml(request), 'utf8');
    const headers = this.forwardedHeaders(req, rebuilt.length);

    headers['content-type'] = 'application/xml';
    headers['content-md5'] = createHash('md5').update(rebuilt).digest('base64');

    const upstream = await this.upstreamRequest('POST', rawPath, rawQuery, headers, sha256Hex(rebuilt), rebuilt);

    await this.relay(upstream, res);
  }
}
