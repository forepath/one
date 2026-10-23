// @ts-check
const { existsSync, readFileSync } = require('node:fs');
const { isBuiltin } = require('node:module');
const { join } = require('node:path');

const { serializeJson, workspaceRoot } = require('@nx/devkit');

const PLUGIN_NAME = 'ExternalRuntimeDependenciesPlugin';
const LOCK_FILE = 'package-lock.json';

/** `@scope/name/sub/path` → `@scope/name`, `name/sub` → `name`. */
function packageNameOf(request) {
  const parts = request.split('/');

  return request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Node's lookup inside a lockfile (v2 / v3 `packages`): `<from>/node_modules/<name>`, then each ancestor's
 * `node_modules`, up to the root.
 */
function resolveInLock(packages, fromPath, name) {
  let base = fromPath;

  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;

    if (packages[candidate]) return candidate;

    if (!base) return undefined;

    const parent = base.lastIndexOf('/node_modules/');

    base = parent === -1 ? '' : base.slice(0, parent);
  }
}

/**
 * Prunes the workspace's npm lockfile (v2 / v3) to what `packageJson` needs, keeping every remaining entry
 * **at its original path and version**: the closure of `packageJson`'s dependencies is walked with Node's
 * lookup through the root lockfile's tree, so each kept package resolves its dependencies exactly as in the
 * workspace (only unreachable entries are dropped; nothing is re-hoisted). Optional dependencies are kept
 * when the workspace has them (whatever their spec, e.g. keycloak-connect's `chromedriver: latest`) and
 * marked `optional` when only reachable through optional edges; optional peers are not followed.
 *
 * Replaces Nx's lockfile pruning for these builds, which re-hoists nested packages (a nested
 * `content-type@2` shadowed a sibling's `~1.0.5`) and drops dist-tag specs → `npm ci` EUSAGE.
 *
 * @returns {{ lockFile?: object, errors: string[] }}
 */
function pruneNpmLockfile(rootLock, packageJson) {
  const errors = [];
  const source = rootLock.packages;

  if (!source || rootLock.lockfileVersion < 2)
    return {
      errors: [
        'the workspace lockfile has no `packages` (lockfileVersion < 2)',
      ],
    };

  /** path → true when required (reachable through non-optional edges), false when optional only. */
  const kept = new Map();
  const queue = [];
  const visit = (path, required) => {
    if (kept.get(path) === true || (kept.has(path) && !required)) return;

    kept.set(path, required);
    queue.push(path);
  };

  const rootEdges = [
    ...Object.entries(packageJson.dependencies ?? {}).map(([n, v]) => [
      n,
      v,
      true,
    ]),
    ...Object.entries(packageJson.peerDependencies ?? {}).map(([n, v]) => [
      n,
      v,
      true,
    ]),
    ...Object.entries(packageJson.optionalDependencies ?? {}).map(([n, v]) => [
      n,
      v,
      false,
    ]),
  ];

  for (const [name, spec, required] of rootEdges) {
    const path = `node_modules/${name}`;
    const entry = source[path];

    if (!entry) {
      if (required)
        errors.push(`${name}@${spec} is not in the workspace lockfile`);
      continue;
    }

    if (entry.link) {
      errors.push(`${name} is a workspace link, not an npm package`);
      continue;
    }

    if (/^\d+\.\d+\.\d+/.test(spec) && entry.version !== spec) {
      errors.push(
        `${name}@${spec}: the workspace lockfile has ${entry.version} (pin the workspace's version)`,
      );
      continue;
    }

    visit(path, required);
  }

  while (queue.length > 0) {
    const path = /** @type {string} */ (queue.shift());
    const entry = source[path];
    const required = kept.get(path) === true;
    const optionalPeers = entry.peerDependenciesMeta ?? {};
    const edges = [
      ...Object.keys(entry.dependencies ?? {}).map((n) => [n, required, true]),
      ...Object.keys(entry.optionalDependencies ?? {}).map((n) => [
        n,
        false,
        false,
      ]),
      ...Object.keys(entry.peerDependencies ?? {})
        .filter((n) => !optionalPeers[n]?.optional)
        .map((n) => [n, required, true]),
    ];

    for (const [name, edgeRequired, mustExist] of edges) {
      const target = resolveInLock(source, path, name);

      if (target) visit(target, /** @type {boolean} */ (edgeRequired));
      else if (mustExist)
        errors.push(
          `${path.replace(/^.*node_modules\//, '')} needs ${name}, which is not in the workspace lockfile`,
        );
    }
  }

  const packages = {
    '': Object.fromEntries(
      Object.entries({
        name: packageJson.name,
        version: packageJson.version,
        license: packageJson.license,
        dependencies: packageJson.dependencies,
        optionalDependencies: packageJson.optionalDependencies,
        peerDependencies: packageJson.peerDependencies,
      }).filter(([, value]) => value !== undefined),
    ),
  };

  for (const path of [...kept.keys()].sort((a, b) =>
    a.localeCompare(b, 'en'),
  )) {
    const { dev, devOptional, optional, peer, ...entry } = source[path];

    packages[path] = kept.get(path) ? entry : { ...entry, optional: true };
  }

  return {
    errors,
    lockFile: {
      name: packageJson.name,
      version: packageJson.version,
      lockfileVersion: rootLock.lockfileVersion,
      requires: true,
      packages,
    },
  };
}

/**
 * Completes the `package.json` and replaces the lockfile that `generatePackageJson` emits, so `npm ci` in the
 * image installs every package the bundle actually `require`s at runtime (webpack's external modules).
 *
 * Nx derives the generated `package.json` from the project graph's file-level imports. Imports through the
 * domain barrels (`@forepath/shared/backend`, `@forepath/identity/backend` → `libs/domains/<domain>/backend/index.ts`,
 * a file no Nx project owns) produce no graph edge, so the npm packages of the libs behind a barrel
 * (nodemailer, bullmq, @bull-board/*, …) were missing and the container crashed with "Cannot find module".
 * The bundle's externals are the ground truth: each one missing from the generated `package.json` is added at
 * the workspace's installed (= root lockfile) version; the lockfile is then pruned by `pruneNpmLockfile`.
 * Externals that aren't installed and lockfile inconsistencies fail the build instead of the container.
 */
class ExternalRuntimeDependenciesPlugin {
  /** @param {import('webpack').Compiler} compiler */
  apply(compiler) {
    const { Compilation, ExternalModule, WebpackError, sources } =
      compiler.webpack;
    const fail = (compilation, message) =>
      compilation.errors.push(new WebpackError(`${PLUGIN_NAME}: ${message}`));

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          // Right after Nx's GeneratePackageJsonPlugin (PROCESS_ASSETS_STAGE_ADDITIONAL).
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL + 1,
        },
        () => {
          const asset = compilation.getAsset('package.json');

          // `generatePackageJson: false` (e.g. the fully bundled single-executable builds): nothing to complete.
          if (!asset) return;

          const packageJson = JSON.parse(asset.source.source().toString());
          const declared = {
            ...packageJson.peerDependencies,
            ...packageJson.optionalDependencies,
            ...packageJson.dependencies,
          };
          const added = {};

          for (const module of compilation.modules) {
            if (!(module instanceof ExternalModule)) continue;

            const requests = Array.isArray(module.request)
              ? [module.request[0]]
              : typeof module.request === 'string'
                ? [module.request]
                : Object.values(module.request ?? {}).map((r) =>
                    Array.isArray(r) ? r[0] : r,
                  );

            for (const request of requests) {
              if (
                !request ||
                request.startsWith('.') ||
                request.startsWith('/') ||
                isBuiltin(request)
              )
                continue;

              const name = packageNameOf(request);

              if (declared[name] || added[name]) continue;

              const manifest = join(
                workspaceRoot,
                'node_modules',
                name,
                'package.json',
              );

              if (!existsSync(manifest)) {
                fail(
                  compilation,
                  `the bundle requires "${request}" at runtime, but "${name}" is not installed in the workspace.`,
                );
                continue;
              }

              added[name] = JSON.parse(readFileSync(manifest, 'utf8')).version;
            }
          }

          if (Object.keys(added).length > 0) {
            packageJson.dependencies = Object.fromEntries(
              Object.entries({ ...packageJson.dependencies, ...added }).sort(
                ([a], [b]) => a.localeCompare(b),
              ),
            );
            compilation.updateAsset(
              'package.json',
              new sources.RawSource(serializeJson(packageJson)),
            );
          }

          const rootLockPath = join(workspaceRoot, LOCK_FILE);

          if (!existsSync(rootLockPath)) return; // not an npm workspace: leave Nx's lockfile as is

          const { lockFile, errors } = pruneNpmLockfile(
            JSON.parse(readFileSync(rootLockPath, 'utf8')),
            packageJson,
          );

          for (const error of errors)
            fail(compilation, `${LOCK_FILE}: ${error}`);

          if (lockFile) {
            const content = new sources.RawSource(serializeJson(lockFile));

            if (compilation.getAsset(LOCK_FILE))
              compilation.updateAsset(LOCK_FILE, content);
            else compilation.emitAsset(LOCK_FILE, content);
          }
        },
      );
    });
  }
}

module.exports = {
  ExternalRuntimeDependenciesPlugin,
  packageNameOf,
  pruneNpmLockfile,
  resolveInLock,
};
