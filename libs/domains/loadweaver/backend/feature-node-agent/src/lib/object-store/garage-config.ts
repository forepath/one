import { createHash } from 'node:crypto';

import type { ObjectStoreGeneration } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { ManagedContainerSpec } from '../host/managed-containers';

/** Pinned by digest (section 6); overridden by the release bundle (3.26). */
export const DEFAULT_GARAGE_IMAGE =
  'docker.io/dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020';
export const OBJECT_STORE_COMPONENT = 'object-store';

export function garageImage(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_GARAGE_IMAGE'] || DEFAULT_GARAGE_IMAGE;
}

export function garageContainerName(generation: number): string {
  return `lw-garage-g${generation}`;
}

function socket(address: string, port: number): string {
  return `${address.includes(':') ? `[${address}]` : address}:${port}`;
}

/**
 * Garage configuration for one generation (3.20). Every API binds to the overlay address only: replication runs
 * over WireGuard and the built-in object-store policy restricts who may connect. Values are validated by the
 * protocol schema (hex secrets, integers, IP literals), so plain interpolation is safe.
 */
export function renderGarageConfig(generation: ObjectStoreGeneration, overlayAddress: string): string {
  if (!generation.rpcSecret || !generation.adminToken)
    throw new Error(`object-store generation ${generation.generation} arrived without its secrets`);

  return [
    'metadata_dir = "/var/lib/garage/meta"',
    'data_dir = "/var/lib/garage/data"',
    'db_engine = "lmdb"',
    'metadata_auto_snapshot_interval = "6h"',
    `replication_factor = ${generation.replicationFactor}`,
    `rpc_bind_addr = "${socket(overlayAddress, generation.ports.rpc)}"`,
    `rpc_public_addr = "${socket(overlayAddress, generation.ports.rpc)}"`,
    `rpc_secret = "${generation.rpcSecret}"`,
    '',
    '[s3_api]',
    's3_region = "garage"',
    `api_bind_addr = "${socket(overlayAddress, generation.ports.s3)}"`,
    '',
    '[admin]',
    `api_bind_addr = "${socket(overlayAddress, generation.ports.admin)}"`,
    `admin_token = "${generation.adminToken}"`,
    '',
  ].join('\n');
}

export function garageSpec(
  generation: ObjectStoreGeneration,
  config: string,
  dir: string,
  image: string,
): ManagedContainerSpec {
  return {
    name: garageContainerName(generation.generation),
    image,
    env: {},
    binds: [
      `${dir}/garage.toml:/etc/garage.toml:ro`,
      `${dir}/meta:/var/lib/garage/meta`,
      `${dir}/data:/var/lib/garage/data`,
    ],
    memoryBytes: 512 * 1024 ** 2,
    hash: createHash('sha256').update(JSON.stringify({ image, config })).digest('hex').slice(0, 16),
    component: OBJECT_STORE_COMPONENT,
  };
}
