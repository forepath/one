import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RateLimiter } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

import { ManagedContainers, type ManagedContainerSpec } from '../host/managed-containers';
import { AgentStateStore } from '../state/agent-state.store';

/** Pinned by digest (section 6); overridden by the release bundle (3.26). */
export const DEFAULT_RATELIMIT_IMAGE =
  'docker.io/envoyproxy/ratelimit:f4e76690@sha256:83b1664a194ff9fc1ff30b0868573115a2d01a1b6e2a3f8961724f9a79bf1cd0';
export const DEFAULT_VALKEY_IMAGE =
  'docker.io/valkey/valkey:9.0.6-alpine@sha256:187679e3bd4036959631e3f03983ab2ba503ab21e6fd0454d508e909db2ee989';
export const RATELIMIT_COMPONENT = 'ratelimit';
export const RATELIMIT_CONTAINER = 'lw-ratelimit';
export const VALKEY_CONTAINER = 'lw-ratelimit-valkey';
/** Valkey listens on loopback only; counters are ephemeral by design. */
export const VALKEY_PORT = 6390;

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

const HARDENING = { capDrop: ['ALL'], readOnlyRootfs: true, noNewPrivileges: true, tmpfs: ['/tmp', '/data'] };

export function valkeySpec(image: string): ManagedContainerSpec {
  const cmd = [
    'valkey-server',
    '--bind',
    '127.0.0.1',
    '--port',
    String(VALKEY_PORT),
    '--save',
    '',
    '--appendonly',
    'no',
    '--protected-mode',
    'yes',
    '--maxmemory',
    '128mb',
    '--maxmemory-policy',
    'volatile-ttl',
  ];

  return {
    name: VALKEY_CONTAINER,
    image,
    cmd,
    env: {},
    binds: [],
    memoryBytes: 192 * 1024 ** 2,
    hash: hash({ image, cmd }),
    component: RATELIMIT_COMPONENT,
    hardening: { ...HARDENING, capAdd: ['SETUID', 'SETGID'] },
  };
}

export function rateLimitSpec(
  image: string,
  dir: string,
  overlayAddress: string,
  limiter: RateLimiter,
): ManagedContainerSpec {
  const env = {
    USE_STATSD: 'false',
    LOG_LEVEL: 'warn',
    REDIS_SOCKET_TYPE: 'tcp',
    REDIS_URL: `127.0.0.1:${VALKEY_PORT}`,
    RUNTIME_ROOT: '/config',
    RUNTIME_SUBDIRECTORY: 'ratelimit',
    RUNTIME_WATCH_ROOT: 'false',
    GRPC_HOST: overlayAddress,
    GRPC_PORT: String(limiter.port),
    HOST: '127.0.0.1',
    PORT: '8092',
    DEBUG_HOST: '127.0.0.1',
    DEBUG_PORT: '6071',
  };

  return {
    name: RATELIMIT_CONTAINER,
    image,
    env,
    binds: [`${dir}:/config/ratelimit/config:ro`],
    memoryBytes: 128 * 1024 ** 2,
    // A new configuration re-creates the service; counters live in Valkey and survive.
    hash: hash({ image, env, config: limiter.config }),
    component: RATELIMIT_COMPONENT,
    hardening: HARDENING,
  };
}

/** The cluster-wide rate-limit service on a control-plane member (3.6). */
@Injectable()
export class RateLimiterManager {
  constructor(
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
  ) {}

  private get dir(): string {
    return join(this.state.dir, 'ratelimit');
  }

  async apply(limiter: RateLimiter | undefined, overlayAddress: string): Promise<boolean> {
    if (!limiter) {
      const a = await this.containers.remove(RATELIMIT_CONTAINER);
      const b = await this.containers.remove(VALKEY_CONTAINER);

      await rm(this.dir, { recursive: true, force: true });

      return a || b;
    }

    await mkdir(this.dir, { recursive: true, mode: 0o755 });
    await writeFile(join(this.dir, 'config.yaml'), limiter.config, { mode: 0o644 });

    const valkey = await this.containers.ensure(valkeySpec(DEFAULT_VALKEY_IMAGE));
    const service = await this.containers.ensure(
      rateLimitSpec(
        process.env['LOADWEAVER_RATELIMIT_IMAGE'] || DEFAULT_RATELIMIT_IMAGE,
        this.dir,
        overlayAddress,
        limiter,
      ),
    );

    return valkey || service;
  }
}
