import { mkdir, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { VmSpec, WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

import { SecretBroker } from '../workloads/secret-broker.service';

/** The control plane's placeholder for the node's DNS servers in a VM's network config (M7.3). */
export const VM_DNS_PLACEHOLDER = '${LW_DNS}';
/** `secret://<project>/<name>[@<version>]` inside user data (the control plane's `secretRefs` pattern). */
const SECRET_REF = /secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(?:@\d+)?/g;
/** Linux `statfs` magic numbers of memory-backed file systems (`TMPFS_MAGIC`, `RAMFS_MAGIC`). */
const MEMORY_FS = new Set([0x01021994, 0x858458f6]);
/** `seed-build` refuses larger files. */
const MAX_SEED_FILE_BYTES = 1024 * 1024;

export type VmCloudInit = NonNullable<VmSpec['cloudInit']>;

/** The NoCloud files of a VM (`meta-data`, `user-data`, optional `network-config`), rendered for this node. */
export interface SeedFiles {
  'meta-data': string;
  'user-data': string;
  'network-config'?: string;
}

/**
 * The network config (v2, JSON — valid YAML) as the guest gets it on this node: the `${LW_DNS}` placeholder in a
 * `nameservers.addresses` list replaced by the node's resolvers (dropped when there are none), and the MTU of the
 * launcher's interfaces on every NIC (the overlay MTU: the taps carry it, larger guest frames would be dropped).
 */
export function renderNetworkConfig(json: string, dnsServers: readonly string[], mtu?: number): string {
  let config: { ethernets?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

  try {
    config = JSON.parse(json);
  } catch {
    throw new Error('the VM network config is not valid JSON');
  }

  for (const nic of Object.values(config.ethernets ?? {})) {
    const nameservers = nic['nameservers'] as { addresses?: unknown[] } | undefined;

    if (Array.isArray(nameservers?.addresses))
      nameservers.addresses = nameservers.addresses.flatMap((a) => (a === VM_DNS_PLACEHOLDER ? [...dnsServers] : [a]));

    if (nameservers && Array.isArray(nameservers.addresses) && nameservers.addresses.length === 0)
      delete nameservers.addresses;

    if (mtu && nic['mtu'] === undefined) nic['mtu'] = mtu;
  }

  return JSON.stringify(config);
}

/**
 * Substitutes every `secret://` reference in user data with its value. Only references the control plane listed
 * (`secretRefs`) may appear; anything else is refused rather than passed to the guest as a literal.
 */
export function substituteSecretRefs(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(SECRET_REF, (ref) => {
    const value = values.get(ref);

    if (value === undefined) throw new Error(`user data references ${ref}, which the VM spec doesn't list`);

    return value;
  });
}

/** The seed files of a VM from its spec, the node's resolvers / MTU and the resolved secret values. */
export function seedFiles(
  cloudInit: VmCloudInit,
  node: { dnsServers: readonly string[]; mtu?: number },
  secrets: ReadonlyMap<string, string>,
): SeedFiles {
  const files: SeedFiles = {
    'meta-data': cloudInit.metaData,
    // NoCloud wants both files; an empty cloud-config does nothing.
    'user-data':
      cloudInit.userData !== undefined ? substituteSecretRefs(cloudInit.userData, secrets) : '#cloud-config\n',
    ...(cloudInit.networkConfig !== undefined
      ? { 'network-config': renderNetworkConfig(cloudInit.networkConfig, node.dnsServers, node.mtu) }
      : {}),
  };

  for (const [name, content] of Object.entries(files))
    if (Buffer.byteLength(content as string) > MAX_SEED_FILE_BYTES)
      throw new Error(`the cloud-init ${name} is larger than 1 MiB`);

  return files;
}

/**
 * The NoCloud seed of a full VM (3.35, M7.3): rendered on every start into `seed/` of the launcher's run directory
 * (tmpfs, root only), from which the launcher builds the read-only CIDATA image on its own `/dev/shm`. `secret://`
 * references are resolved through the secret broker (only for this workload) and substituted in memory; their values
 * exist on tmpfs only, never on disk, and the files go with the run directory. A VM without cloud-init gets no seed.
 */
@Injectable()
export class CloudInitSeed {
  constructor(private readonly secrets: SecretBroker) {}

  /** Refuses to write secret material anywhere but a memory file system. */
  async assertMemoryFs(dir: string): Promise<void> {
    const fs = await statfs(dir);

    if (!MEMORY_FS.has(Number(fs.type))) throw new Error(`${dir} is not tmpfs; refusing to write the cloud-init seed`);
  }

  /** Writes (or removes) `<runDir>/seed`; returns whether the VM has a seed. */
  async write(
    spec: Pick<WorkloadSpec, 'id' | 'vm'>,
    runDir: string,
    node: { dnsServers: readonly string[]; mtu?: number },
  ): Promise<boolean> {
    const dir = join(runDir, 'seed');
    const cloudInit = spec.vm?.cloudInit;

    await rm(dir, { recursive: true, force: true });

    if (!cloudInit) return false;

    await this.assertMemoryFs(runDir);

    const values = new Map<string, string>();

    for (const ref of cloudInit.secretRefs) {
      const value = await this.secrets.fetch(spec.id, ref);

      try {
        values.set(ref, value.toString('utf8'));
      } finally {
        value.fill(0);
      }
    }

    const files = seedFiles(cloudInit, node, values);

    await mkdir(dir, { mode: 0o700 });

    for (const [name, content] of Object.entries(files))
      await writeFile(join(dir, name), content as string, { mode: 0o600, flag: 'wx' });

    return true;
  }
}
