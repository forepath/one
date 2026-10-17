import { CONTAINER_ENV, docker } from './postgres.container';

export default async function globalTeardown(): Promise<void> {
  const name = process.env[CONTAINER_ENV];

  if (name) docker(['rm', '-f', name]);
}
