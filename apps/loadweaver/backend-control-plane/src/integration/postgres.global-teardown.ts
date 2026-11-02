import { CONTAINER_ENV, docker, VALKEY_CONTAINER_ENV } from './postgres.container';

export default async function globalTeardown(): Promise<void> {
  for (const name of [process.env[CONTAINER_ENV], process.env[VALKEY_CONTAINER_ENV]])
    if (name) docker(['rm', '-f', name]);
}
