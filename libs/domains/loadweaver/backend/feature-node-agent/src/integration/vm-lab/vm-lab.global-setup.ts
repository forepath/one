import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { ensureGolden } from './golden';

const WORKSPACE = resolve(__dirname, '../../../../../../../..');

/** Bundled volume driver (real node-agent classes, see volume-driver.entry.ts) copied into the VMs. */
export const VOLUME_DRIVER_BUNDLE = join(tmpdir(), 'lw-vmlab', 'volume-driver.js');
/** Bundled live-migration agent (real node-agent classes, see migration-agent.entry.ts) copied into the VMs. */
export const MIGRATION_AGENT_BUNDLE = join(tmpdir(), 'lw-vmlab', 'migration-agent.js');
/** Bundled update agent (real `UpdatesService`, see updates-agent.entry.ts) copied into the VMs. */
export const UPDATES_AGENT_BUNDLE = join(tmpdir(), 'lw-vmlab', 'updates-agent.js');
/** Bundled backup agent (real `BackupService` / `KopiaServerManager`, see backup-agent.entry.ts) copied into the VMs. */
export const BACKUP_AGENT_BUNDLE = join(tmpdir(), 'lw-vmlab', 'backup-agent.js');
/** The real node agent with the drill's reduced reconciler (dr-agent.entry.ts) for the disaster-recovery drill. */
export const DR_AGENT_BUNDLE = join(tmpdir(), 'lw-vmlab', 'dr-agent.js');
/** Bundled import driver (real discovery / import executor / volumes / workloads / ingress, see import-agent.entry.ts). */
export const IMPORT_AGENT_BUNDLE = join(tmpdir(), 'lw-vmlab', 'import-agent.js');
/** Bundled stand-in for the control plane's apt source and artifact routes (apt-source.entry.ts). */
export const APT_SOURCE_BUNDLE = join(tmpdir(), 'lw-vmlab', 'apt-source.js');

/**
 * Builds or reuses the golden VM image (first build: several minutes, see README) and bundles the node-agent code
 * the VM specs run inside the guests. Fails loudly without Docker / KVM: VM lab specs are never skipped.
 */
export default async function globalSetup(): Promise<void> {
  const log = (line: string) => process.stderr.write(`[vm-lab] ${line}\n`);

  await ensureGolden(log);
  for (const [entry, outfile] of [
    ['volume-driver.entry.ts', VOLUME_DRIVER_BUNDLE],
    ['migration-agent.entry.ts', MIGRATION_AGENT_BUNDLE],
    ['updates-agent.entry.ts', UPDATES_AGENT_BUNDLE],
    ['apt-source.entry.ts', APT_SOURCE_BUNDLE],
    ['backup-agent.entry.ts', BACKUP_AGENT_BUNDLE],
    ['import-agent.entry.ts', IMPORT_AGENT_BUNDLE],
  ])
    execFileSync(
      join(WORKSPACE, 'node_modules/.bin/esbuild'),
      [
        join(__dirname, entry),
        '--bundle',
        '--platform=node',
        '--target=node24',
        `--tsconfig=${join(WORKSPACE, 'tsconfig.base.json')}`,
        `--outfile=${outfile}`,
        // dockerode → ssh2's optional native helper (unused: Docker is reached over its unix socket).
        '--external:cpu-features',
        '--external:*.node',
        // NestJS' optional transports the agent never loads (as in the agent's webpack build).
        '--external:@nestjs/microservices',
        '--external:@nestjs/websockets',
        '--external:@nestjs/platform-express',
        '--external:class-transformer',
        '--external:class-validator',
        '--log-level=error',
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );

  bundleWithDecoratorMetadata(join(__dirname, 'dr-agent.entry.ts'), DR_AGENT_BUNDLE);
}

/**
 * The drill runs the agent's Nest module, whose dependency injection needs decorator metadata, which esbuild doesn't
 * emit: tsc compiles the entry and everything it imports first (CommonJS, metadata), esbuild then bundles that output
 * with the workspace's path aliases pointed at it.
 */
function bundleWithDecoratorMetadata(entry: string, outfile: string): void {
  const work = join(tmpdir(), 'lw-vmlab', 'tsc');
  const out = join(work, 'out');
  const base = JSON.parse(readFileSync(join(WORKSPACE, 'tsconfig.base.json'), 'utf8')) as {
    compilerOptions: { paths: Record<string, string[]> };
  };

  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(
    join(work, 'tsconfig.json'),
    JSON.stringify({
      extends: join(WORKSPACE, 'tsconfig.base.json'),
      compilerOptions: {
        outDir: out,
        rootDir: WORKSPACE,
        noEmit: false,
        module: 'commonjs',
        moduleResolution: 'node',
        target: 'es2022',
        declaration: false,
        sourceMap: false,
        skipLibCheck: true,
        types: ['node'],
        typeRoots: [join(WORKSPACE, 'node_modules/@types')],
        // As the libraries' own configs; types are checked by their projects, this only emits.
        esModuleInterop: true,
        noCheck: true,
      },
      files: [entry],
    }),
  );
  execFileSync(join(WORKSPACE, 'node_modules/.bin/tsc'), ['-p', join(work, 'tsconfig.json')], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  writeFileSync(
    join(work, 'paths.json'),
    JSON.stringify({
      compilerOptions: {
        baseUrl: out,
        paths: Object.fromEntries(
          Object.entries(base.compilerOptions.paths).map(([alias, targets]) => [
            alias,
            targets.map((t) => t.replace(/\.ts$/, '.js')),
          ]),
        ),
      },
    }),
  );
  execFileSync(
    join(WORKSPACE, 'node_modules/.bin/esbuild'),
    [
      join(out, relative(WORKSPACE, entry)).replace(/\.ts$/, '.js'),
      '--bundle',
      '--platform=node',
      '--target=node24',
      `--tsconfig=${join(work, 'paths.json')}`,
      `--outfile=${outfile}`,
      '--external:cpu-features',
      '--external:*.node',
      '--external:@nestjs/microservices',
      '--external:@nestjs/websockets',
      '--external:@nestjs/platform-express',
      '--external:class-transformer',
      '--external:class-validator',
      '--log-level=error',
    ],
    // The compiled files live outside the workspace: packages resolve from its node_modules.
    { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, NODE_PATH: join(WORKSPACE, 'node_modules') } },
  );
}
