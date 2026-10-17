import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ProbeManager } from './probe.manager';
import { runProbe } from './probe-runner';

describe('probes', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(req.headers.host === 'ok.example.test' ? 204 : 503);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('checks HTTP status and TCP reachability', async () => {
    expect(
      await runProbe({
        id: 'a',
        address: '127.0.0.1',
        port,
        protocol: 'http',
        host: 'ok.example.test',
        intervalSeconds: 5,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await runProbe({
        id: 'b',
        address: '127.0.0.1',
        port,
        protocol: 'http',
        host: 'bad.example.test',
        intervalSeconds: 5,
      }),
    ).toMatchObject({ ok: false, error: 'HTTP 503' });
    expect(await runProbe({ id: 'c', address: '127.0.0.1', port, protocol: 'tcp', intervalSeconds: 5 })).toMatchObject({
      ok: true,
    });
    expect(
      await runProbe({ id: 'd', address: '127.0.0.1', port: 1, protocol: 'tcp', intervalSeconds: 5 }, 500),
    ).toMatchObject({ ok: false });
  });

  it('runs due probes and reports results in batches', async () => {
    const manager = new ProbeManager();
    const sent: unknown[] = [];

    manager.apply([{ id: 'tcp', address: '127.0.0.1', port, protocol: 'tcp', intervalSeconds: 30 }]);
    Object.assign(manager, { send: (e: unknown) => sent.push(e) });
    manager.tick(0);
    manager.tick(1_000); // not due again yet
    await new Promise((r) => setTimeout(r, 200));
    manager.report();

    expect(sent).toHaveLength(1);
    expect(JSON.parse(Buffer.from((sent[0] as { payload: Uint8Array }).payload).toString()).results).toEqual([
      expect.objectContaining({ id: 'tcp', ok: true }),
    ]);
    manager.onModuleDestroy();
  });
});
