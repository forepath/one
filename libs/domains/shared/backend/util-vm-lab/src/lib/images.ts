import { createHash } from 'node:crypto';

import { docker, dockerOk } from './process';

/** First 12 hex characters of the sha256 of the parts (joined with NUL): tags and volume names by content. */
export function contentHash(...parts: (string | Buffer)[]): string {
  const hash = createHash('sha256');

  parts.forEach((part, i) => {
    if (i > 0) hash.update('\u0000');

    hash.update(part);
  });

  return hash.digest('hex').slice(0, 12);
}

export interface DockerImageSpec {
  tag: string;
  dockerfile: string | Buffer;
  /** Labels added with `--label` (cleanup by label). */
  labels?: Record<string, string>;
  timeoutMs?: number;
  /** Quiet build (`-q`, default true). */
  quiet?: boolean;
}

/** Builds an image from a Dockerfile on stdin once (reused while the tag exists). */
export async function ensureDockerImage(spec: DockerImageSpec): Promise<string> {
  if (await dockerOk(['image', 'inspect', spec.tag])) return spec.tag;

  await docker(
    [
      'build',
      ...(spec.quiet === false ? [] : ['-q']),
      ...Object.entries(spec.labels ?? {}).flatMap(([k, v]) => ['--label', `${k}=${v}`]),
      '-t',
      spec.tag,
      '-',
    ],
    { input: spec.dockerfile, timeoutMs: spec.timeoutMs ?? 15 * 60_000 },
  );

  return spec.tag;
}

/** Throws a readable error when a prerequisite image (built by the gate, never by a spec) is missing. */
export async function requireLocalImage(image: string, howToBuild: string): Promise<void> {
  if (!(await dockerOk(['image', 'inspect', image])))
    throw new Error(`the lab needs the image ${image} on the lab host: ${howToBuild}`);
}
