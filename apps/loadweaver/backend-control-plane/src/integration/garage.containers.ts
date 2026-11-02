import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { docker } from './postgres.container';

/** Same digest-pinned image the node agent runs (section 6). */
export const GARAGE_IMAGE =
  'docker.io/dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020';

export interface GarageContainer {
  name: string;
  adminUrl: string;
  s3Url: string;
}

const configDirs: string[] = [];

/** Starts one Garage node for a test; `network` + `ip` place it at a node's overlay address for peering. */
export function startGarage(options: {
  name: string;
  replicationFactor: number;
  ports: { s3: number; rpc: number; admin: number };
  rpcSecret: string;
  adminToken: string;
  rpcPublicAddress: string;
  network?: { name: string; ip: string };
}): GarageContainer {
  const config = [
    'metadata_dir = "/var/lib/garage/meta"',
    'data_dir = "/var/lib/garage/data"',
    'db_engine = "sqlite"',
    `replication_factor = ${options.replicationFactor}`,
    `rpc_bind_addr = "[::]:${options.ports.rpc}"`,
    `rpc_public_addr = "${options.rpcPublicAddress}:${options.ports.rpc}"`,
    `rpc_secret = "${options.rpcSecret}"`,
    '[s3_api]',
    's3_region = "garage"',
    `api_bind_addr = "[::]:${options.ports.s3}"`,
    '[admin]',
    `api_bind_addr = "[::]:${options.ports.admin}"`,
    `admin_token = "${options.adminToken}"`,
  ].join('\n');

  const dir = mkdtempSync(join(tmpdir(), 'lw-it-garage-'));

  configDirs.push(dir);
  writeFileSync(join(dir, 'garage.toml'), config, { mode: 0o644 });
  const run = (args: string[]) => {
    try {
      docker(args);
    } catch (error) {
      // A failed `run` can leave a created container behind.
      try {
        docker(['rm', '-f', options.name]);
      } catch {
        // nothing to remove
      }

      throw error;
    }
  };

  run([
    'run',
    '-d',
    '--name',
    options.name,
    ...(options.network ? ['--network', options.network.name, '--ip', options.network.ip] : []),
    '-p',
    `127.0.0.1::${options.ports.admin}`,
    '-p',
    `127.0.0.1::${options.ports.s3}`,
    '-v',
    `${dir}/garage.toml:/etc/garage.toml:ro`,
    GARAGE_IMAGE,
  ]);

  const port = (p: number) =>
    docker(['port', options.name, `${p}/tcp`])
      .split('\n')[0]
      .split(':')
      .pop();

  return {
    name: options.name,
    adminUrl: `http://127.0.0.1:${port(options.ports.admin)}`,
    s3Url: `http://127.0.0.1:${port(options.ports.s3)}`,
  };
}

export function removeContainers(names: string[]): void {
  for (const name of names) {
    try {
      docker(['rm', '-f', name]);
    } catch {
      // already gone
    }
  }

  for (const dir of configDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
