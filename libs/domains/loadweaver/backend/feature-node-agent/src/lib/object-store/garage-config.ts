import { createHash } from 'node:crypto';

import type { ObjectStoreGeneration } from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import type { ManagedContainerSpec } from '../host/managed-containers';
import { componentImage } from '../updates/release-images';

/** This build's pin (section 6, `COMPONENT_IMAGES`); the node runs its release's image instead (3.26). */
export const DEFAULT_GARAGE_IMAGE = COMPONENT_IMAGES['garage'];
export const OBJECT_STORE_COMPONENT = 'object-store';

export function garageImage(env: NodeJS.ProcessEnv = process.env): string {
  return componentImage('garage', env);
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
