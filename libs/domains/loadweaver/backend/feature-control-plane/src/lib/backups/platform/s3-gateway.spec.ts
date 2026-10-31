import { createHash } from 'node:crypto';
import * as http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';

import { AwsChunkedDecoder, ChunkedPayloadError } from './s3-chunked';
import { KeyLocks, S3Gateway } from './s3-gateway';
import {
  authorize,
  classifyRequest,
  deleteObjectsKeys,
  deleteObjectsXml,
  MalformedDeleteXml,
  openSearchOverwritable,
  parseDeleteObjects,
  PLATFORM_BUCKET,
  principalFor,
  type GatewayPrincipal,
} from './s3-gateway.rules';
import {
  canonicalRequest,
  chunkStringToSign,
  credentialScope,
  parseQuery,
  sha256Hex,
  signatureHex,
  signingKey,
  signRequest,
  stringToSign,
  verifyRequest,
  type HeaderBag,
} from './s3-sigv4';

const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

describe('SigV4 (AWS documentation vectors)', () => {
  it('reproduces the S3 GET Object example signature', () => {
    const headers: HeaderBag = {
      host: 'examplebucket.s3.amazonaws.com',
      range: 'bytes=0-9',
      'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'x-amz-date': '20130524T000000Z',
    };
    const canonical = canonicalRequest({
      method: 'GET',
      rawPath: '/test.txt',
      rawQuery: '',
      headers,
      signedHeaders: ['host', 'range', 'x-amz-content-sha256', 'x-amz-date'],
      payloadHash: headers['x-amz-content-sha256'] as string,
    });
    const key = signingKey(AWS_SECRET, '20130524', 'us-east-1', 's3');

    expect(
      signatureHex(key, stringToSign('20130524T000000Z', credentialScope('20130524', 'us-east-1', 's3'), canonical)),
    ).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('verifies a request signed by signRequest and rejects tampering, unknown keys and skew', () => {
    const now = new Date('2026-10-19T10:00:00Z');
    const signed = signRequest({
      method: 'PUT',
      rawPath: '/lw-platform/spilo/a b+c',
      rawQuery: 'x-id=PutObject',
      host: '127.0.0.1:7480',
      payloadHash: sha256Hex('hello'),
      accessKeyId: 'AK',
      secretAccessKey: 'secret',
      region: 'garage',
      now,
    });
    const base = {
      method: 'PUT',
      rawPath: '/lw-platform/spilo/a%20b%2Bc',
      rawQuery: 'x-id=PutObject',
      headers: signed,
      secretFor: (id: string) => (id === 'AK' ? 'secret' : null),
      region: 'garage',
      now: now.getTime(),
    };

    expect(verifyRequest(base).payload).toEqual({ kind: 'hash', sha256: sha256Hex('hello') });
    expect(() => verifyRequest({ ...base, rawPath: '/lw-platform/spilo/other' })).toThrow('signature does not match');
    expect(() => verifyRequest({ ...base, secretFor: () => null })).toThrow('unknown access key');
    expect(() => verifyRequest({ ...base, now: now.getTime() + 20 * 60_000 })).toThrow('skewed');
    expect(() => verifyRequest({ ...base, region: 'us-east-1' })).toThrow('region');
  });

  it('sorts and encodes query parameters canonically', () => {
    expect(parseQuery('prefix=a%2Fb&list-type=2&delete')).toEqual([
      ['prefix', 'a/b'],
      ['list-type', '2'],
      ['delete', ''],
    ]);
  });
});

describe('aws-chunked decoder', () => {
  const amzDate = '20130524T000000Z';
  const scope = credentialScope('20130524', 'us-east-1', 's3');
  const key = signingKey(AWS_SECRET, '20130524', 'us-east-1', 's3');
  const seed = '4f232c4386841ef735655705268965c44a0e4690baa4adea153f7db9fa80a0a9';

  function encode(chunks: Buffer[], tamper = false): Buffer {
    let previous = seed;
    const parts: Buffer[] = [];

    for (const chunk of [...chunks, Buffer.alloc(0)]) {
      const signature = signatureHex(key, chunkStringToSign(amzDate, scope, previous, chunk));

      previous = signature;
      parts.push(
        Buffer.from(`${chunk.length.toString(16)};chunk-signature=${signature}\r\n`),
        chunk,
        Buffer.from('\r\n'),
      );
    }

    const body = Buffer.concat(parts);

    if (tamper) body[200] ^= 1;

    return body;
  }

  async function decode(body: Buffer, length: number, split = 1000): Promise<Buffer> {
    const pieces: Buffer[] = [];

    for (let i = 0; i < body.length; i += split) pieces.push(body.subarray(i, i + split));

    const decoder = Readable.from(pieces).pipe(
      new AwsChunkedDecoder(
        { seedSignature: seed, signingKey: key, scope, amzDate },
        { signed: true, trailer: false },
        length,
      ),
    );
    const out: Buffer[] = [];

    for await (const chunk of decoder) out.push(chunk as Buffer);

    return Buffer.concat(out);
  }

  it('matches the AWS chunk-signature example and decodes the payload', async () => {
    const first = Buffer.alloc(65536, 'a');

    expect(signatureHex(key, chunkStringToSign(amzDate, scope, seed, first))).toBe(
      'ad80c730a21e5b8d04586a2213dd63b9a0e99e0e2307b0ade35a65485a288648',
    );

    const body = encode([first, Buffer.alloc(1024, 'a')]);

    expect(body.length).toBe(66824);
    expect((await decode(body, 66560)).equals(Buffer.alloc(66560, 'a'))).toBe(true);
    expect((await decode(body, 66560, 7)).length).toBe(66560);
  });

  it('fails on a tampered chunk, a wrong decoded length and a truncated body', async () => {
    const chunks = [Buffer.alloc(5000, 'x')];

    await expect(decode(encode(chunks, true), 5000)).rejects.toThrow(ChunkedPayloadError);
    await expect(decode(encode(chunks), 4000)).rejects.toThrow(ChunkedPayloadError);
    await expect(decode(encode(chunks).subarray(0, 3000), 5000)).rejects.toThrow('ended early');
  });
});

describe('gateway rules', () => {
  const pg = principalFor('postgres', 'AKPG', 'n1');
  const os = principalFor('opensearch', 'AKOS', 'n1');
  const cp = principalFor('control-plane', 'AKCP', null);
  const op = (method: string, key: string, query: Record<string, string> = {}, copySource = false) =>
    classifyRequest(method, key, new Map(Object.entries(query)), { copySource });

  it('classifies S3 operations', () => {
    expect(op('PUT', 'k')).toEqual({ kind: 'put-object', key: 'k' });
    expect(op('PUT', 'k', { partNumber: '1', uploadId: 'u' })).toEqual({ kind: 'upload-part', key: 'k' });
    expect(op('POST', 'k', { uploads: '' })).toEqual({ kind: 'create-multipart', key: 'k' });
    expect(op('POST', 'k', { uploadId: 'u' })).toEqual({ kind: 'complete-multipart', key: 'k' });
    expect(op('DELETE', 'k', { uploadId: 'u' })).toEqual({ kind: 'abort-multipart', key: 'k' });
    expect(op('DELETE', 'k')).toEqual({ kind: 'delete-object', key: 'k' });
    expect(op('POST', '', { delete: '' })).toEqual({ kind: 'delete-objects' });
    expect(op('GET', '', { 'list-type': '2', prefix: 'spilo/' })).toEqual({ kind: 'list-objects', prefix: 'spilo/' });
    expect(op('PUT', 'k', {}, true).kind).toBe('unsupported');
    expect(op('PUT', 'k', { acl: '' }).kind).toBe('unsupported');
    expect(op('GET', '', { policy: '' }).kind).toBe('unsupported');
    expect(op('PUT', '').kind).toBe('unsupported');
  });

  it('confines clients to their prefix and bucket', () => {
    expect(authorize(pg, PLATFORM_BUCKET, op('PUT', 'spilo/c/wal/17/wal_005/1')).allow).toBe(true);
    expect(authorize(pg, PLATFORM_BUCKET, op('PUT', 'opensearch/c/x')).allow).toBe(false);
    expect(authorize(pg, PLATFORM_BUCKET, op('PUT', 'dr-envelope/x.json')).allow).toBe(false);
    expect(authorize(pg, PLATFORM_BUCKET, op('PUT', 'spilo/../etcd/x')).allow).toBe(false);
    expect(authorize(pg, 'lw-registry', op('GET', 'spilo/x')).allow).toBe(false);
    expect(authorize(pg, PLATFORM_BUCKET, op('GET', '', { prefix: '' })).allow).toBe(false);
    expect(authorize(os, PLATFORM_BUCKET, op('GET', '', { prefix: 'opensearch/c/' })).allow).toBe(true);
    expect(authorize(cp, PLATFORM_BUCKET, op('PUT', 'etcd/x')).allow).toBe(true);
  });

  it('checks overwrites except for whitelisted OpenSearch blobs and the control plane', () => {
    expect(authorize(pg, PLATFORM_BUCKET, op('PUT', 'spilo/c/wal/17/wal_005/1'))).toMatchObject({
      checkOverwrite: true,
    });
    expect(authorize(os, PLATFORM_BUCKET, op('PUT', 'opensearch/c/index.latest'))).toMatchObject({
      checkOverwrite: false,
    });
    expect(authorize(os, PLATFORM_BUCKET, op('PUT', 'opensearch/c/index-3'))).toMatchObject({ checkOverwrite: true });
    expect(authorize(os, PLATFORM_BUCKET, op('POST', 'opensearch/c/indices/x/0/__a', { uploadId: 'u' }))).toMatchObject(
      {
        checkOverwrite: true,
      },
    );
    expect(openSearchOverwritable('opensearch/c/incompatible-snapshots')).toBe(true);
    expect(openSearchOverwritable('opensearch/c/indices/index.latest')).toBe(false);
    expect(authorize(cp, PLATFORM_BUCKET, op('PUT', 'etcd/x'))).toMatchObject({ checkOverwrite: false });
  });

  it('needs a delete grant for client deletes, not for the control plane', () => {
    expect(authorize(pg, PLATFORM_BUCKET, op('DELETE', 'spilo/x'))).toMatchObject({ needsDeleteGrant: true });
    expect(authorize(cp, PLATFORM_BUCKET, op('DELETE', 'spilo/x'))).toMatchObject({ needsDeleteGrant: false });
    expect(
      deleteObjectsKeys('<Delete><Object><Key>a&amp;b</Key></Object><Object><Key>c</Key></Object></Delete>'),
    ).toEqual(['a&b', 'c']);
  });

  it('parses DeleteObjects bodies strictly and rebuilds them from the checked keys (M6 review M1)', () => {
    const ns = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';

    expect(
      parseDeleteObjects(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Delete ${ns}>\n  <Quiet>true</Quiet>\n  <Object>\n    <Key>opensearch/c/a&lt;b&#x41;</Key>\n  </Object>\n</Delete>\n`,
      ),
    ).toEqual({ keys: ['opensearch/c/a<bA'], quiet: true });

    const smuggle = (body: string) => expect(() => parseDeleteObjects(body)).toThrow(MalformedDeleteXml);
    const obj = (inner: string) => `<Delete><Object>${inner}</Object></Delete>`;

    // Variants a regex extraction would read differently than Garage's XML parser.
    smuggle(obj('<Key >spilo/x</Key>'));
    smuggle(obj('<Key a="1">spilo/x</Key>'));
    smuggle(obj('<s3:Key>spilo/x</s3:Key>'));
    smuggle(
      '<Delete xmlns:s3="http://s3.amazonaws.com/doc/2006-03-01/"><Object><s3:Key>spilo/x</s3:Key></Object></Delete>',
    );
    smuggle(obj('<Key>opensearch/<!-- c -->x</Key>'));
    smuggle(obj('<!-- <Key>opensearch/x</Key> --><Key>spilo/x</Key>'));
    smuggle(obj('<Key><![CDATA[spilo/x]]></Key>'));
    smuggle(obj('<Key>&ext;</Key>'));
    smuggle('<!DOCTYPE d [<!ENTITY e "spilo/x">]><Delete><Object><Key>&e;</Key></Object></Delete>');
    smuggle(obj('<Key>opensearch/x</Key><Key>spilo/x</Key>'));
    smuggle(obj('<Key>opensearch/x</Key><VersionId>v1</VersionId>'));
    smuggle(
      `<Delete ${ns}><Object><Key>opensearch/x</Key></Object><Object><Key>spilo/x</Key></Object><Extra/></Delete>`,
    );
    smuggle(
      `<Delete><Object><Key>opensearch/x</Key></Object></Delete><Delete><Object><Key>spilo/x</Key></Object></Delete>`,
    );
    smuggle('<Delete xmlns="urn:other"><Object><Key>x</Key></Object></Delete>');
    smuggle('<?xml-stylesheet href="x"?><Delete><Object><Key>x</Key></Object></Delete>');
    smuggle(obj('<Key>opensearch/../spilo/x</Key>'));
    smuggle(obj('<Key>opensearch/&#0;x</Key>'));
    smuggle(obj('<Key>opensearch/&#x110000;</Key>'));
    smuggle('<Delete><Quiet>yes</Quiet><Object><Key>x</Key></Object></Delete>');
    smuggle('<Delete></Delete>');

    const rebuilt = deleteObjectsXml({ keys: ['opensearch/a&b', 'opensearch/<c>'], quiet: false });

    expect(rebuilt).toContain('<Key>opensearch/a&amp;b</Key>');
    expect(parseDeleteObjects(rebuilt)).toEqual({ keys: ['opensearch/a&b', 'opensearch/<c>'], quiet: false });
  });

  it('serialises work per key', async () => {
    const locks = new KeyLocks();
    const order: string[] = [];
    const slow = locks.run('k', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('first');
    });
    const fast = locks.run('k', async () => order.push('second'));

    await Promise.all([slow, fast]);
    expect(order).toEqual(['first', 'second']);
    expect(locks.size).toBe(0);
  });
});

/** In-memory "Garage": verifies the gateway's signatures and stores objects. */
function fakeGarage(secret: string) {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  const seen: string[] = [];
  const server = http.createServer(async (req: IncomingMessage, res) => {
    const url = req.url ?? '/';
    const [rawPath, rawQuery = ''] = url.split('?');
    const chunks: Buffer[] = [];

    for await (const c of req) chunks.push(c as Buffer);

    const body = Buffer.concat(chunks);

    try {
      const verified = verifyRequest({
        method: req.method ?? 'GET',
        rawPath,
        rawQuery,
        headers: req.headers,
        secretFor: (id) => (id === 'GKgateway' ? secret : null),
      });

      if (verified.payload.kind === 'hash' && sha256Hex(body) !== verified.payload.sha256) throw new Error('hash');
    } catch (error) {
      res.writeHead(403).end(String(error));

      return;
    }

    const path = decodeURIComponent(rawPath).replace(/^\/lw-platform\/?/, '');
    const query = new Map(parseQuery(rawQuery));

    seen.push(`${req.method} ${path}${rawQuery ? `?${rawQuery}` : ''}`);

    if (req.method === 'PUT' && query.has('uploadId')) {
      uploads.get(query.get('uploadId') as string)?.parts.set(Number(query.get('partNumber')), body);
      res.writeHead(200, { etag: `"${createHash('md5').update(body).digest('hex')}"` }).end();
    } else if (req.method === 'PUT') {
      objects.set(path, body);
      res.writeHead(200, { etag: '"e"' }).end();
    } else if (req.method === 'POST' && query.has('uploads')) {
      const id = `u${uploads.size}`;

      uploads.set(id, { key: path, parts: new Map() });
      res
        .writeHead(200, { 'content-type': 'application/xml' })
        .end(
          `<InitiateMultipartUploadResult><Bucket>lw-platform</Bucket><Key>${path}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
        );
    } else if (req.method === 'POST' && query.has('uploadId')) {
      const upload = uploads.get(query.get('uploadId') as string);

      objects.set(
        path,
        Buffer.concat([...(upload?.parts.entries() ?? [])].sort(([a], [b]) => a - b).map(([, b]) => b)),
      );
      res
        .writeHead(200, { 'content-type': 'application/xml' })
        .end(`<CompleteMultipartUploadResult><Key>${path}</Key><ETag>"x"</ETag></CompleteMultipartUploadResult>`);
    } else if (req.method === 'POST' && query.has('delete')) {
      for (const k of deleteObjectsKeys(body.toString())) objects.delete(k);
      res.writeHead(200, { 'content-type': 'application/xml' }).end('<DeleteResult></DeleteResult>');
    } else if (req.method === 'DELETE') {
      objects.delete(path);
      res.writeHead(204).end();
    } else if (path === '' && req.method === 'GET') {
      const prefix = query.get('prefix') ?? '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();

      res
        .writeHead(200, { 'content-type': 'application/xml' })
        .end(
          `<ListBucketResult><Name>lw-platform</Name><Prefix>${prefix}</Prefix><KeyCount>${keys.length}</KeyCount><IsTruncated>false</IsTruncated>${keys
            .map((k) => `<Contents><Key>${k}</Key><Size>${objects.get(k)?.length}</Size></Contents>`)
            .join('')}</ListBucketResult>`,
        );
    } else if (objects.has(path)) {
      const data = objects.get(path) as Buffer;

      res.writeHead(200, { 'content-length': data.length, etag: '"e"' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } else {
      res
        .writeHead(404, { 'content-type': 'application/xml' })
        .end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
    }
  });

  return { server, objects, seen };
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('S3 gateway end to end (AWS SDK client → gateway → fake Garage)', () => {
  const garage = fakeGarage('upstream-secret');
  const principals = new Map<string, GatewayPrincipal & { secretAccessKey: string }>([
    ['AKPG', { ...principalFor('postgres', 'AKPG', 'n1'), secretAccessKey: 'pg-secret' }],
    ['AKOS', { ...principalFor('opensearch', 'AKOS', 'n1', 1024 * 1024), secretAccessKey: 'os-secret' }],
  ]);
  let grant = false;
  let paused: string | null = null;
  const refusals: string[] = [];
  const gateway = new S3Gateway({
    resolvePrincipal: async (id) => principals.get(id) ?? null,
    upstream: async () => ({
      endpoint: garageUrl,
      accessKeyId: 'GKgateway',
      secretAccessKey: 'upstream-secret',
      region: 'garage',
    }),
    deleteGranted: async () => grant,
    writesPaused: async () => paused,
    onRefused: (r) => refusals.push(`${r.code}:${r.key}`),
  });
  const server = gateway.createServer();
  let garageUrl = '';
  let gatewayUrl = '';
  const client = (id: string, secret: string) =>
    new S3Client({
      endpoint: gatewayUrl,
      region: 'garage',
      forcePathStyle: true,
      credentials: { accessKeyId: id, secretAccessKey: secret },
      maxAttempts: 1,
    });
  let pg: S3Client;
  let os: S3Client;

  beforeAll(async () => {
    garageUrl = await listen(garage.server);
    gatewayUrl = await listen(server);
    pg = client('AKPG', 'pg-secret');
    os = client('AKOS', 'os-secret');
  });

  afterAll(async () => {
    pg.destroy();
    os.destroy();
    await new Promise((r) => server.close(r));
    await new Promise((r) => garage.server.close(r));
  });

  it('writes a new object, reads, heads and lists it', async () => {
    await pg.send(
      new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/wal/17/wal_005/0001', Body: 'segment-1' }),
    );

    expect(garage.objects.get('spilo/c/wal/17/wal_005/0001')?.toString()).toBe('segment-1');

    const got = await pg.send(new GetObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/wal/17/wal_005/0001' }));

    expect(await got.Body?.transformToString()).toBe('segment-1');
    await pg.send(new HeadObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/wal/17/wal_005/0001' }));

    const list = await pg.send(new ListObjectsV2Command({ Bucket: PLATFORM_BUCKET, Prefix: 'spilo/c/' }));

    expect(list.Contents?.map((c) => c.Key)).toEqual(['spilo/c/wal/17/wal_005/0001']);
  });

  it('refuses an overwrite of an existing WAL segment', async () => {
    await expect(
      pg.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/wal/17/wal_005/0001', Body: 'evil' })),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
    expect(garage.objects.get('spilo/c/wal/17/wal_005/0001')?.toString()).toBe('segment-1');
  });

  it('refuses concurrent first writes of the same key except one', async () => {
    const results = await Promise.allSettled(
      ['a', 'b', 'c'].map((v) =>
        pg.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/wal/17/wal_005/0002', Body: v })),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('allows the OpenSearch index.latest overwrite but not index-N', async () => {
    for (const v of ['1', '2']) {
      await os.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'opensearch/c/index.latest', Body: v }));
    }

    expect(garage.objects.get('opensearch/c/index.latest')?.toString()).toBe('2');
    await os.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'opensearch/c/index-0', Body: 'x' }));
    await expect(
      os.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'opensearch/c/index-0', Body: 'y' })),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('refuses deletes without a grant and allows them during retention', async () => {
    await expect(
      pg.send(new DeleteObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/wal/17/wal_005/0001' })),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
    await expect(
      os.send(
        new DeleteObjectsCommand({ Bucket: PLATFORM_BUCKET, Delete: { Objects: [{ Key: 'opensearch/c/index-0' }] } }),
      ),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
    expect(garage.objects.has('spilo/c/wal/17/wal_005/0001')).toBe(true);

    grant = true;

    try {
      // Keys outside the client's prefix stay refused even with a grant.
      await expect(
        os.send(new DeleteObjectsCommand({ Bucket: PLATFORM_BUCKET, Delete: { Objects: [{ Key: 'spilo/c/x' }] } })),
      ).rejects.toMatchObject({ name: 'AccessDenied' });
      await os.send(
        new DeleteObjectsCommand({ Bucket: PLATFORM_BUCKET, Delete: { Objects: [{ Key: 'opensearch/c/index-0' }] } }),
      );
      await pg.send(new DeleteObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/wal/17/wal_005/0001' }));
    } finally {
      grant = false;
    }

    expect(garage.objects.has('opensearch/c/index-0')).toBe(false);
    expect(garage.objects.has('spilo/c/wal/17/wal_005/0001')).toBe(false);
  });

  it('refuses other prefixes, buckets, wrong secrets, oversized objects and paused writes', async () => {
    await expect(
      os.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/x', Body: 'x' })),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
    await expect(pg.send(new GetObjectCommand({ Bucket: 'lw-registry', Key: 'spilo/x' }))).rejects.toMatchObject({
      name: 'AccessDenied',
    });

    const wrong = client('AKPG', 'nope');

    await expect(
      wrong.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/y', Body: 'x' })),
    ).rejects.toMatchObject({ name: 'SignatureDoesNotMatch' });
    wrong.destroy();
    await expect(
      os.send(
        new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'opensearch/c/big', Body: Buffer.alloc(2 * 1024 * 1024) }),
      ),
    ).rejects.toMatchObject({ name: 'EntityTooLarge' });

    paused = 'object store generation switch';

    try {
      await expect(
        pg.send(new PutObjectCommand({ Bucket: PLATFORM_BUCKET, Key: 'spilo/c/z', Body: 'x' })),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 503 } });
    } finally {
      paused = null;
    }

    expect(refusals.length).toBeGreaterThan(0);
  });

  it('streams multipart uploads and refuses completing over an existing key', async () => {
    const key = 'spilo/c/wal/17/basebackups_005/base_1/tar_partitions/part_1.tar.br';
    const parts = [Buffer.alloc(5 * 1024 * 1024, 7), Buffer.alloc(1024 * 1024, 8)];
    const multipart = async () => {
      const { UploadId } = await pg.send(new CreateMultipartUploadCommand({ Bucket: PLATFORM_BUCKET, Key: key }));
      const etags: string[] = [];

      for (const [i, body] of parts.entries()) {
        const part = await pg.send(
          new UploadPartCommand({ Bucket: PLATFORM_BUCKET, Key: key, UploadId, PartNumber: i + 1, Body: body }),
        );

        etags.push(part.ETag as string);
      }

      await pg.send(
        new CompleteMultipartUploadCommand({
          Bucket: PLATFORM_BUCKET,
          Key: key,
          UploadId,
          MultipartUpload: { Parts: etags.map((ETag, i) => ({ ETag, PartNumber: i + 1 })) },
        }),
      );
    };

    await multipart();
    expect(garage.objects.get(key)?.equals(Buffer.concat(parts))).toBe(true);
    await expect(multipart()).rejects.toMatchObject({ name: 'AccessDenied' });
  });
});
