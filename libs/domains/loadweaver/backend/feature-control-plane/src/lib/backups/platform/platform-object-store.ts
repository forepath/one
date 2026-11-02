import type { S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, MoreThan } from 'typeorm';

import { NodeEntity } from '../../entities/node.entity';
import { ObjectStoreGenerationEntity } from '../../entities/object-store-generation.entity';
import { garageS3Client } from '../../object-store/bucket-copy';
import { GarageAdminClient } from '../../object-store/garage-admin.client';
import { objectStorePorts, objectStoreSecrets } from '../../object-store/object-store.utils';
import { nodeAddress } from '../../services/object-store-controller.service';
import { PlatformBackupGrantEntity } from './platform-backups.entities';
import { platformGarageKey } from './platform-backups.utils';
import { GATEWAY_REGION, PLATFORM_BUCKET, type GatewayPrincipal } from './s3-gateway.rules';
import type { UpstreamTarget } from './s3-gateway';

const TARGET_CACHE_MS = 5_000;

export interface PlatformTarget extends UpstreamTarget {
  generation: number;
}

function encryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) throw new Error('ENCRYPTION_KEY is required for platform backups');

  return key;
}

/**
 * The platform bucket on the cluster's object store (3.20): the active Garage generation, the gateway's own key
 * (derived per generation, ensured once per generation and replica). Generation switches pause client writes
 * during the final copy pass, so no WAL segment lands in the old generation after it was copied.
 */
@Injectable()
export class PlatformObjectStore {
  private ready = new Set<number>();
  private cached: { at: number; target: PlatformTarget; endpoints: string[] } | null = null;
  private next = 0;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Where the control plane reaches a holder's S3 port (the overlay; overridable for tests). */
  protected endpoint(node: NodeEntity, port: number): string | null {
    const address = nodeAddress(node);

    return address ? `http://${address}:${port}` : null;
  }

  private async resolve(): Promise<{ target: PlatformTarget; endpoints: string[] }> {
    if (this.cached && Date.now() - this.cached.at < TARGET_CACHE_MS) return this.cached;

    const active = await this.dataSource
      .getRepository(ObjectStoreGenerationEntity)
      .findOne({ where: { state: 'active' } });

    if (!active) throw new Error('the object store is not active yet');

    const nodes = (await this.dataSource.getRepository(NodeEntity).find({ order: { name: 'ASC' } })).filter((n) =>
      active.holders.includes(n.name),
    );
    const ports = objectStorePorts(active.generation);
    const endpoints = nodes.map((n) => this.endpoint(n, ports.s3)).filter((e): e is string => !!e);

    if (endpoints.length === 0) throw new Error(`object-store generation ${active.generation} has no reachable holder`);

    const key = platformGarageKey(encryptionKey(), active.generation);

    if (!this.ready.has(active.generation)) {
      const holder = nodes.find((n) => this.endpoint(n, ports.admin));
      const admin = new GarageAdminClient(
        this.endpoint(holder as NodeEntity, ports.admin) as string,
        objectStoreSecrets(encryptionKey(), active.generation).adminToken,
      );

      await admin.ensureKey(key.accessKeyId, key.secretAccessKey, 'lw-platform');
      await admin.ensureBucket(PLATFORM_BUCKET, key.accessKeyId);
      this.ready.add(active.generation);
    }

    this.cached = {
      at: Date.now(),
      endpoints,
      target: { generation: active.generation, endpoint: endpoints[0], region: GATEWAY_REGION, ...key },
    };

    return this.cached;
  }

  /** The upstream for the next gateway request (round robin over the holders). */
  async upstream(): Promise<PlatformTarget> {
    const { target, endpoints } = await this.resolve();

    this.next = (this.next + 1) % endpoints.length;

    return { ...target, endpoint: endpoints[this.next] };
  }

  /** An S3 client with the gateway's key for the control plane's own reads / writes / retention. */
  async client(): Promise<S3Client> {
    const target = await this.upstream();

    return garageS3Client(target.endpoint, target.accessKeyId, target.secretAccessKey);
  }

  /** Client writes wait while a new generation takes its final copy (registries are read-only then, too). */
  async writesPaused(): Promise<string | null> {
    const copying = await this.dataSource
      .getRepository(ObjectStoreGenerationEntity)
      .findOne({ where: { state: 'copying' } });

    return copying?.copy && copying.copy.phase !== 'live'
      ? 'the object store is switching generations; retry shortly'
      : null;
  }

  /** Forgets the cached target (tests, generation switches). */
  invalidate(): void {
    this.cached = null;
  }
}

/** Delete grants of the retention (3.20): open for one run, checked by every member's gateway. */
export class PlatformBackupGrants {
  constructor(private readonly dataSource: DataSource) {}

  /** `keys`: the exact keys the run may delete (null: anything under `prefix`). */
  async open(
    role: 'postgres' | 'opensearch',
    prefix: string,
    reason: string,
    ttlMs: number,
    keys: string[] | null = null,
  ): Promise<string> {
    const repo = this.dataSource.getRepository(PlatformBackupGrantEntity);
    const saved = await repo.save(repo.create({ role, prefix, reason, keys, expiresAt: new Date(Date.now() + ttlMs) }));

    return saved.id;
  }

  async close(id: string): Promise<void> {
    const repo = this.dataSource.getRepository(PlatformBackupGrantEntity);

    await repo.delete({ id });
    // Expired grants of crashed runs.
    await repo.delete({ expiresAt: LessThanOrEqual(new Date(Date.now() - 3_600_000)) });
  }

  async allows(principal: GatewayPrincipal, keys: string[]): Promise<boolean> {
    if (principal.role === 'control-plane') return true;

    const grants = await this.dataSource
      .getRepository(PlatformBackupGrantEntity)
      .find({ where: { role: principal.role, expiresAt: MoreThan(new Date()) } });

    return grantsAllow(grants, keys);
  }
}

/** Every key must lie under a grant's prefix and, for a key-bound grant, be one of its keys (M6 review L4). */
export function grantsAllow(
  grants: readonly Pick<PlatformBackupGrantEntity, 'prefix' | 'keys'>[],
  keys: string[],
): boolean {
  const bound = grants.map((g) => ({ prefix: g.prefix, keys: g.keys ? new Set(g.keys) : null }));

  return keys.length > 0 && keys.every((k) => bound.some((g) => k.startsWith(g.prefix) && (!g.keys || g.keys.has(k))));
}
