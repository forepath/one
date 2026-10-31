import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A minimal in-test S3 endpoint with **object-lock semantics** (path style, no authentication). Garage — the only S3
 * the labs run — has no S3 Object Lock, so the lock-specific behaviour of external copies is checked against this
 * fake: it serves the bucket's lock configuration, records the `x-amz-object-lock-*` headers of every upload, reports
 * them on HEAD and refuses deletes of objects still under retention (single and multi-object deletes).
 *
 * Not a real lock-capable S3: versioning, legal holds, governance bypass and retention extension are not modelled, so
 * object lock is NOT lab-verified against a real provider by this fake.
 */
export interface FakeLockedObject {
  body: Buffer;
  etag: string;
  metadata: Record<string, string>;
  mode: string | null;
  retainUntil: Date | null;
  lastModified: Date;
}

export interface FakeObjectLockS3 {
  url: string;
  bucket: string;
  objects: Map<string, FakeLockedObject>;
  /** Every upload with the lock headers it carried. */
  puts: Array<{ key: string; mode: string | null; retainUntil: Date | null }>;
  /** Refused deletes (object key → reason). */
  refusedDeletes: string[];
  /** The bucket's lock configuration; `null` = object lock not enabled on the bucket. */
  lock: { mode: 'COMPLIANCE' | 'GOVERNANCE'; days: number } | null;
  close(): Promise<void>;
}

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Decodes an `aws-chunked` body (chunk signatures and trailers are ignored). */
function decodeChunked(raw: Buffer): Buffer {
  const parts: Buffer[] = [];
  let at = 0;

  while (at < raw.length) {
    const lineEnd = raw.indexOf('\r\n', at);

    if (lineEnd < 0) break;

    const size = parseInt(raw.subarray(at, lineEnd).toString('latin1').split(';')[0], 16);

    if (!size) break;

    parts.push(raw.subarray(lineEnd + 2, lineEnd + 2 + size));
    at = lineEnd + 2 + size + 2;
  }

  return Buffer.concat(parts);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) chunks.push(chunk as Buffer);

  const raw = Buffer.concat(chunks);
  const chunked =
    (req.headers['content-encoding'] ?? '').includes('aws-chunked') ||
    String(req.headers['x-amz-content-sha256'] ?? '').startsWith('STREAMING-');

  return chunked ? decodeChunked(raw) : raw;
}

function error(res: ServerResponse, status: number, code: string, text: string): void {
  res.writeHead(status, { 'content-type': 'application/xml' });
  res.end(xml(`<Error><Code>${code}</Code><Message>${escape(text)}</Message></Error>`));
}

export async function startFakeObjectLockS3(
  bucket: string,
  lock: FakeObjectLockS3['lock'] = { mode: 'COMPLIANCE', days: 1 },
): Promise<FakeObjectLockS3> {
  const state: Omit<FakeObjectLockS3, 'url' | 'close'> = {
    bucket,
    objects: new Map(),
    puts: [],
    refusedDeletes: [],
    lock,
  };
  const locked = (o: FakeLockedObject | undefined) => !!o?.retainUntil && o.retainUntil.getTime() > Date.now();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const [, b, ...rest] = url.pathname.split('/');
    const key = decodeURIComponent(rest.join('/'));
    const body = await readBody(req);

    if (b !== bucket) return error(res, 404, 'NoSuchBucket', b ?? '');

    if (!key) {
      if (req.method === 'GET' && url.searchParams.has('object-lock')) {
        if (!state.lock)
          return error(res, 404, 'ObjectLockConfigurationNotFoundError', 'Object Lock configuration does not exist');

        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          xml(
            `<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention>` +
              `<Mode>${state.lock.mode}</Mode><Days>${state.lock.days}</Days></DefaultRetention></Rule></ObjectLockConfiguration>`,
          ),
        );

        return;
      }

      if (req.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const contents = [...state.objects.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .sort(([a], [z]) => a.localeCompare(z))
          .map(
            ([k, o]) =>
              `<Contents><Key>${escape(k)}</Key><Size>${o.body.length}</Size><ETag>"${o.etag}"</ETag>` +
              `<LastModified>${o.lastModified.toISOString()}</LastModified></Contents>`,
          );

        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          xml(
            `<ListBucketResult><Name>${bucket}</Name><Prefix>${escape(prefix)}</Prefix><KeyCount>${contents.length}</KeyCount>` +
              `<IsTruncated>false</IsTruncated>${contents.join('')}</ListBucketResult>`,
          ),
        );

        return;
      }

      if (req.method === 'POST' && url.searchParams.has('delete')) {
        const keys = [...body.toString('utf8').matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) =>
          m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
        );
        const deleted: string[] = [];
        const errors: string[] = [];

        for (const k of keys) {
          if (locked(state.objects.get(k))) {
            state.refusedDeletes.push(k);
            errors.push(
              `<Error><Key>${escape(k)}</Key><Code>AccessDenied</Code><Message>object is WORM protected</Message></Error>`,
            );
          } else {
            state.objects.delete(k);
            deleted.push(`<Deleted><Key>${escape(k)}</Key></Deleted>`);
          }
        }

        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(xml(`<DeleteResult>${deleted.join('')}${errors.join('')}</DeleteResult>`));

        return;
      }

      return error(res, 501, 'NotImplemented', `${req.method} on the bucket`);
    }

    const object = state.objects.get(key);

    switch (req.method) {
      case 'PUT': {
        const mode = (req.headers['x-amz-object-lock-mode'] as string | undefined) ?? null;
        const until = req.headers['x-amz-object-lock-retain-until-date'] as string | undefined;
        const retainUntil = until ? new Date(until) : null;
        const etag = createHash('md5').update(body).digest('hex');
        const metadata = Object.fromEntries(
          Object.entries(req.headers)
            .filter(([h]) => h.startsWith('x-amz-meta-'))
            .map(([h, v]) => [h.slice('x-amz-meta-'.length), String(v)]),
        );

        if ((mode || retainUntil) && !state.lock)
          return error(res, 400, 'InvalidRequest', 'Bucket is missing Object Lock Configuration');

        state.puts.push({ key, mode, retainUntil });
        state.objects.set(key, { body, etag, metadata, mode, retainUntil, lastModified: new Date() });
        res.writeHead(200, { etag: `"${etag}"` });
        res.end();

        return;
      }
      case 'HEAD':
      case 'GET': {
        if (!object) {
          res.writeHead(404, { 'content-type': 'application/xml' });
          res.end(req.method === 'GET' ? xml('<Error><Code>NoSuchKey</Code></Error>') : undefined);

          return;
        }

        res.writeHead(200, {
          'content-length': String(object.body.length),
          'content-type': 'application/octet-stream',
          etag: `"${object.etag}"`,
          'last-modified': object.lastModified.toUTCString(),
          ...(object.mode ? { 'x-amz-object-lock-mode': object.mode } : {}),
          ...(object.retainUntil ? { 'x-amz-object-lock-retain-until-date': object.retainUntil.toISOString() } : {}),
          ...Object.fromEntries(Object.entries(object.metadata).map(([k, v]) => [`x-amz-meta-${k}`, v])),
        });
        res.end(req.method === 'GET' ? object.body : undefined);

        return;
      }
      case 'DELETE': {
        if (locked(object)) {
          state.refusedDeletes.push(key);

          return error(res, 403, 'AccessDenied', 'object is WORM protected');
        }

        state.objects.delete(key);
        res.writeHead(204);
        res.end();

        return;
      }
      default:
        return error(res, 501, 'NotImplemented', String(req.method));
    }
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => error(res, 500, 'InternalError', String(e)));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const fake = state as FakeObjectLockS3;

  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));

  return fake;
}
