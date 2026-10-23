import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

import type { AgentStateStore } from '../state/agent-state.store';

export type FetchImpl = (url: string) => Promise<Response>;

export const defaultFetch: FetchImpl = (url) => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });

/**
 * A file from the control plane's release bundle (WAF module, GeoIP database), verified by the SHA-256 the desired
 * state carries over the authenticated stream: kept if the local copy matches, otherwise fetched and checked before
 * it replaces anything. Returns whether a verified copy is in place.
 */
export async function ensureVerifiedFile(
  path: string,
  sha256: string,
  route: string,
  state: AgentStateStore,
  fetchImpl: FetchImpl,
  maxBytes: number,
): Promise<boolean> {
  const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  const local = await readFile(path).catch(() => null);

  if (local && digest(local) === sha256) return true;

  try {
    const identity = await state.identity();

    if (!identity) return false;

    const res = await fetchImpl(new URL(route, identity.controlPlaneUrl).toString());
    const length = Number(res.headers.get('content-length') ?? 0);

    if (!res.ok || length > maxBytes) return false;

    // Counted while streaming: a response without (or lying about) its length can't fill the agent's memory.
    const chunks: Buffer[] = [];
    let size = 0;

    if (!res.body) return false;

    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;

      if (size > maxBytes) return false;

      chunks.push(Buffer.from(chunk));
    }

    const data = Buffer.concat(chunks);

    if (digest(data) !== sha256) return false;

    await writeFile(`${path}.new`, data, { mode: 0o644 });
    await rename(`${path}.new`, path);

    return true;
  } catch {
    return false;
  }
}
