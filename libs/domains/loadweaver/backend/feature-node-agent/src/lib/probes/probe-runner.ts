import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';

import type { Probe } from '@forepath/loadweaver/shared/util-agent-protocol';

const TIMEOUT_MS = 5_000;

export interface ProbeOutcome {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * One check (3.28): TCP connect, or an HTTP(S) request with the hostname as Host and SNI. Certificates are verified:
 * a broken certificate is a failure for real clients too.
 */
export async function runProbe(probe: Probe, timeoutMs = TIMEOUT_MS): Promise<ProbeOutcome> {
  const start = Date.now();
  const done = (ok: boolean, error?: string): ProbeOutcome => ({
    ok,
    latencyMs: Date.now() - start,
    ...(error ? { error: error.slice(0, 256) } : {}),
  });

  if (probe.protocol === 'tcp') {
    return await new Promise((resolve) => {
      const socket = connect({ host: probe.address, port: probe.port, timeout: timeoutMs });

      socket.once('connect', () => {
        socket.destroy();
        resolve(done(true));
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(done(false, 'timeout'));
      });
      socket.once('error', (error) => resolve(done(false, error.message)));
    });
  }

  const [low, high] = probe.expectStatus ?? [200, 399];
  const request = probe.protocol === 'https' ? httpsRequest : httpRequest;

  return await new Promise((resolve) => {
    const req = request(
      {
        host: probe.address,
        port: probe.port,
        path: probe.path ?? '/',
        method: 'GET',
        headers: { ...(probe.host ? { host: probe.host } : {}), 'user-agent': 'loadweaver-probe/1' },
        ...(probe.protocol === 'https' && probe.host ? { servername: probe.host } : {}),
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();

        const status = res.statusCode ?? 0;

        resolve(status >= low && status <= high ? done(true) : done(false, `HTTP ${status}`));
      },
    );

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve(done(false, error.message)));
    req.end();
  });
}
