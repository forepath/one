import * as fs from 'fs';
import * as path from 'path';

import {
  buildIntegrityArtifactsForDirectory,
  verifyDirectoryAgainstManifest,
  writeIntegrityFiles,
} from './lib/sha256-manifest';

type CliCommand = 'generate' | 'verify';

function parseArgs(argv: string[]): { command: CliCommand; input: string } {
  let input = '';
  let command: CliCommand = 'generate';

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === 'verify') {
      command = 'verify';

      continue;
    }

    if (arg === 'generate' || arg === 'hash') {
      command = 'generate';

      continue;
    }

    if (arg === '--input' && argv[i + 1]) {
      input = argv[i + 1];
      i++;
    }
  }

  if (!input) {
    input = process.env.RELEASE_INTEGRITY_INPUT ?? process.env.DESKTOP_RELEASE_INTEGRITY_INPUT ?? 'out/make';
  }

  return { command, input };
}

async function runGenerate(rootAbs: string): Promise<void> {
  const artifacts = await buildIntegrityArtifactsForDirectory(rootAbs);

  if (artifacts.length === 0) {
    throw new Error(`No artifacts found under ${rootAbs}; run electron-forge make first.`);
  }

  const { sumsPath, jsonPath } = await writeIntegrityFiles(rootAbs, artifacts);

  console.log(`Wrote ${artifacts.length} entries to ${sumsPath} and ${jsonPath}`);
}

async function runVerify(rootAbs: string): Promise<void> {
  const result = await verifyDirectoryAgainstManifest(rootAbs);

  if (!result.ok) {
    for (const line of result.errors) {
      console.error(line);
    }

    throw new Error(
      `Verification failed (${result.verifiedCount} ok, ${result.errors.length} error(s); manifest: ${result.used})`,
    );
  }

  console.log(`OK: verified ${result.verifiedCount} file(s) using ${result.used} manifest`);
}

async function main(): Promise<void> {
  const { command, input } = parseArgs(process.argv);
  const rootAbs = path.resolve(process.cwd(), input);

  if (!fs.existsSync(rootAbs)) {
    throw new Error(`Input path does not exist: ${rootAbs}`);
  }

  if (command === 'verify') {
    await runVerify(rootAbs);
  } else {
    await runGenerate(rootAbs);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);

  console.error(message);
  process.exitCode = 1;
});
