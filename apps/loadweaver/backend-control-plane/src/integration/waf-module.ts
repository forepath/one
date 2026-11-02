import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WAF_MODULE_SHA256 } from '@forepath/loadweaver/backend/feature-control-plane';

const WAF_RELEASE =
  'https://github.com/corazawaf/coraza-proxy-wasm/releases/download/0.6.0/coraza-proxy-wasm-0.6.0.zip';

/** The pinned Coraza module (as in the release bundle), downloaded once per machine and checked against the pin. */
export function wafModule(): Buffer {
  const cached = join(tmpdir(), 'lw-coraza-proxy-wasm-0.6.0.wasm');

  if (!existsSync(cached)) {
    const dir = mkdtempSync(join(tmpdir(), 'lw-coraza-'));

    try {
      execFileSync('curl', ['-sSfL', '-o', join(dir, 'c.zip'), WAF_RELEASE]);
      execFileSync('unzip', ['-q', '-o', join(dir, 'c.zip'), 'coraza-proxy-wasm.wasm', '-d', dir]);
      writeFileSync(cached, readFileSync(join(dir, 'coraza-proxy-wasm.wasm')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const data = readFileSync(cached);

  if (createHash('sha256').update(data).digest('hex') !== WAF_MODULE_SHA256) {
    rmSync(cached, { force: true });
    throw new Error('WAF module does not match the pinned checksum');
  }

  return data;
}
