import { parseImageReference } from '@forepath/loadweaver/shared/util-compose';
import { PRIVATE_REGISTRY_HOST } from '@forepath/loadweaver/shared/util-model';
import { signJwtEs256 } from '@forepath/loadweaver/shared/util-pki';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

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
        access: access.map((a) => ({ type: 'repository', name: a.name, actions: a.actions })),
      },
      key.privateKeyPem,
      key.certificatePem,
    );
  }

  /** A node may pull exactly the private repositories its own desired workloads (and its release) use. */
  async issueForNode(nodeName: string, repositories: string[]): Promise<string> {
    const state = await this.network.getDesiredState(nodeName);
    const allowed = new Set(
      (state?.workloads ?? [])
        .map((w) => parseImageReference(w.image))
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
