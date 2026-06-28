import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = join(workspaceRoot, 'node_modules/monaco-editor');
const stagingRoot = join(workspaceRoot, '.cache/monaco-editor');
const lockDir = join(workspaceRoot, '.cache/.monaco-staging.lock');
const sentinelSource = join(
  sourceRoot,
  'esm/vs/base/browser/ui/actionbar/actionViewItems.js',
);
const sentinelStaging = join(
  stagingRoot,
  'esm/vs/base/browser/ui/actionbar/actionViewItems.js',
);

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait — short-lived staging lock only.
  }
}

function releaseLock() {
  rmSync(lockDir, { recursive: true, force: true });
}

function exitWithCode(code, message) {
  if (message) {
    if (code === 0) {
      console.log(message);
    } else {
      console.error(message);
    }
  }

  releaseLock();
  process.exit(code);
}

if (!existsSync(sentinelSource)) {
  console.error(
    `Monaco editor is not installed or incomplete: ${sentinelSource}`,
  );
  process.exit(1);
}

if (existsSync(sentinelStaging)) {
  console.log(`Monaco editor already staged at ${stagingRoot}`);
  process.exit(0);
}

mkdirSync(dirname(lockDir), { recursive: true });

let locked = false;
for (let attempt = 0; attempt < 120; attempt++) {
  if (existsSync(sentinelStaging)) {
    console.log(`Monaco editor already staged at ${stagingRoot}`);
    process.exit(0);
  }

  try {
    mkdirSync(lockDir);
    locked = true;
    break;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }

    sleep(500);
  }
}

if (!locked) {
  console.error('Timed out waiting for monaco-editor staging lock');
  process.exit(1);
}

try {
  if (existsSync(sentinelStaging)) {
    exitWithCode(0, `Monaco editor already staged at ${stagingRoot}`);
  }

  const stagingTmp = `${stagingRoot}.tmp-${process.pid}`;
  rmSync(stagingTmp, { recursive: true, force: true });
  mkdirSync(dirname(stagingRoot), { recursive: true });
  cpSync(sourceRoot, stagingTmp, { recursive: true, dereference: true });

  const stagedSentinel = join(
    stagingTmp,
    'esm/vs/base/browser/ui/actionbar/actionViewItems.js',
  );
  if (!existsSync(stagedSentinel)) {
    rmSync(stagingTmp, { recursive: true, force: true });
    exitWithCode(1, `Monaco editor staging failed: ${sentinelStaging}`);
  }

  rmSync(stagingRoot, { recursive: true, force: true });
  renameSync(stagingTmp, stagingRoot);
  exitWithCode(0, `Staged monaco-editor to ${stagingRoot}`);
} catch (error) {
  releaseLock();
  throw error;
}
