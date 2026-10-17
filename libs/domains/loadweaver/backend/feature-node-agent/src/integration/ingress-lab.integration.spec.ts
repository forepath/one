import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Ingress } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCertificateAuthority,
  createCsr,
  generateKeyPair,
  issueCertificate,
} from '@forepath/loadweaver/shared/util-pki';

import {
  DEFAULT_ENVOY_IMAGE,
  renderClusters,
  renderEnvoyBootstrap,
  renderListeners,
} from '../lib/ingress/envoy-config';
import { DEFAULT_REGISTRY_IMAGE } from '../lib/registry/registry-config';

/**
 * The ingress on a real Envoy (3.6) with exactly the configuration the agent renders: host routing, ACME HTTP-01
 * answers, HTTPS by SNI with redirects from HTTP, and an L4 TCP forward, all to a backend on another "node".
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();

  for (;;) {
    try {
      const value = await fn();

      if (value !== undefined) return value;
    } catch {
      // retry
    }

    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');

    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Plain HTTP with an explicit Host header (fetch drops `Host`). */
function get(port: number, path: string, host?: string): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: host ? { host } : {} }, (res) => {
      let body = '';

      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, body }));
    });

    req.on('error', reject);
    req.end();
  });
}

describe('ingress on a real Envoy (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-lab-ingress-${run}`;
  const subnet = `10.${50 + (process.pid % 50)}.${Date.now() % 250}.0/24`;
  const prefix = subnet.split('.').slice(0, 3).join('.');
  const envoyAddress = `${prefix}.10`;
  const backendAddress = `${prefix}.20`;
  const envoy = `lw-lab-envoy-${run}`;
  const backend = `lw-lab-backend-${run}`;
  const dir = mkdtempSync(join(tmpdir(), 'lw-lab-ingress-'));
  const published: Record<number, number> = {};

  beforeAll(async () => {
    const ca = await createCertificateAuthority({ commonName: 'lab', validityDays: 1 });
    const keys = await generateKeyPair();
    const cert = await issueCertificate({
      ca,
      csrPem: await createCsr(keys, 'secure'),
      clusterId: 'lab',
      kind: 'client',
      name: 'secure',
      dnsNames: ['secure.example.test'],
      validityHours: 1,
    });
    const upstream = 'shop/web/api:5000';
    const ingress: Ingress = {
      addresses: [envoyAddress],
      sites: [
        { host: 'app.example.test', routes: [{ prefix: '/', upstream }] },
        { host: 'secure.example.test', routes: [{ prefix: '/v2', upstream }], certificate: 'secure' },
      ],
      certificates: [{ id: 'secure', certificatePem: cert.certificatePem, privateKeyPem: keys.privateKeyPem }],
      acmeChallenges: [{ token: 'tok_abcdefghijklmnop', keyAuthorization: 'tok_abcdefghijklmnop.thumbprint123' }],
      forwards: [
        { protocol: 'tcp', port: 15432, upstream, maxConnections: 100 },
        { protocol: 'udp', port: 15353, upstream: 'shop/web/api/udp:5353' },
      ],
      upstreams: [
        { name: upstream, endpoints: [{ address: backendAddress, port: 5000 }] },
        { name: 'shop/web/api/udp:5353', endpoints: [{ address: backendAddress, port: 5353 }] },
      ],
    };

    // On nodes root owns these; here the test user does, so root in the container (no DAC override) needs read access.
    chmodSync(dir, 0o755);
    mkdirSync(join(dir, 'dynamic'), { recursive: true, mode: 0o755 });
    writeFileSync(join(dir, 'bootstrap.json'), renderEnvoyBootstrap('lab'));
    writeFileSync(join(dir, 'dynamic', 'cds.json'), renderClusters(ingress));
    writeFileSync(join(dir, 'dynamic', 'lds.json'), renderListeners(ingress));

    docker(['network', 'create', '--subnet', subnet, network]);
    docker([
      'run',
      '-d',
      '--name',
      backend,
      '--network',
      network,
      '--ip',
      backendAddress,
      '--memory',
      '128m',
      DEFAULT_REGISTRY_IMAGE,
    ]);
    docker([
      'run',
      '-d',
      '--name',
      envoy,
      '--network',
      network,
      '--ip',
      envoyAddress,
      '--memory',
      '256m',
      '-p',
      '127.0.0.1::80',
      '-p',
      '127.0.0.1::443',
      '-p',
      '127.0.0.1::15432',
      // Same hardening as on the nodes.
      '--cap-drop',
      'ALL',
      '--cap-add',
      'NET_BIND_SERVICE',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--security-opt',
      'no-new-privileges:true',
      '-e',
      'ENVOY_UID=0',
      '-v',
      `${dir}/bootstrap.json:/etc/envoy/bootstrap.json:ro`,
      '-v',
      `${dir}/dynamic:/etc/envoy/dynamic:ro`, // On nodes the agent creates this directory as root; here a tmpfs gives root the same ownership.
      '--tmpfs',
      '/etc/envoy/run',
      DEFAULT_ENVOY_IMAGE,
      'envoy',
      '-c',
      '/etc/envoy/bootstrap.json',
      '--log-level',
      'warn',
    ]);

    for (const port of [80, 443, 15432])
      published[port] = Number(
        docker(['port', envoy, `${port}/tcp`])
          .split('\n')[0]
          .split(':')
          .pop(),
      );

    await eventually(async () =>
      (await get(published[80], '/v2/', 'app.example.test')).status === 200 ? true : undefined,
    );
  }, 180_000);

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] !== '1') {
      for (const name of [envoy, backend]) {
        try {
          docker(['rm', '-f', name]);
        } catch {
          // gone
        }
      }

      try {
        docker(['network', 'rm', network]);
      } catch {
        // gone
      }
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('routes hosts, answers ACME challenges, terminates TLS by SNI and forwards TCP', async () => {
    const http = (path: string, host: string) => get(published[80], path, host);

    expect((await http('/v2/', 'app.example.test')).status).toBe(200);
    expect((await http('/v2/', 'unknown.example.test')).status).toBe(404);
    expect((await http('/.well-known/acme-challenge/tok_abcdefghijklmnop', 'secure.example.test')).body).toBe(
      'tok_abcdefghijklmnop.thumbprint123',
    );

    const redirect = await http('/v2/', 'secure.example.test');

    expect(redirect.status).toBe(301);
    expect(redirect.location).toBe('https://secure.example.test/v2/');

    const tls = await new Promise<{ status: number; subject: string }>((resolve, reject) => {
      const req = httpsRequest(
        {
          host: '127.0.0.1',
          port: published[443],
          path: '/v2/',
          servername: 'secure.example.test',
          headers: { host: 'secure.example.test' },
          rejectUnauthorized: false,
        },
        (res) => {
          const peer = (res.socket as import('node:tls').TLSSocket).getPeerCertificate();

          res.resume();
          resolve({ status: res.statusCode ?? 0, subject: String(peer.subjectaltname ?? '') });
        },
      );

      req.on('error', reject);
      req.end();
    });

    expect(tls.status).toBe(200);
    expect(tls.subject).toContain('DNS:secure.example.test');

    // The L4 forward carries raw TCP (here: HTTP to the backend).
    expect((await get(published[15432], '/v2/')).status).toBe(200);
    // Every listener, the UDP one included, was accepted.
    expect(docker(['logs', envoy])).not.toMatch(/rejected|error adding listener/i);
  });
});
