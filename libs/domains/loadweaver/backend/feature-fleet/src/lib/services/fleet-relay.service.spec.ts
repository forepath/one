import { Readable, Writable } from 'node:stream';

import { HttpException } from '@nestjs/common';

import { clusterAccess, type FleetCaller } from '../utils/fleet-access.utils';
import { FleetClusterError } from './fleet-cluster-client.service';
import { FleetRelayService, relayUpstreamException, splitRelayUrl } from './fleet-relay.service';

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

  it('answers 503 + Retry-After when the cluster hangs up during a restart (3.43 live test: 500 "socket hang up")', async () => {
    const { service, client } = setup([{ role: 'viewer', project: 'a' }]);
    const { res } = response();

    client.stream.mockRejectedValueOnce(
      new FleetClusterError('cluster unreachable: socket hang up', null, undefined, 'hang-up'),
    );

    const error = await service
      .relay(request('GET', `/api/clusters/${ID}/api/plans?project=a`), res as never, ID)
      .catch((e: HttpException) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'cluster-unreachable',
      reason: 'hang-up',
      message:
        'cluster eu is not reachable: the cluster closed the connection before answering (it may be restarting); retry in a moment',
    });
    expect(res.headers['Retry-After']).toBe('10');
  });

  it('relayUpstreamException: 503 for refused / reset / timeout, 502 for network / TLS, untouched with a status', () => {
    const unreachable = (failure: ConstructorParameters<typeof FleetClusterError>[3]) =>
      relayUpstreamException(new FleetClusterError('cluster unreachable', null, undefined, failure), 'eu');

    expect(unreachable('refused')?.getStatus()).toBe(503);
    expect(unreachable('reset')?.getStatus()).toBe(503);
    expect(unreachable('timeout')?.getStatus()).toBe(503);
    expect(unreachable('network')?.getStatus()).toBe(502);
    expect(unreachable('tls')?.getResponse()).toMatchObject({
      statusCode: 502,
      message: 'cluster eu is not reachable: the TLS connection to the cluster failed',
    });
    expect(unreachable(null)?.getStatus()).toBe(502);
    expect(relayUpstreamException(new FleetClusterError('Forbidden', 403), 'eu')).toBeNull();
    expect(relayUpstreamException(new Error('boom'), 'eu')).toBeNull();
  });

  it('relays join-token creation for a cluster-wide admin without keeping the token (2026-10-26)', async () => {
    const token = 'lwjt_secret-join-token-value';
    const { service, client, audit } = setup([{ role: 'admin', project: null }], {
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'jt1', token }),
    });
    const { res, body } = response();
    const logged = jest.spyOn((service as unknown as { logger: { warn: () => void } }).logger, 'warn');

    await service.relay(
      request(
        'POST',
        `/api/clusters/${ID}/api/join-tokens`,
        { 'content-type': 'application/json', 'content-length': '12' },
        '{"site":"a"}',
      ),
      res as never,
      ID,
    );
    await new Promise((resolve) => res.on('finish', resolve));

    expect(client.stream).toHaveBeenCalledWith(
      cluster,
      expect.objectContaining({ method: 'POST', path: 'join-tokens', onBehalfOf: 'fleet:alice@example.com' }),
    );
    expect(res.statusCode).toBe(201);
    expect(body()).toContain(token);
    expect(JSON.stringify(audit.recordQuietly.mock.calls)).not.toContain(token);
    expect(audit.recordQuietly).toHaveBeenCalledWith(
      caller,
      'relay.request',
      `cluster/${ID}/api/join-tokens`,
      expect.objectContaining({ method: 'POST', status: 201, role: 'admin' }),
      ID,
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain(token);
  });

  it('refuses join tokens for operators and project admins before forwarding', async () => {
    for (const grants of [
      [{ role: 'operator' as const, project: null }],
      [{ role: 'admin' as const, project: 'shop' }],
    ]) {
      const { service, client } = setup(grants);
      const { res } = response();

      await expect(
        service.relay(request('POST', `/api/clusters/${ID}/api/join-tokens`), res as never, ID),
      ).rejects.toMatchObject({ status: 403 });
      expect(client.stream).not.toHaveBeenCalled();
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

  it('pauses changes to a cluster the last poll found read-only or unreachable, reads go through (3.43)', async () => {
    const checkedAt = new Date().toISOString();

    for (const health of [
      {
        state: 'healthy',
        checkedAt,
        database: { readOnly: true, reason: 'members down', freeze: null, takenOverAt: null },
      },
      { state: 'unreachable', checkedAt, error: 'connect ECONNREFUSED' },
    ]) {
      const { service, client } = setup([{ role: 'admin', project: null }]);
      const paused = { ...cluster, health };

      (service as unknown as { access: { visibleCluster: jest.Mock } }).access.visibleCluster.mockResolvedValue({
        cluster: paused,
        access: clusterAccess(caller, [{ role: 'admin', project: null }], paused as never),
      });

      const { res } = response();
      const refused = service.relay(request('POST', `/api/clusters/${ID}/api/plans`), res as never, ID);

      await expect(refused).rejects.toThrow(
        health.state === 'unreachable' ? 'cluster eu is unreachable' : 'is read-only',
      );
      await expect(refused).rejects.toMatchObject({ status: 503 });
      expect(client.stream).not.toHaveBeenCalled();

      await service.relay(request('GET', `/api/clusters/${ID}/api/plans`), response().res as never, ID);
      expect(client.stream).toHaveBeenCalledTimes(1);
    }
  });

  it('requires fleet:relay for changes made with a PAT', async () => {
    const { service } = setup([{ role: 'admin', project: null }]);
    const { res } = response();
    const req = request('POST', `/api/clusters/${ID}/api/plans`) as unknown as { user: Record<string, unknown> };

    req.user = { id: 'u1', amr: ['pat'], scopes: ['fleet:read'] };
    await expect(service.relay(req as never, res as never, ID)).rejects.toThrow('fleet:relay');
  });
});

describe('REST relay: signed identity and approvals (3.24)', () => {
  const PLAN = '0b7c6a52-3f7a-4f43-9d1e-2b9a4f0c1d2e';

  function withIdentity(
    status: 'verified' | 'untrusted' | 'unsupported' | undefined,
    grants: { role: 'viewer' | 'operator' | 'admin'; project: string | null }[] = [{ role: 'operator', project: null }],
    upstream: { status: number; body?: string } = { status: 200, body: '{}' },
  ) {
    const connection = {
      ...cluster,
      health: { state: 'healthy', clusterId: 'cluster-uid', ...(status ? { identity: status } : {}) },
    };
    const access = {
      caller: jest.fn(() => caller),
      visibleCluster: jest.fn(async () => ({
        cluster: connection,
        access: clusterAccess(caller, grants, connection as never),
      })),
    };
    const client = {
      stream: jest.fn(async () => ({
        status: upstream.status,
        headers: { 'content-type': 'application/json' },
        data: Readable.from([Buffer.from(upstream.body ?? '')]),
      })),
    };
    const identity = { claimFor: jest.fn(async () => 'signed.claim.token') };
    const audit = { recordQuietly: jest.fn() };
    const service = new FleetRelayService(access as never, client as never, audit as never, identity as never);

    return { service, client, identity, connection, audit };
  }

  it('binds JSON bodies into the claim (buffered, hashed) and sends it with the request', async () => {
    const { service, client, identity, connection } = withIdentity('verified');
    const { res } = response();

    await service.relay(
      request(
        'POST',
        `/api/clusters/${ID}/api/plans?dryRun=1`,
        { 'content-type': 'application/json', 'content-length': '7' },
        '{"a":1}',
      ),
      res as never,
      ID,
    );

    expect(identity.claimFor).toHaveBeenCalledWith(caller, expect.anything(), {
      audience: 'cluster-uid',
      method: 'POST',
      url: '/api/plans?dryRun=1',
      body: Buffer.from('{"a":1}'),
    });
    expect(client.stream).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ identity: 'signed.claim.token', body: Buffer.from('{"a":1}') }),
    );
  });

  it('streams other bodies (file uploads) without a claim', async () => {
    const { service, client, identity } = withIdentity('verified', [{ role: 'admin', project: null }]);
    const { res } = response();

    await service.relay(
      request(
        'PUT',
        `/api/clusters/${ID}/api/live/files/content`,
        { 'content-type': 'application/octet-stream', 'content-length': '3' },
        'abc',
      ),
      res as never,
      ID,
    );

    expect(identity.claimFor).not.toHaveBeenCalled();
    expect(client.stream).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ identity: null }));
  });

  it('streams the release bundle upload past the size limit, bound by declared length + SHA-256 (2026-10-27)', async () => {
    const { service, client, identity } = withIdentity('verified', [{ role: 'admin', project: null }]);
    const { res } = response();
    const digest = 'AB'.repeat(32);
    const size = String(5 * 1024 ** 3);
    const req = request('POST', `/api/clusters/${ID}/api/updates/bundles`, {
      'content-type': 'application/x-tar',
      'content-length': size,
      'x-loadweaver-content-sha256': digest,
    });

    await service.relay(req, res as never, ID);

    expect(identity.claimFor).toHaveBeenCalledWith(caller, expect.anything(), {
      audience: 'cluster-uid',
      method: 'POST',
      url: '/api/updates/bundles',
      body: null,
      bodyBinding: `stream:${size}:${digest.toLowerCase()}`,
    });

    const forwarded = (client.stream.mock.calls[0] as unknown[])[1] as { body: unknown; signal?: AbortSignal };

    // Piped as is (no buffering, no byte-limit transform in between).
    expect(forwarded.body).toBe(req);
    expect(forwarded.signal).toBeInstanceOf(AbortSignal);
  });

  it('streams a bundle without a declared digest unbound (no claim) and aborts it when the caller disconnects', async () => {
    const { service, client, identity } = withIdentity('verified', [{ role: 'admin', project: null }]);
    const { res } = response();
    const req = request('POST', `/api/clusters/${ID}/api/updates/bundles`, {
      'content-type': 'application/x-tar',
      'content-length': '10',
    }) as unknown as Readable & { complete: boolean };
    let abortedDuringUpload = false;

    req.complete = false;
    client.stream.mockImplementationOnce(async (...args: unknown[]) => {
      req.emit('aborted');
      abortedDuringUpload = !!(args[1] as { signal: AbortSignal }).signal.aborted;

      return { status: 502, headers: { 'content-type': 'application/json' }, data: Readable.from([Buffer.from('{}')]) };
    });

    await service.relay(req as never, res as never, ID);

    expect(identity.claimFor).not.toHaveBeenCalled();
    expect(abortedDuringUpload).toBe(true);
  });

  it('relays search favourites only with the person’s claim to a verifying cluster (2026-10-27)', async () => {
    const unsupported = withIdentity('unsupported', [{ role: 'viewer', project: null }]);

    await expect(
      unsupported.service.relay(
        request('GET', `/api/clusters/${ID}/api/search/favorites`),
        response().res as never,
        ID,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(unsupported.client.stream).not.toHaveBeenCalled();

    const verified = withIdentity('verified', [{ role: 'viewer', project: null }]);

    await verified.service.relay(
      request('PUT', `/api/clusters/${ID}/api/search/favorites/Deployment%3Ashop%2Fweb`),
      response().res as never,
      ID,
    );
    expect(verified.client.stream).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: 'search/favorites/Deployment%3Ashop%2Fweb', identity: 'signed.claim.token' }),
    );
  });

  it('relays approvals only to clusters that verify the fleet, and passes the cluster’s 403 about the person through', async () => {
    const { res } = response();
    const approve = () => request('POST', `/api/clusters/${ID}/api/plans/${PLAN}/approve`);

    for (const [status, code] of [
      [undefined, 404],
      ['unsupported', 404],
      ['untrusted', 403],
    ] as const) {
      const { service, client } = withIdentity(status);

      await expect(service.relay(approve(), res as never, ID)).rejects.toMatchObject({ status: code });
      expect(client.stream).not.toHaveBeenCalled();
    }

    const verified = withIdentity('verified', undefined, {
      status: 403,
      body: JSON.stringify({
        message: 'approvals need the operator or admin role in a touched project, and not the plan author',
      }),
    });
    const out = response();

    await verified.service.relay(approve(), out.res as never, ID);
    await new Promise((resolve) => out.res.on('finish', resolve));
    expect(out.res.statusCode).toBe(403);
    expect(out.body()).toContain('not the plan author');
  });

  it('relays Workspace changes of project grants only with the person’s claim to a verifying cluster (parity)', async () => {
    const grants = [{ role: 'operator' as const, project: 'shop' }];
    const draft = () =>
      request('POST', `/api/clusters/${ID}/api/drafts`, { 'content-type': 'application/json' }, '{"title":"t"}');

    for (const [status, code] of [
      [undefined, 404],
      ['untrusted', 403],
    ] as const) {
      const { service, client } = withIdentity(status, grants);

      await expect(service.relay(draft(), response().res as never, ID)).rejects.toMatchObject({ status: code });
      expect(client.stream).not.toHaveBeenCalled();
    }

    const noPerson = withIdentity('verified', grants);

    noPerson.identity.claimFor.mockResolvedValue(null as never);
    await expect(noPerson.service.relay(draft(), response().res as never, ID)).rejects.toMatchObject({ status: 403 });
    expect(noPerson.client.stream).not.toHaveBeenCalled();

    const verified = withIdentity('verified', grants);
    const out = response();

    await verified.service.relay(draft(), out.res as never, ID);
    expect(verified.client.stream).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: 'drafts', identity: 'signed.claim.token' }),
    );
  });

  it('refuses approvals without a person (no claim could be minted)', async () => {
    const { service, identity, client } = withIdentity('verified');
    const { res } = response();

    identity.claimFor.mockResolvedValue(null as never);
    await expect(
      service.relay(request('POST', `/api/clusters/${ID}/api/plans/${PLAN}/approve`), res as never, ID),
    ).rejects.toMatchObject({ status: 403 });
    expect(client.stream).not.toHaveBeenCalled();
  });

  it('still maps a 403 of ordinary changes to the credential 502', async () => {
    const { service } = withIdentity('verified', undefined, {
      status: 403,
      body: '{"message":"Missing scope plans:create"}',
    });
    const { res } = response();

    await expect(
      service.relay(request('POST', `/api/clusters/${ID}/api/plans`), res as never, ID),
    ).rejects.toMatchObject({
      status: 502,
    });
  });
  describe('project secrets (2026-10-29: relayed as the signed person)', () => {
    const VALUE = 's3cr3t-value-never-at-the-fleet';
    const put = () =>
      request(
        'PUT',
        `/api/clusters/${ID}/api/projects/shop/secrets/db-password`,
        { 'content-type': 'application/json' },
        JSON.stringify({ value: VALUE }),
      );

    it('binds the value into the claim, streams it once and audits only method, path and status', async () => {
      const { service, client, identity, audit } = withIdentity('verified', [{ role: 'operator', project: 'shop' }]);
      const out = response();

      await service.relay(put(), out.res as never, ID);

      expect(identity.claimFor).toHaveBeenCalledWith(
        caller,
        expect.anything(),
        expect.objectContaining({ method: 'PUT', url: '/api/projects/shop/secrets/db-password' }),
      );
      expect(client.stream).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ identity: 'signed.claim.token' }),
      );
      expect(out.res.headers['cache-control']).toBe('no-store');
      expect(audit.recordQuietly).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(audit.recordQuietly.mock.calls)).not.toContain(VALUE);
      expect(audit.recordQuietly.mock.calls[0][2]).toBe(`cluster/${ID}/api/projects/shop/secrets/db-password`);
    });

    it('needs the signed person, also for cluster-wide admins (no API key without delegation)', async () => {
      const { service, client, identity } = withIdentity('verified', [{ role: 'admin', project: null }]);

      identity.claimFor.mockResolvedValue(null as never);
      await expect(service.relay(put(), response().res as never, ID)).rejects.toMatchObject({ status: 403 });
      expect(client.stream).not.toHaveBeenCalled();
    });

    it('refuses clusters that do not verify the fleet identity', async () => {
      for (const [status, code] of [
        [undefined, 404],
        ['untrusted', 403],
      ] as const) {
        const { service, client } = withIdentity(status, [{ role: 'admin', project: null }]);

        await expect(service.relay(put(), response().res as never, ID)).rejects.toMatchObject({ status: code });
        expect(client.stream).not.toHaveBeenCalled();
      }
    });

    it('names the cause when the cluster ignores the fleet’s identities on this connection ("Not in effect")', async () => {
      const { service, client, connection } = withIdentity('untrusted', [{ role: 'operator', project: 'shop' }]);

      (connection.health as Record<string, unknown>)['identityReason'] =
        'only PATs with fleet:on-behalf-of or the cluster API key send fleet identities';
      await expect(service.relay(put(), response().res as never, ID)).rejects.toMatchObject({
        status: 403,
        message:
          'secrets through the fleet need your signed identity, but the cluster ignores it on this connection: only PATs with fleet:on-behalf-of or the cluster API key send fleet identities',
      });
      expect(client.stream).not.toHaveBeenCalled();

      const approval = withIdentity('untrusted');

      await expect(
        approval.service.relay(
          request('POST', `/api/clusters/${ID}/api/plans/${PLAN}/approve`),
          response().res as never,
          ID,
        ),
      ).rejects.toMatchObject({ message: expect.stringMatching(/^approvals need the cluster to trust this fleet/) });
    });

    it('passes the cluster’s 403 about the person through (not a credential problem)', async () => {
      const { service } = withIdentity('verified', [{ role: 'operator', project: 'shop' }], {
        status: 403,
        body: JSON.stringify({ message: 'secret writes need the admin or operator role in project shop' }),
      });
      const out = response();

      await service.relay(put(), out.res as never, ID);
      await new Promise((resolve) => out.res.on('finish', resolve));
      expect(out.res.statusCode).toBe(403);
      expect(out.body()).toContain('admin or operator role');
    });
  });

  describe('recovery kit (2026-10-30: relayed as the signed person, cluster-wide admins only)', () => {
    const SHARE = 'lw-share-material-never-at-the-fleet';
    const confirm = () =>
      request(
        'POST',
        `/api/clusters/${ID}/api/backups/keys/2/kit/confirm`,
        { 'content-type': 'application/json' },
        JSON.stringify({ shares: [SHARE] }),
      );

    it('binds the shares into the claim, answers no-store and audits only method, path and status', async () => {
      const { service, client, identity, audit } = withIdentity('verified', [{ role: 'admin', project: null }]);
      const out = response();

      await service.relay(confirm(), out.res as never, ID);

      expect(identity.claimFor).toHaveBeenCalledWith(
        caller,
        expect.anything(),
        expect.objectContaining({ method: 'POST', url: '/api/backups/keys/2/kit/confirm' }),
      );
      expect(client.stream).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ identity: 'signed.claim.token' }),
      );
      expect(out.res.headers['cache-control']).toBe('no-store');
      expect(audit.recordQuietly).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(audit.recordQuietly.mock.calls)).not.toContain(SHARE);
      expect(audit.recordQuietly.mock.calls[0][2]).toBe(`cluster/${ID}/api/backups/keys/2/kit/confirm`);
    });

    it('needs the signed person and a cluster-wide admin grant', async () => {
      const noPerson = withIdentity('verified', [{ role: 'admin', project: null }]);

      noPerson.identity.claimFor.mockResolvedValue(null as never);
      await expect(noPerson.service.relay(confirm(), response().res as never, ID)).rejects.toMatchObject({
        status: 403,
        message: expect.stringMatching(/recovery kit through the fleet need a signed-in user/),
      });
      expect(noPerson.client.stream).not.toHaveBeenCalled();

      const projectAdmin = withIdentity('verified', [{ role: 'admin', project: 'shop' }]);

      await expect(projectAdmin.service.relay(confirm(), response().res as never, ID)).rejects.toMatchObject({
        status: 403,
      });
      expect(projectAdmin.client.stream).not.toHaveBeenCalled();
    });
  });

  describe('fleet parity for integrations (3.41)', () => {
    const CONNECTION = '0b7c6a52-3f7a-4f43-9d1e-2b9a4f0c1d2e';
    const env = { ...process.env };

    afterEach(() => {
      process.env = { ...env };
    });

    it('relays a project admin’s Git connection change as the person and passes the cluster’s 403 through', async () => {
      const grants = [{ role: 'admin' as const, project: 'shop' }];
      const patch = () =>
        request(
          'PATCH',
          `/api/clusters/${ID}/api/git/connections/${CONNECTION}`,
          { 'content-type': 'application/json', 'content-length': '17' },
          '{"branch":"main"}',
        );

      const untrusted = withIdentity('untrusted', grants);

      await expect(untrusted.service.relay(patch(), response().res as never, ID)).rejects.toMatchObject({
        status: 403,
      });
      expect(untrusted.client.stream).not.toHaveBeenCalled();

      const noPerson = withIdentity('verified', grants);

      noPerson.identity.claimFor.mockResolvedValue(null as never);
      await expect(noPerson.service.relay(patch(), response().res as never, ID)).rejects.toMatchObject({
        status: 403,
      });
      expect(noPerson.client.stream).not.toHaveBeenCalled();

      const denied = withIdentity('verified', grants, {
        status: 403,
        body: '{"message":"cluster admin role required"}',
      });
      const out = response();

      await denied.service.relay(patch(), out.res as never, ID);
      await new Promise((resolve) => out.res.on('finish', resolve));
      expect(denied.client.stream).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ path: `git/connections/${CONNECTION}`, identity: 'signed.claim.token' }),
      );
      expect(out.res.statusCode).toBe(403);
      expect(out.body()).toContain('cluster admin role required');
    });

    it('forwards a Git account link’s return URL only for the fleet’s own console origins', async () => {
      process.env['FLEET_CONSOLE_URL'] = 'https://console.example.com';
      delete process.env['CORS_ORIGIN'];

      const authorize = (body: string) =>
        request(
          'POST',
          `/api/clusters/${ID}/api/git/accounts/github/authorize`,
          { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
          body,
        );
      const grants = [{ role: 'viewer' as const, project: 'shop' }];

      for (const body of [
        '{"returnUrl":"https://evil.example.com/account/git-accounts"}',
        '{"returnUrl":"https://console.example.com/settings"}',
        '{"returnUrl":"https://console.example.com/account/git-accounts?confirm=x"}',
        '{"returnUrl":"https://console.example.com/account/git-accounts","other":1}',
        '[]',
      ]) {
        const { service, client } = withIdentity('verified', grants);

        await expect(service.relay(authorize(body), response().res as never, ID)).rejects.toMatchObject({
          status: 400,
        });
        expect(client.stream).not.toHaveBeenCalled();
      }

      for (const body of ['{"returnUrl":"https://console.example.com/de/account/git-accounts"}', '{}']) {
        const { service, client, identity } = withIdentity('verified', grants);

        await service.relay(authorize(body), response().res as never, ID);
        expect(identity.claimFor).toHaveBeenCalledWith(
          caller,
          expect.anything(),
          expect.objectContaining({ body: Buffer.from(body) }),
        );
        expect(client.stream).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ path: 'git/accounts/github/authorize', identity: 'signed.claim.token' }),
        );
      }
    });

    it('relays linked Git accounts only with the person’s claim, also for cluster-wide admins', async () => {
      const { service, client, identity } = withIdentity('verified', [{ role: 'admin', project: null }]);

      identity.claimFor.mockResolvedValue(null as never);
      await expect(
        service.relay(request('GET', `/api/clusters/${ID}/api/git/accounts`), response().res as never, ID),
      ).rejects.toMatchObject({ status: 403 });
      expect(client.stream).not.toHaveBeenCalled();
    });
  });
});
