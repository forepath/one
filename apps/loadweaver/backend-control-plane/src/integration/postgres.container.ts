import { execFileSync } from 'node:child_process';

/** Same digest-pinned image as docker-compose.yaml (section 6: images pinned by digest). */
export const POSTGRES_IMAGE =
  'docker.io/library/postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297';

export const CONTAINER_ENV = 'LW_IT_POSTGRES_CONTAINER';
export const PORT_ENV = 'LW_IT_POSTGRES_PORT';

export function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
