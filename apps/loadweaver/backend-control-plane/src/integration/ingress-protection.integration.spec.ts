import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderRateLimitConfig, routeId, WAF_MODULE_SHA256 } from '@forepath/loadweaver/backend/feature-control-plane';
import {
  DEFAULT_ENVOY_IMAGE,
  DEFAULT_RATELIMIT_IMAGE,
  DEFAULT_REGISTRY_IMAGE,
  DEFAULT_VALKEY_IMAGE,
  envoySpec,
  renderClusters,
  renderEnvoyBootstrap,
  renderListeners,
  VALKEY_PORT,
} from '@forepath/loadweaver/backend/feature-node-agent';
import type { Ingress } from '@forepath/loadweaver/shared/util-agent-protocol';

import { wafModule } from './waf-module';

/**
 * Ingress protection on real components (3.6): cluster-wide rate limits through Envoy's rate-limit service (with
 * Valkey, as on a control-plane member) and the Coraza WAF with the OWASP CRS, enforcing on one host and only
 * observing on another, with the configuration the control plane and the agent render.
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function get(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });

    req.on('error', reject);
    req.end();
  });
}

describe('ingress rate limits and WAF (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-it-protect-${run}`;
  const subnet = `10.${140 + (process.pid % 30)}.${Date.now() % 250}.0/24`;
  const prefix = subnet.split('.').slice(0, 3).join('.');
  const ip = { envoy: `${prefix}.10`, backend: `${prefix}.20`, limiter: `${prefix}.30` };
  const names = {
    envoy: `lw-it-protect-envoy-${run}`,
    backend: `lw-it-protect-backend-${run}`,
    limiter: `lw-it-protect-rl-${run}`,
    valkey: `lw-it-protect-valkey-${run}`,
  };
  const dir = mkdtempSync(join(tmpdir(), 'lw-it-protect-'));
  let port = 0;

  beforeAll(async () => {
    const upstream = 'shop/web/api:5000';
    const limitedRoute = routeId('limited.lab.test', '/');
    const ingress: Ingress = {
      addresses: [ip.envoy],
      sites: [
        {
          host: 'limited.lab.test',
          routes: [{ prefix: '/', upstream, rateLimit: { id: limitedRoute, perIp: true, total: false } }],
        },
        { host: 'waf.lab.test', routes: [{ prefix: '/', upstream }], waf: 'enforce' },
        { host: 'watch.lab.test', routes: [{ prefix: '/', upstream }], waf: 'monitor' },
      ],
      certificates: [],
      acmeChallenges: [],
      forwards: [],
      upstreams: [{ name: upstream, endpoints: [{ address: ip.backend, port: 5000 }] }],
      rateLimitService: { endpoints: [ip.limiter], port: 8081 },
      wafModule: { sha256: WAF_MODULE_SHA256 },
    };

    chmodSync(dir, 0o755);

    for (const sub of ['dynamic', 'waf', 'ratelimit']) mkdirSync(join(dir, sub), { mode: 0o755 });

    writeFileSync(join(dir, 'waf', 'coraza.wasm'), wafModule());
    writeFileSync(join(dir, 'bootstrap.json'), renderEnvoyBootstrap('lab'));
    writeFileSync(join(dir, 'dynamic', 'cds.json'), renderClusters(ingress));
    writeFileSync(join(dir, 'dynamic', 'lds.json'), renderListeners(ingress, { wafModule: true }));
    writeFileSync(
      join(dir, 'ratelimit', 'config.yaml'),
      renderRateLimitConfig([{ id: limitedRoute, limits: { perIp: { requests: 3, unit: 'minute' } } }]),
    );

    docker(['network', 'create', '--subnet', subnet, network]);
    docker([
      'run',
      '-d',
      '--name',
      names.backend,
      '--network',
      network,
      '--ip',
      ip.backend,
      '--memory',
      '128m',
      DEFAULT_REGISTRY_IMAGE,
    ]);
    // Like on a member: the limiter and Valkey share one network namespace, Valkey only on loopback.
    docker([
      'run',
      '-d',
      '--name',
      names.valkey,
      '--network',
      network,
      '--ip',
      ip.limiter,
      '--memory',
      '128m',
      DEFAULT_VALKEY_IMAGE,
      'valkey-server',
      '--bind',
      '127.0.0.1',
      '--port',
      String(VALKEY_PORT),
      '--save',
      '',
      '--appendonly',
      'no',
    ]);
    await new Promise((r) => setTimeout(r, 2000));
    docker([
      'run',
      '-d',
      '--name',
      names.limiter,
      '--network',
      `container:${names.valkey}`,
      '--memory',
      '128m',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '-e',
      'USE_STATSD=false',
      '-e',
      'LOG_LEVEL=warn',
      '-e',
      'REDIS_SOCKET_TYPE=tcp',
      '-e',
      `REDIS_URL=127.0.0.1:${VALKEY_PORT}`,
      '-e',
      'RUNTIME_ROOT=/config',
      '-e',
      'RUNTIME_SUBDIRECTORY=ratelimit',
      '-e',
      'RUNTIME_WATCH_ROOT=false',
      '-e',
      `GRPC_HOST=${ip.limiter}`,
      '-e',
      'GRPC_PORT=8081',
      '-e',
      'HOST=127.0.0.1',
      '-e',
      'PORT=8092',
      '-e',
      'DEBUG_HOST=127.0.0.1',
      '-e',
      'DEBUG_PORT=6071',
      '-v',
      `${dir}/ratelimit:/config/ratelimit/config:ro`,
      DEFAULT_RATELIMIT_IMAGE,
    ]);
    docker([
      'run',
      '-d',
      '--name',
      names.envoy,
      '--network',
      network,
      '--ip',
      ip.envoy,
      '-p',
      '127.0.0.1::80',
      '--memory',
      `${envoySpec(dir, '', DEFAULT_ENVOY_IMAGE, 4).memoryBytes}`,
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
      '-v',
      `${dir}/waf:/etc/envoy/waf:ro`,
      DEFAULT_ENVOY_IMAGE,
      'envoy',
      '-c',
      '/etc/envoy/bootstrap.json',
      '--log-level',
      'warn',
      '--concurrency',
      '4',
    ]);
    port = Number(docker(['port', names.envoy, '80/tcp']).split('\n')[0].split(':').pop());

    for (let i = 0; i < 120; i++) {
      if ((await get(port, '/v2/', 'watch.lab.test').catch(() => 0)) === 200) break;

      await new Promise((r) => setTimeout(r, 500));
    }
  }, 240_000);

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] !== '1') {
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
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('limits per client across the cluster-wide service', async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 5; i++) statuses.push(await get(port, '/v2/', 'limited.lab.test'));

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('blocks attacks on enforce hosts and only observes on monitor hosts', async () => {
    const attack = `/v2/?q=${encodeURIComponent('<script>alert(1)</script>')}`;

    expect(await get(port, '/v2/', 'waf.lab.test')).toBe(200);
    expect(await get(port, attack, 'waf.lab.test')).toBe(403);
    expect(await get(port, attack, 'watch.lab.test')).toBe(200);
  });
});
