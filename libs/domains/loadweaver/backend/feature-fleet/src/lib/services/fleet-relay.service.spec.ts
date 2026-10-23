import { Readable, Writable } from 'node:stream';

import { HttpException } from '@nestjs/common';

import { clusterAccess, type FleetCaller } from '../utils/fleet-access.utils';
import { FleetRelayService, splitRelayUrl } from './fleet-relay.service';

const ID = '00000000-0000-4000-8000-00000000000a';
const caller: FleetCaller = { userId: 'u1', isApiKey: false, isAdmin: false, label: 'fleet:alice@example.com' };
const cluster = { id: ID, name: 'eu', state: 'active', readOnlyUntil: null, credential: 'cluster-pat' };

function response() {
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk: Buffer, _e, cb) {
      chunks.push(chunk);
      cb();
    },
  }) as Writable & { statusCode: number; headers: Record<string, string>; setHeader(n: string, v: string): void };

  res.statusCode = 0;
  res.headers = {};
  res.setHeader = (n, v) => {
    res.headers[n] = v;
  };

  return { res, body: () => Buffer.concat(chunks).toString() };
}

function setup(
  grants: { role: 'viewer' | 'operator' | 'admin'; project: string | null }[],
  upstream: { status: number; headers?: Record<string, string>; body?: string } = {
    status: 201,
    headers: { 'content-type': 'application/json', 'set-cookie': 'x' },
    body: '{"id":"p1"}',
  },
) {
  const access = {
    caller: jest.fn(() => caller),
    visibleCluster: jest.fn(async () => ({ cluster, access: clusterAccess(caller, grants, cluster as never) })),
  };
  const client = {
    stream: jest.fn(async () => ({
      status: upstream.status,
      headers: upstream.headers ?? {},
      data: Readable.from([Buffer.from(upstream.body ?? '')]),
    })),
  };
  const audit = { recordQuietly: jest.fn() };

  return { service: new FleetRelayService(access as never, client as never, audit as never), client, audit };
}

const request = (method: string, url: string, headers: Record<string, string> = {}, body?: string) => {
  const req = Readable.from(body ? [Buffer.from(body)] : []) as Readable & Record<string, unknown>;

  Object.assign(req, {
    method,
    originalUrl: url,
    headers: { authorization: 'Bearer fleet-jwt', ...headers },
    user: { id: 'u1', amr: ['pwd'] },
  });

  return req as never;
};

describe('REST relay (3.24)', () => {
  it('splits the relayed path and raw query from the original URL', () => {
    expect(splitRelayUrl(`/api/clusters/${ID}/api/plans?project=shop&status=pending&x=1&x=2`, ID)).toEqual({
      path: 'plans',
      rawQuery: 'project=shop&status=pending&x=1&x=2',
    });
    expect(splitRelayUrl('/api/clusters/other/api/plans', ID)).toBeNull();
  });

  it('refuses query smuggling past the cluster parser before forwarding (H1)', async () => {
    const { service, client } = setup([{ role: 'viewer', project: 'a' }]);
    const { res } = response();
    const filler = Array.from({ length: 1000 }, (_, i) => `x${i}=1`).join('&');

    await expect(
      service.relay(request('GET', `/api/clusters/${ID}/api/plans?${filler}&project=a`), res as never, ID),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.relay(request('GET', `/api/clusters/${ID}/api/plans?project=a&project=b`), res as never, ID),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.relay(request('GET', `/api/clusters/${ID}/api/plans?project=a&debug=1`), res as never, ID),
    ).rejects.toMatchObject({ status: 400 });
    expect(client.stream).not.toHaveBeenCalled();
  });

  it('forwards the parsed, validated query (re-serialised, never the raw string)', async () => {
    const { service, client } = setup([{ role: 'viewer', project: 'a' }], { status: 200, body: '[]' });
    const { res } = response();

    await service.relay(request('GET', `/api/clusters/${ID}/api/plans?project=a&status=pending`), res as never, ID);
    expect(client.stream).toHaveBeenCalledWith(
      cluster,
      expect.objectContaining({ path: 'plans', query: { project: 'a', status: 'pending' } }),
    );
  });

  it("maps a cluster 401 / 403 of the service credential to a 502, not the caller's own 401 (L11)", async () => {
    for (const [status, message] of [
      [401, 'cluster rejected the fleet credential'],
      [403, 'cluster refused the fleet credential: Missing scope plans:create'],
    ] as const) {
      const { service } = setup([{ role: 'operator', project: null }], {
        status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusCode: status, message: status === 403 ? 'Missing scope plans:create' : 'no' }),
      });
      const { res } = response();
      const error = await service
        .relay(request('POST', `/api/clusters/${ID}/api/plans`), res as never, ID)
        .catch((e: HttpException) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(502);
      expect((error as HttpException).getResponse()).toMatchObject({ message, clusterStatus: status });
      expect(res.statusCode).toBe(0);
    }
  });

  it('refuses before forwarding when the grant is too low', async () => {
    const { service, client } = setup([{ role: 'viewer', project: null }]);
    const { res } = response();

    await expect(service.relay(request('POST', `/api/clusters/${ID}/api/plans`), res as never, ID)).rejects.toThrow(
      HttpException,
    );
    expect(client.stream).not.toHaveBeenCalled();
  });

  it('forwards with the service credential, streams the answer back and audits the change', async () => {
    const { service, client, audit } = setup([{ role: 'operator', project: null }]);
    const { res, body } = response();

    await service.relay(
      request(
        'POST',
        `/api/clusters/${ID}/api/plans`,
        { 'content-type': 'application/json', 'content-length': '2' },
        '{}',
      ),
      res as never,
      ID,
    );
    await new Promise((resolve) => res.on('finish', resolve));

    expect(client.stream).toHaveBeenCalledWith(
      cluster,
      expect.objectContaining({ method: 'POST', path: 'plans', onBehalfOf: 'fleet:alice@example.com' }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.headers).toEqual({ 'content-type': 'application/json' });
    expect(body()).toBe('{"id":"p1"}');
    expect(audit.recordQuietly).toHaveBeenCalledWith(
      caller,
      'relay.request',
      `cluster/${ID}/api/plans`,
      { method: 'POST', status: 201, role: 'operator', project: null },
      ID,
    );
  });

  it('rejects oversized request bodies up front', async () => {
    const { service, client } = setup([{ role: 'admin', project: null }]);
    const { res } = response();

    await expect(
      service.relay(
        request('PUT', `/api/clusters/${ID}/api/live/files/content`, { 'content-length': String(1024 ** 3) }),
        res as never,
        ID,
      ),
    ).rejects.toThrow('request larger than');
    expect(client.stream).not.toHaveBeenCalled();
  });

  it('requires fleet:relay for changes made with a PAT', async () => {
    const { service } = setup([{ role: 'admin', project: null }]);
    const { res } = response();
    const req = request('POST', `/api/clusters/${ID}/api/plans`) as unknown as { user: Record<string, unknown> };

    req.user = { id: 'u1', amr: ['pat'], scopes: ['fleet:read'] };
    await expect(service.relay(req as never, res as never, ID)).rejects.toThrow('fleet:relay');
  });
});
