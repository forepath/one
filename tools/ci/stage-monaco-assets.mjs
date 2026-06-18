import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = join(workspaceRoot, 'node_modules/monaco-editor');
const stagingRoot = join(workspaceRoot, '.cache/monaco-editor');
const sentinelSource = join(
  sourceRoot,
  'esm/vs/base/browser/ui/actionbar/actionViewItems.js',
);
const sentinelStaging = join(
  stagingRoot,
  'esm/vs/base/browser/ui/actionbar/actionViewItems.js',
);

if (!existsSync(sentinelSource)) {
  console.error(
    `Monaco editor is not installed or incomplete: ${sentinelSource}`,
  );
  process.exit(1);
}

if (existsSync(stagingRoot)) {
  rmSync(stagingRoot, { recursive: true, force: true });
}

mkdirSync(dirname(stagingRoot), { recursive: true });
cpSync(sourceRoot, stagingRoot, { recursive: true });

if (!existsSync(sentinelStaging)) {
  console.error(`Monaco editor staging failed: ${sentinelStaging}`);
  process.exit(1);
}

console.log(`Staged monaco-editor to ${stagingRoot}`);
