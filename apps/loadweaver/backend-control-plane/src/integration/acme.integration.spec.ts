import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';

import { AcmeClient, obtainCertificate, type AcmeTransport } from '@forepath/loadweaver/backend/feature-control-plane';
import {
  DEFAULT_ENVOY_IMAGE,
  renderClusters,
  renderEnvoyBootstrap,
  renderListeners,
} from '@forepath/loadweaver/backend/feature-node-agent';
import type { Ingress } from '@forepath/loadweaver/shared/util-agent-protocol';

/**
 * Built-in ACME end to end (3.6): the control plane's ACME client orders from Pebble (Let's Encrypt's test CA), the
 * HTTP-01 answer goes into the ingress configuration, a real Envoy (rendered like on the nodes) serves it, Pebble
 * validates it over the network, and Envoy then serves the issued certificate by SNI.
 */

const PEBBLE_IMAGE =
  'ghcr.io/letsencrypt/pebble:2.10.1@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199';
const CHALLTESTSRV_IMAGE =
  'ghcr.io/letsencrypt/pebble-challtestsrv:2.10.1@sha256:12ce21884def456bcf9786542113949e1f19dc7738d2c70e156c2d0c38a1405b';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function get(port: number, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = '';

      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });

    req.on('error', reject);
    req.end();
  });
}

describe('ACME through the ingress (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-it-acme-${run}`;
  const subnet = `10.${210 + (process.pid % 40)}.${Date.now() % 250}.0/24`;
  const prefix = subnet.split('.').slice(0, 3).join('.');
  const envoyIp = `${prefix}.10`;
  const dnsIp = `${prefix}.11`;
  const names = { envoy: `lw-it-acme-envoy-${run}`, pebble: `lw-it-acme-pebble-${run}`, dns: `lw-it-acme-dns-${run}` };
  const dir = mkdtempSync(join(tmpdir(), 'lw-it-acme-'));
  let pebbleCa = '';
  const ports: Record<string, number> = {};
  let ingress: Ingress = {
    addresses: [envoyIp],
    sites: [{ host: 'app.lab.test', routes: [{ prefix: '/', upstream: 'p/d/x:80' }] }],
    certificates: [],
    acmeChallenges: [],
    forwards: [],
    upstreams: [{ name: 'p/d/x:80', endpoints: [] }],
  };
  const publish = (next: Ingress) => {
    ingress = next;
    // Like the agent: complete files swapped in by rename.
    writeFileSync(join(dir, 'dynamic', '.lds.tmp'), renderListeners(next));
    renameSync(join(dir, 'dynamic', '.lds.tmp'), join(dir, 'dynamic', 'lds.json'));
  };
  const transport: AcmeTransport = (url, init) =>
    new Promise((resolve, reject) => {
      const req = httpsRequest(url, { method: init.method, headers: init.headers, ca: pebbleCa }, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const headers = new Headers();

          for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') headers.set(k, v);

          resolve(
            new Response(init.method === 'HEAD' ? null : Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              headers,
            }),
          );
        });
      });

      req.on('error', reject);
      req.end(init.body);
    });

  beforeAll(async () => {
    chmodSync(dir, 0o755);
    mkdirSync(join(dir, 'dynamic'), { mode: 0o755 });
    writeFileSync(join(dir, 'bootstrap.json'), renderEnvoyBootstrap('lab'));
    writeFileSync(join(dir, 'dynamic', 'cds.json'), renderClusters(ingress));
    publish(ingress);
    writeFileSync(
      join(dir, 'pebble.json'),
      JSON.stringify({
        pebble: {
          listenAddress: '0.0.0.0:14000',
          managementListenAddress: '0.0.0.0:15000',
          certificate: 'test/certs/localhost/cert.pem',
          privateKey: 'test/certs/localhost/key.pem',
          httpPort: 80,
          tlsPort: 443,
          ocspResponderURL: '',
          externalAccountBindingRequired: false,
        },
      }),
    );

    docker(['network', 'create', '--subnet', subnet, network]);
    // Every name resolves to the Envoy, as public DNS would point at the ingress address.
    docker([
      'run',
      '-d',
      '--name',
      names.dns,
      '--network',
      network,
      '--ip',
      dnsIp,
      CHALLTESTSRV_IMAGE,
      '-defaultIPv4',
      envoyIp,
      '-defaultIPv6',
      '',
      '-http01',
      '',
      '-https01',
      '',
      '-tlsalpn01',
      '',
      '-doh',
      '',
      '-management',
      ':8055',
    ]);
    docker([
      'run',
      '-d',
      '--name',
      names.envoy,
      '--network',
      network,
      '--ip',
      envoyIp,
      '-p',
      '127.0.0.1::80',
      '-p',
      '127.0.0.1::443',
      '--cap-drop',
      'ALL',
      '--cap-add',
      'NET_BIND_SERVICE',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--tmpfs',
      '/etc/envoy/run',
      '--security-opt',
      'no-new-privileges:true',
      '-e',
      'ENVOY_UID=0',
      '-v',
      `${dir}/bootstrap.json:/etc/envoy/bootstrap.json:ro`,
      '-v',
      `${dir}/dynamic:/etc/envoy/dynamic:ro`,
      DEFAULT_ENVOY_IMAGE,
      'envoy',
      '-c',
      '/etc/envoy/bootstrap.json',
      '--log-level',
      'warn',
    ]);
    docker([
      'run',
      '-d',
      '--name',
      names.pebble,
      '--network',
      network,
      '-p',
      '127.0.0.1::14000',
      '-p',
      '127.0.0.1::15000',
      '-e',
      'PEBBLE_VA_NOSLEEP=1',
      '-e',
      'PEBBLE_WFE_NONCEREJECT=0',
      '-v',
      `${dir}/pebble.json:/config.json:ro`,
      PEBBLE_IMAGE,
      '-config',
      '/config.json',
      '-dnsserver',
      `${dnsIp}:8053`,
    ]);

    for (const [name, port] of [
      ['envoy', 80],
      ['envoy', 443],
      ['pebble', 14000],
      ['pebble', 15000],
    ] as const) {
      ports[`${name}:${port}`] = Number(
        docker(['port', names[name], `${port}/tcp`])
          .split('\n')[0]
          .split(':')
          .pop(),
      );
    }

    // The image has no shell tools; copy Pebble's CA out.
    docker(['cp', `${names.pebble}:/test/certs/pebble.minica.pem`, join(dir, 'pebble-ca.pem')]);
    pebbleCa = readFileSync(join(dir, 'pebble-ca.pem'), 'utf8');
  }, 180_000);

  afterAll(() => {
    for (const name of Object.values(names)) {
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

    rmSync(dir, { recursive: true, force: true });
  });

  it('issues a certificate through HTTP-01 on the ingress and serves it', async () => {
    const accountKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();
    const client = new AcmeClient(`https://localhost:${ports['pebble:14000']}/dir`, accountKey, transport);

    await new Promise((r) => setTimeout(r, 1_500));
    expect(await client.register('ops@lab.test')).toMatch(/^https:\/\/localhost:\d+\/my-account\//);

    const issued = await obtainCertificate(
      client,
      ['app.lab.test'],
      {
        present: async (challenges) => {
          publish({
            ...ingress,
            acmeChallenges: challenges.map((c) => ({ token: c.token, keyAuthorization: c.keyAuthorization })),
          });

          // Served by Envoy before Pebble is asked to look.
          for (const c of challenges) {
            for (
              let i = 0;
              i < 40 &&
              (
                await get(ports['envoy:80'], `/.well-known/acme-challenge/${c.token}`, c.name).catch(() => ({
                  body: '',
                }))
              ).body !== c.keyAuthorization;
              i++
            )
              await new Promise((r) => setTimeout(r, 250));
          }
        },
        cleanup: async () => publish({ ...ingress, acmeChallenges: [] }),
      },
      { pollMs: 500, timeoutMs: 60_000 },
    );

    expect(issued.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(issued.notAfter.getTime()).toBeGreaterThan(Date.now());

    // Served by SNI once the ingress has it.
    publish({
      ...ingress,
      sites: [{ ...ingress.sites[0], certificate: 'app' }],
      certificates: [{ id: 'app', certificatePem: issued.certificatePem, privateKeyPem: issued.privateKeyPem }],
      acmeChallenges: [],
    });

    const served = await (async () => {
      for (let i = 0; i < 40; i++) {
        const san = await new Promise<string>((resolve) => {
          const req = httpsRequest(
            {
              host: '127.0.0.1',
              port: ports['envoy:443'],
              path: '/',
              servername: 'app.lab.test',
              rejectUnauthorized: false,
            },
            (res) => {
              resolve(String((res.socket as TLSSocket).getPeerCertificate().subjectaltname ?? ''));
              res.resume();
            },
          );

          req.on('error', () => resolve(''));
          req.end();
        });

        if (san) return san;

        await new Promise((r) => setTimeout(r, 250));
      }

      return '';
    })();

    expect(served).toBe('DNS:app.lab.test');
  });
});
