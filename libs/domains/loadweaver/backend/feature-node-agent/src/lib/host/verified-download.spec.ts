import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { ensureVerifiedFile } from './verified-download';

describe('verified downloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lw-verified-'));
  const state = { identity: async () => ({ controlPlaneUrl: 'https://cp.example' }) } as never;
  const body = Buffer.from('module');
  const sha = createHash('sha256').update(body).digest('hex');
  const respond =
    (chunks: Buffer[], headers: Record<string, string> = {}) =>
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            chunks.forEach((c) => controller.enqueue(c));
            controller.close();
          },
        }),
        { headers },
      );

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps only a file matching the checksum', async () => {
    expect(await ensureVerifiedFile(join(dir, 'a'), sha, '/x', state, respond([body]), 1024)).toBe(true);
    expect(readFileSync(join(dir, 'a'))).toEqual(body);
    expect(await ensureVerifiedFile(join(dir, 'b'), 'f'.repeat(64), '/x', state, respond([body]), 1024)).toBe(false);
  });

  it('stops streaming past the limit, whatever the headers say', async () => {
    const big = Array.from({ length: 10 }, () => Buffer.alloc(1024));

    expect(await ensureVerifiedFile(join(dir, 'c'), sha, '/x', state, respond(big), 4096)).toBe(false);
  });
});
