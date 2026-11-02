import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RateLimiter } from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';
import { Injectable } from '@nestjs/common';

import { ManagedContainers, type ManagedContainerSpec } from '../host/managed-containers';
import { AgentStateStore } from '../state/agent-state.store';
import { localSecret } from '../host/local-secret';
import { componentImage } from '../updates/release-images';

/** This build's pins (section 6, `COMPONENT_IMAGES`); the node runs its release's images instead (3.26). */
export const DEFAULT_RATELIMIT_IMAGE = COMPONENT_IMAGES['ratelimit'];
export const DEFAULT_VALKEY_IMAGE = COMPONENT_IMAGES['valkey'];
export const RATELIMIT_COMPONENT = 'ratelimit';
export const RATELIMIT_CONTAINER = 'lw-ratelimit';
export const VALKEY_CONTAINER = 'lw-ratelimit-valkey';
/** Valkey listens on loopback only; counters are ephemeral by design. */
export const VALKEY_PORT = 6390;

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

const HARDENING = { capDrop: ['ALL'], readOnlyRootfs: true, noNewPrivileges: true, tmpfs: ['/tmp', '/data'] };

export function valkeySpec(image: string, password?: string): ManagedContainerSpec {
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
    // Local processes on the member can't reset or read the counters without it.
    ...(password ? ['--requirepass', password] : []),
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
  password?: string,
): ManagedContainerSpec {
  const env = {
    ...(password ? { REDIS_AUTH: password } : {}),
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

    const password = await localSecret(this.state.dir, 'ratelimit');
    const valkey = await this.containers.ensure(valkeySpec(componentImage('valkey'), password));
    const service = await this.containers.ensure(
      rateLimitSpec(componentImage('ratelimit'), this.dir, overlayAddress, limiter, password),
    );

    return valkey || service;
  }
}
