import type { Server } from 'node:http';

import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { NodeEntity } from '../../entities/node.entity';
import { PlatformBackupGrants, PlatformObjectStore } from './platform-object-store';
import { gatewayAccessKeyId, gatewaySecret } from './platform-backups.utils';
import { S3Gateway, type GatewayRefusal } from './s3-gateway';
import { principalFor, type GatewayPrincipal } from './s3-gateway.rules';

const PRINCIPAL_CACHE_MS = 30_000;
/** Refusals are logged at most this often per principal and code (a misbehaving client retries a lot). */
const REFUSAL_LOG_MS = 60_000;

export type GatewayPrincipalWithSecret = GatewayPrincipal & { secretAccessKey: string };

/** Every client credential of the current control-plane members (WAL-G and OpenSearch on each member). */
export function memberPrincipals(
  encryptionKey: string,
  members: readonly string[],
): Map<string, GatewayPrincipalWithSecret> {
  const principals = new Map<string, GatewayPrincipalWithSecret>();

  for (const node of members) {
    for (const role of ['postgres', 'opensearch'] as const) {
      const id = gatewayAccessKeyId(encryptionKey, role, node);

      principals.set(id, { ...principalFor(role, id, node), secretAccessKey: gatewaySecret(encryptionKey, id) });
    }
  }

  return principals;
}

/** `host:port` of `LOADWEAVER_BACKUP_GATEWAY_LISTEN`, or null (no gateway on this replica). */
export function gatewayListenAddress(env: NodeJS.ProcessEnv = process.env): { host: string; port: number } | null {
  const raw = env['LOADWEAVER_BACKUP_GATEWAY_LISTEN'];
  const match = raw ? /^(\[[0-9a-fA-F:]+\]|[0-9.]+|localhost):(\d{2,5})$/.exec(raw.trim()) : null;

  if (!match) return null;

  const port = Number(match[2]);

  return port > 0 && port < 65536 ? { host: match[1].replace(/^\[|\]$/g, ''), port } : null;
}

/**
 * The platform-backup S3 gateway on a control-plane member (3.20): part of the control-plane API process, which
 * already derives the Garage keys from the cluster's encryption key, so no extra container, image or secret is
 * needed; listens on loopback only (its clients, WAL-G in Spilo and OpenSearch, run on the same member).
 */
@Injectable()
export class PlatformS3GatewayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PlatformS3GatewayService.name);
  private server: Server | null = null;
  private principals: { at: number; map: Map<string, GatewayPrincipalWithSecret> } | null = null;
  private readonly refusalLog = new Map<string, number>();
  readonly gateway: S3Gateway;
  readonly grants: PlatformBackupGrants;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly store: PlatformObjectStore,
  ) {
    this.grants = new PlatformBackupGrants(dataSource);
    this.gateway = new S3Gateway({
      resolvePrincipal: async (id) => (await this.currentPrincipals()).get(id) ?? null,
      upstream: async () => await this.store.upstream(),
      deleteGranted: async (principal, keys) => await this.grants.allows(principal, keys),
      writesPaused: async () => await this.store.writesPaused(),
      onRefused: (refusal) => this.logRefusal(refusal),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    const listen = gatewayListenAddress();

    if (!listen) return;

    this.server = this.gateway.createServer();
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(listen.port, listen.host, () => resolve());
    });
    this.logger.log(`Platform backup gateway listening on ${listen.host}:${listen.port}`);
  }

  async onModuleDestroy(): Promise<void> {
    const server = this.server;

    this.server = null;

    if (server) await new Promise((resolve) => server.close(resolve));
  }

  private async currentPrincipals(): Promise<Map<string, GatewayPrincipalWithSecret>> {
    if (this.principals && Date.now() - this.principals.at < PRINCIPAL_CACHE_MS) return this.principals.map;

    const key = process.env['ENCRYPTION_KEY'];
    const members = key
      ? (
          await this.dataSource
            .getRepository(NodeEntity)
            .find({ where: { controlPlane: true, witness: false, lifecycle: Not('left') } })
        ).map((n) => n.name)
      : [];

    this.principals = { at: Date.now(), map: key ? memberPrincipals(key, members) : new Map() };

    return this.principals.map;
  }

  private logRefusal(refusal: GatewayRefusal): void {
    const id = `${refusal.principal?.accessKeyId ?? 'unknown'}/${refusal.code}`;
    const last = this.refusalLog.get(id) ?? 0;

    if (Date.now() - last < REFUSAL_LOG_MS) return;

    this.refusalLog.set(id, Date.now());
    this.logger.warn(
      `Backup gateway refused ${refusal.method} ${refusal.key || '(bucket)'} for ${
        refusal.principal ? `${refusal.principal.role}@${refusal.principal.node ?? 'control-plane'}` : 'an unknown key'
      }: ${refusal.code} (${refusal.message})`,
    );
  }
}
