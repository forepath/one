import { IS_PUBLIC_KEY } from '@forepath/identity/backend';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import {
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

import { FleetCatalogController, readRawBody, sendServed } from './fleet-catalog.controller';

function request(body: Buffer, headers: Record<string, string>): IncomingMessage {
  const stream = Readable.from([body]) as unknown as IncomingMessage;

  stream.headers = headers;

  return stream;
}

function response() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    body: undefined as Buffer | undefined,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    end: jest.fn((b?: Buffer) => {
      res.body = b;
    }),
    headers,
  };

  return res;
}

describe('FleetCatalogController', () => {
  describe('readRawBody', () => {
    it('reads a gzip body', async () => {
      await expect(
        readRawBody(request(Buffer.from('abc'), { 'content-type': 'application/gzip' }), 10),
      ).resolves.toEqual(Buffer.from('abc'));
    });

    it('refuses other content types and oversized bodies', async () => {
      await expect(
        readRawBody(request(Buffer.from('{}'), { 'content-type': 'application/json' }), 10),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      await expect(
        readRawBody(
          request(Buffer.alloc(20), { 'content-type': 'application/octet-stream', 'content-length': '20' }),
          10,
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      await expect(
        readRawBody(request(Buffer.alloc(20), { 'content-type': 'application/x-gzip' }), 10),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });
  });

  describe('sendServed', () => {
    it('sends the file with ETag and cache headers, and 304 on a match', () => {
      const res = response();

      sendServed(
        { headers: {} } as IncomingMessage,
        res as unknown as ServerResponse,
        { body: Buffer.from('x'), etag: 'sha256:1' },
        'application/yaml',
        'public, max-age=60',
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers).toMatchObject({
        etag: '"sha256:1"',
        'cache-control': 'public, max-age=60',
        'content-type': 'application/yaml',
        'content-length': '1',
      });
      expect(res.body?.toString()).toBe('x');

      const cached = response();

      sendServed(
        { headers: { 'if-none-match': '"sha256:1"' } } as unknown as IncomingMessage,
        cached as unknown as ServerResponse,
        { body: Buffer.from('x'), etag: 'sha256:1' },
        'application/yaml',
        'public, max-age=60',
      );
      expect(cached.statusCode).toBe(304);
      expect(cached.body).toBeUndefined();
    });
  });

  describe('routes', () => {
    const catalog = {
      info: jest.fn(async () => ({ name: 'fleet' })),
      upload: jest.fn(async () => ({ app: 'wiki' })),
      servedPackage: jest.fn(async () => ({ body: Buffer.from('pkg'), etag: 'sha256:2' })),
      servedIndex: jest.fn(async () => ({ body: Buffer.from('index'), etag: 'sha256:3' })),
      takedown: jest.fn(async () => ({ id: 't1' })),
    };
    const access = {
      caller: jest.fn(() => ({ userId: 'u', isApiKey: false, isAdmin: false, label: 'fleet:u' })),
      assertAdmin: jest.fn((c: { isAdmin: boolean }) => {
        if (!c.isAdmin) throw new ForbiddenException('fleet admins only');
      }),
    };
    const controller = new FleetCatalogController(access as never, catalog as never);

    it('keeps the management routes for fleet admins', async () => {
      await expect(controller.info()).rejects.toBeInstanceOf(ForbiddenException);
      access.caller.mockReturnValueOnce({ userId: 'a', isApiKey: false, isAdmin: true, label: 'fleet:a' });
      await expect(controller.info()).resolves.toEqual({ name: 'fleet' });
    });

    it('passes upload options through', async () => {
      access.caller.mockReturnValueOnce({ userId: 'a', isApiKey: false, isAdmin: true, label: 'fleet:a' });
      await controller.upload(
        request(Buffer.from('tgz'), { 'content-type': 'application/gzip' }) as never,
        'beta',
        'true',
      );
      expect(catalog.upload).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }), Buffer.from('tgz'), {
        channel: 'beta',
        publish: true,
      });
    });

    it('serves packages and signatures by file name and marks the serving routes public', async () => {
      const res = response();

      await controller.package('wiki', '1.2.0.tar.gz.sig', { headers: {} } as IncomingMessage, res as never);
      expect(catalog.servedPackage).toHaveBeenCalledWith('wiki', '1.2.0', true);
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');

      await expect(
        controller.package('wiki', 'latest.tar.gz', { headers: {} } as IncomingMessage, response() as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        controller.package('Wiki!', '1.0.0.tar.gz', { headers: {} } as IncomingMessage, response() as never),
      ).rejects.toBeInstanceOf(NotFoundException);

      for (const route of ['key', 'index', 'indexSignature', 'package'] as const)
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, FleetCatalogController.prototype[route])).toBe(true);

      for (const route of ['info', 'list', 'upload', 'publish', 'unpublish', 'remove', 'takedown', 'lift'] as const)
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, FleetCatalogController.prototype[route])).toBeUndefined();
    });
  });
});
