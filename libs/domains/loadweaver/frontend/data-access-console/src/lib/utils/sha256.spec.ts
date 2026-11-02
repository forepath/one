import { createHash } from 'node:crypto';

import { Sha256, sha256OfBlob } from './sha256';

const reference = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('incremental SHA-256 (bundle digests through the fleet, 2026-10-27)', () => {
  it('matches the reference for edge lengths and any chunking', () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70_001]) {
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) & 0xff);

      expect(new Sha256().update(bytes).hex()).toBe(reference(bytes));

      const chunked = new Sha256();

      for (let offset = 0; offset < size; offset += 37) chunked.update(bytes.subarray(offset, offset + 37));
      expect(chunked.hex()).toBe(reference(bytes));
    }

    expect(new Sha256().update(new TextEncoder().encode('abc')).hex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes a Blob chunk by chunk', async () => {
    const bytes = Uint8Array.from({ length: 10_000 }, (_, i) => i & 0xff);

    await expect(sha256OfBlob(new Blob([bytes]), 1024)).resolves.toBe(reference(bytes));
  });
});
