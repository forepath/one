import { hkdfSync } from 'node:crypto';

import type { PlatformBackupsRole } from './messages';

/**
 * The members' platform-backup S3 gateway (3.20): constants and the per-member client credentials, derived (HKDF)
 * from the cluster's encryption key. Shared by the control plane (desired state, gateway) and the node agent, whose
 * `bootstrap` starts Postgres with the same WAL-G settings the first apply pushes (user decision 2026-10-27:
 * "bootstrap with the final config", so the first apply doesn't re-create Postgres).
 */

/** Default port of the members' S3 gateway (loopback). */
export const DEFAULT_GATEWAY_PORT = 7480;
/** The Garage bucket of all control-plane backups (WAL-G, OpenSearch snapshots, etcd snapshots, DR envelopes). */
export const PLATFORM_BUCKET = 'lw-platform';
export const GATEWAY_REGION = 'garage';

export type GatewayClientRole = 'postgres' | 'opensearch';

function derive(key: string, label: string, bytes: number): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(key, 'utf8'), Buffer.alloc(0), `loadweaver/${label}`, bytes));
}

/**
 * Gateway access key of one client on one member, derived (HKDF) from the cluster's encryption key: stable across
 * object-store generations, nothing stored. Upper-case alphanumerics (what WAL-G / the AWS SDKs accept).
 */
export function gatewayAccessKeyId(encryptionKey: string, role: GatewayClientRole, node: string): string {
  return `LWPB${derive(encryptionKey, `platform-backups/gateway/${role}/${node}/id`, 12).toString('hex').toUpperCase()}`;
}

export function gatewaySecret(encryptionKey: string, accessKeyId: string): string {
  return derive(encryptionKey, `platform-backups/gateway/${accessKeyId}/secret`, 32).toString('hex');
}

/** The gateway port from `LOADWEAVER_BACKUP_GATEWAY_PORT` (unprivileged ports only), else the default. */
export function gatewayPortFrom(value: string | undefined): number {
  const port = Number(value ?? DEFAULT_GATEWAY_PORT);

  return Number.isInteger(port) && port >= 1024 && port < 65536 ? port : DEFAULT_GATEWAY_PORT;
}

/**
 * A member's `platformBackups` without a clone / cut-over, with the push-time secrets: what a fresh cluster's first
 * desired state carries for its bootstrap node (platform backups are enabled by default).
 */
export function memberPlatformBackups(
  encryptionKey: string,
  node: string,
  gatewayPort: number = DEFAULT_GATEWAY_PORT,
): PlatformBackupsRole {
  const credential = (role: GatewayClientRole) => {
    const accessKeyId = gatewayAccessKeyId(encryptionKey, role, node);

    return { accessKeyId, secretAccessKey: gatewaySecret(encryptionKey, accessKeyId) };
  };

  return {
    gatewayPort,
    bucket: PLATFORM_BUCKET,
    region: GATEWAY_REGION,
    postgres: credential('postgres'),
    opensearch: credential('opensearch'),
  };
}
