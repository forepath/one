import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { localSecret } from './local-secret';

describe('localSecret', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-secret-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('generates once, keeps the value and the file private', async () => {
    const [a, b] = await Promise.all([localSecret(dir, 'queue'), localSecret(dir, 'queue')]);

    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toBe(a);
    expect(await localSecret(dir, 'queue')).toBe(a);
    expect(await localSecret(dir, 'other')).not.toBe(a);
    expect((await stat(join(dir, 'queue.secret'))).mode & 0o777).toBe(0o600);
  });
});
