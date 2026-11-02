import { parseImageReference } from '@forepath/loadweaver/shared/util-compose';
import { PRIVATE_REGISTRY_HOST } from '@forepath/loadweaver/shared/util-model';
import { signJwtEs256 } from '@forepath/loadweaver/shared/util-pki';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';

import { VmCommandEntity } from '../entities/virtual-machine.entities';
import { ensureRegistryTokenKey, type RegistryTokenKey } from '../object-store/registry-token-key';
import { REGISTRY_TOKEN_ISSUER, REGISTRY_TOKEN_SERVICE } from '../object-store/registry-state.utils';
import { SYSTEM_REPOSITORY_PREFIX } from '../updates/registry-import';
import { NetworkStateService } from './network-state.service';

/** Node pull tokens are short: the router asks again when it needs to. */
export const NODE_PULL_TOKEN_SECONDS = 300;

export interface RegistryAccess {
  name: string;
  actions: ('pull' | 'push')[];
}

/**
 * Tokens for the built-in private registry (3.22): ES256 JWTs signed with the cluster's dedicated registry-token
 * key; its self-signed certificate travels as x5c and is the registry's only trust root. The cluster CA is not
 * trusted by the registry, so no node certificate can sign tokens.
 */
@Injectable()
export class RegistryTokenService {
  private key: Promise<RegistryTokenKey> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
  ) {}

  /** The registry-token key, created once per cluster. */
  async tokenKey(): Promise<RegistryTokenKey> {
    this.key ??= this.loadKey().catch((error: unknown) => {
      this.key = null;
      throw error;
    });

    return await this.key;
  }

  private async loadKey(): Promise<RegistryTokenKey> {
    return await this.dataSource.transaction((manager) => ensureRegistryTokenKey(manager));
  }

  async issue(subject: string, access: RegistryAccess[], ttlSeconds: number, now = Date.now()): Promise<string> {
    return await this.sign(
      subject,
      access.map((a) => ({ type: 'repository', name: a.name, actions: a.actions })),
      ttlSeconds,
      now,
    );
  }

  /**
   * A token that may also list the registry's repositories (`/v2/_catalog`, distribution's `registry:catalog:*`):
   * the control plane's VM image listing (3.35) and callers with a cluster role. Never handed to nodes.
   */
  async issueWithCatalog(subject: string, access: RegistryAccess[], ttlSeconds: number): Promise<string> {
    return await this.sign(
      subject,
      [
        { type: 'registry', name: 'catalog', actions: ['*'] },
        ...access.map((a) => ({ type: 'repository', name: a.name, actions: a.actions as string[] })),
      ],
      ttlSeconds,
      Date.now(),
    );
  }

  private async sign(
    subject: string,
    access: { type: string; name: string; actions: string[] }[],
    ttlSeconds: number,
    now: number,
  ): Promise<string> {
    const key = await this.tokenKey();
    const seconds = Math.floor(now / 1000);

    return signJwtEs256(
      {
        iss: REGISTRY_TOKEN_ISSUER,
        sub: subject,
        aud: REGISTRY_TOKEN_SERVICE,
        iat: seconds,
        nbf: seconds - 30,
        exp: seconds + ttlSeconds,
        access,
      },
      key.privateKeyPem,
      key.certificatePem,
    );
  }

  /**
   * A node may pull exactly the private repositories its own desired workloads (and its release) use: container
   * images, VM boot images (3.35, the boot-disk import pulls the VM image's disk layer) and the images of re-imaging
   * commands still open for the node (a stopped VM has no workload). G5: the VM boot image was missing → every VM
   * from the built-in registry failed with "pull token refused".
   */
  async issueForNode(nodeName: string, repositories: string[]): Promise<string> {
    const state = await this.network.getDesiredState(nodeName);
    const reimages = await this.dataSource.getRepository(VmCommandEntity).find({
      where: { node: nodeName, type: 'vmImageImport', status: In(['pending', 'sent', 'running']) },
    });
    const allowed = new Set(
      [
        ...(state?.workloads ?? []).flatMap((w) => [w.image, ...(w.vm ? [w.vm.image.ref] : [])]),
        ...reimages.map((c) => (c.payload['image'] as { ref?: unknown } | undefined)?.ref),
      ]
        .filter((ref): ref is string => typeof ref === 'string')
        .map((ref) => parseImageReference(ref))
        .filter((r) => r?.host === PRIVATE_REGISTRY_HOST)
        .map((r) => r?.repository),
    );

    // Release images imported from a bundle (3.26): the components the node's target release names.
    for (const component of state?.components?.clusterImages ?? [])
      allowed.add(`${SYSTEM_REPOSITORY_PREFIX}/${component}`);
    const denied = repositories.filter((r) => !allowed.has(r));

    if (denied.length > 0) throw new Error(`no workload on ${nodeName} uses ${denied.join(', ')}`);

    return await this.issue(
      `node:${nodeName}`,
      repositories.map((name) => ({ name, actions: ['pull'] })),
      NODE_PULL_TOKEN_SECONDS,
    );
  }
}
