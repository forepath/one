import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  backupScopeSchema,
  kopiaPasswordHash,
  kopiaServerScript,
  type BackupRepositoryServer,
  type BackupServerRole,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, Logger } from '@nestjs/common';

import { ManagedContainers, type ManagedContainerSpec } from '../host/managed-containers';
import { AgentStateStore } from '../state/agent-state.store';
import { componentImage } from '../updates/release-images';

export const BACKUP_SERVER_COMPONENT = 'backup-server';
const CONTAINER_PREFIX = 'lw-kopia-';

export function kopiaImage(env: NodeJS.ProcessEnv = process.env): string {
  return componentImage('kopia', env);
}

export function kopiaServerContainerName(scope: string): string {
  return `${CONTAINER_PREFIX}${scope}`;
}

/** Secrets of a repository server; they arrive with the desired state at push time only. */
function secretsOf(server: BackupRepositoryServer) {
  const { accessKeyId, secretAccessKey, password, controlPassword, serverControlPassword } = server;
  const privateKeyPem = server.tls.privateKeyPem;

  if (!accessKeyId || !secretAccessKey || !password || !controlPassword || !serverControlPassword || !privateKeyPem)
    throw new Error(`backup repository server ${server.scope} arrived without its secrets`);

  return { accessKeyId, secretAccessKey, password, controlPassword, serverControlPassword, privateKeyPem };
}

/** `kopiaPasswordHash` is a deliberately slow scrypt; deterministic, so computed once per password. */
const passwordHashes = new Map<string, string>();

function controlPasswordHash(password: string): string {
  let hash = passwordHashes.get(password);

  if (!hash) {
    hash = kopiaPasswordHash(password);
    if (passwordHashes.size >= 512) passwordHashes.clear();

    passwordHashes.set(password, hash);
  }

  return hash;
}

/**
 * Container of one repository server (3.20): the `kopia/kopia` image with a shell entrypoint running
 * `kopiaServerScript` (connect / create the repository on the object store, reconcile the ACL, ensure the control
 * plane's user and the global policy, serve over TLS). Secrets travel only in the environment, never in the
 * arguments; the spec hash covers them (as a digest) so a rotated secret re-creates the container.
 */
/** Memory of a repository server container. */
export const KOPIA_SERVER_MEMORY_BYTES = 1024 ** 3;

/**
 * Go's soft memory limit for a Kopia container (`GOMEMLIMIT`, 80 % of its hard limit): without it the heap grows
 * past the container limit under upload load (G5: a repository server was OOM-killed taking a 4 GiB VM disk).
 */
export function kopiaGoMemoryLimit(memoryBytes: number): string {
  return `${Math.floor((memoryBytes * 0.8) / 1024 ** 2)}MiB`;
}

export function kopiaServerSpec(server: BackupRepositoryServer, dir: string, image: string): ManagedContainerSpec {
  const secrets = secretsOf(server);
  const script = kopiaServerScript(server);
  const secretDigest = createHash('sha256').update(JSON.stringify(secrets)).digest('hex');

  return {
    name: kopiaServerContainerName(server.scope),
    image,
    entrypoint: ['/bin/sh', '-c'],
    cmd: [script],
    env: {
      KOPIA_PASSWORD: secrets.password,
      AWS_ACCESS_KEY_ID: secrets.accessKeyId,
      AWS_SECRET_ACCESS_KEY: secrets.secretAccessKey,
      LW_CONTROL_PASSWORD_HASH: controlPasswordHash(secrets.controlPassword),
      KOPIA_SERVER_CONTROL_PASSWORD: secrets.serverControlPassword,
      KOPIA_CHECK_FOR_UPDATES: 'false',
      GOMEMLIMIT: kopiaGoMemoryLimit(KOPIA_SERVER_MEMORY_BYTES),
    },
    binds: [`${dir}/app:/app`, `${dir}/tls:/tls:ro`],
    memoryBytes: KOPIA_SERVER_MEMORY_BYTES,
    hash: createHash('sha256')
      .update(
        JSON.stringify({
          image,
          script,
          cert: server.tls.certificatePem,
          secretDigest,
          goMemoryLimit: kopiaGoMemoryLimit(KOPIA_SERVER_MEMORY_BYTES),
        }),
      )
      .digest('hex')
      .slice(0, 16),
    component: BACKUP_SERVER_COMPONENT,
  };
}

/**
 * The Kopia repository servers a control-plane member runs (desired state `backupServer`, 3.20): one per
 * repository, each with its state (`backups/<scope>/app`: config, cache, logs) and TLS files (`backups/<scope>/tls`)
 * under the agent's state directory. Servers no longer wanted are removed with their local state; the repository
 * itself stays in the object store.
 */
@Injectable()
export class KopiaServerManager {
  private readonly logger = new Logger(KopiaServerManager.name);

  constructor(
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
  ) {}

  private get root(): string {
    return join(this.state.dir, 'backups');
  }

  async apply(role: BackupServerRole | undefined): Promise<boolean> {
    const repositories = role?.repositories ?? [];
    const wanted = new Set(repositories.map((r) => r.scope));
    let changed = false;

    for (const server of repositories) {
      const dir = join(this.root, server.scope);
      const spec = kopiaServerSpec(server, dir, kopiaImage());

      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await mkdir(join(dir, 'app'), { recursive: true, mode: 0o700 });
      await mkdir(join(dir, 'tls'), { recursive: true, mode: 0o700 });
      await writeFile(join(dir, 'tls', 'tls.crt'), server.tls.certificatePem, { mode: 0o600 });
      await writeFile(join(dir, 'tls', 'tls.key'), secretsOf(server).privateKeyPem, { mode: 0o600 });
      changed = (await this.containers.ensure(spec)) || changed;
    }

    for (const name of await this.containers.list(BACKUP_SERVER_COMPONENT)) {
      if (!name.startsWith(CONTAINER_PREFIX) || wanted.has(name.slice(CONTAINER_PREFIX.length))) continue;

      changed = (await this.containers.remove(name)) || changed;
      this.logger.log(`Removed backup repository server ${name}`);
    }

    for (const entry of await readdir(this.root).catch(() => [] as string[])) {
      if (!backupScopeSchema.safeParse(entry).success || wanted.has(entry)) continue;

      await this.containers.remove(kopiaServerContainerName(entry));
      await rm(join(this.root, entry), { recursive: true, force: true });
      changed = true;
    }

    return changed;
  }
}
