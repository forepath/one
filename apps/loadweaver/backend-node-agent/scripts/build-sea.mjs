#!/usr/bin/env node
/**
 * Builds the node agent as a Node.js single executable application (section 5): one binary including the
 * runtime, no Node install on the host. Uses the running Node binary unless --node points at another one
 * (e.g. the official arm64 build for cross-architecture releases).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    bundle: { type: 'string' },
    out: { type: 'string' },
    node: { type: 'string' },
    name: { type: 'string' },
  },
});

if (!values.bundle || !values.out) {
  console.error(
    'usage: build-sea.mjs --bundle <main.js> --out <dir> [--node <node binary>] [--name loadweaver-agent]',
  );
  process.exit(1);
}

const out = resolve(values.out);
const name = values.name ?? 'loadweaver-agent';
const blob = join(out, 'sea-prep.blob');
const config = join(out, 'sea-config.json');
const binary = join(out, name);

mkdirSync(out, { recursive: true });
writeFileSync(
  config,
  JSON.stringify({
    main: resolve(values.bundle),
    output: blob,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  }),
);
execFileSync(process.execPath, ['--experimental-sea-config', config], {
  stdio: 'inherit',
});
copyFileSync(values.node ?? process.execPath, binary);
chmodSync(binary, 0o755);
execFileSync(
  process.execPath,
  [
    resolve('node_modules/postject/dist/cli.js'),
    binary,
    'NODE_SEA_BLOB',
    blob,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit' },
);
console.log(`Built ${binary}`);
