/** Docker Hub, as images name it; its registry API lives at `registry-1.docker.io`. */
export const DOCKER_HUB = 'docker.io';
const DOCKER_HUB_ALIASES = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io']);

export interface ImageReference {
  /** Registry host as images name it (`docker.io` for Docker Hub), optionally with port. */
  host: string;
  /** Repository path; Docker Hub official images get `library/`. */
  repository: string;
  tag?: string;
  digest?: string;
  /** The reference as written, without digest. */
  name: string;
}

/** Parses `[host/]repository[:tag][@digest]` with Docker's defaults. */
export function parseImageReference(reference: string): ImageReference | null {
  const match =
    /^((?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9]+(?:[._/-][a-z0-9]+)*)(?::([\w][\w.-]{0,127}))?(?:@(sha256:[0-9a-f]{64}))?$/.exec(
      reference.trim(),
    );

  if (!match) return null;

  const [, path, tag, digest] = match;
  const first = path.split('/')[0];
  const hasHost = path.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost');
  const host = hasHost ? (DOCKER_HUB_ALIASES.has(first) ? DOCKER_HUB : first) : DOCKER_HUB;
  let repository = hasHost ? path.slice(first.length + 1) : path;

  if (host === DOCKER_HUB && !repository.includes('/')) repository = `library/${repository}`;

  return {
    host,
    repository,
    ...(tag ? { tag } : {}),
    ...(digest ? { digest } : {}),
    name: reference.trim().split('@')[0],
  };
}

/** Host of the registry API for an image host. */
export function registryApiHost(host: string): string {
  return host === DOCKER_HUB ? 'registry-1.docker.io' : host;
}
