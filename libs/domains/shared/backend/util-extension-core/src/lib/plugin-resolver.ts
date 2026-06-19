import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

import { Logger } from '@nestjs/common';

import { loadExtensionManifest } from './manifest-loader';
import { parseExtensionSpecifier } from './parse-extension-specifier';
import { resolveMonorepoPackageRoot } from './tsconfig-paths';

import type { ExtensionSpecifier, ForepathExtension, LoadedExtension } from './types';

export interface PluginResolverOptions {
  workspaceRoot: string;
  expectedKind: string;
}

function isForepathExtension(value: unknown): value is ForepathExtension {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as ForepathExtension;

  return typeof candidate.register === 'function' && typeof candidate.getInstanceToken === 'function';
}

function findExtensionFactory(moduleExports: Record<string, unknown>): ForepathExtension {
  for (const exported of Object.values(moduleExports)) {
    if (typeof exported === 'function') {
      const instance = exported();

      if (isForepathExtension(instance)) {
        return instance;
      }
    }
  }

  for (const [exportName, exported] of Object.entries(moduleExports)) {
    if (/^create\w+Extension$/.test(exportName) && typeof exported === 'function') {
      const instance = exported();

      if (isForepathExtension(instance)) {
        return instance;
      }
    }
  }

  throw new Error('Extension entrypoint must export a create*Extension() factory returning ForepathExtension.');
}

function resolvePackageRoot(specifier: ExtensionSpecifier, workspaceRoot: string): string {
  switch (specifier.type) {
    case 'monorepo':
      return resolveMonorepoPackageRoot(specifier.importPath, workspaceRoot);
    case 'file':
      return specifier.directory;
    case 'npm': {
      const requireFromWorkspace = createRequire(path.join(workspaceRoot, 'package.json'));
      const packageJsonPath = requireFromWorkspace.resolve(`${specifier.packageName}/package.json`);

      return path.dirname(packageJsonPath);
    }
    default:
      throw new Error('Unsupported extension specifier type.');
  }
}

function readPackageJson(packageRoot: string): Record<string, unknown> | undefined {
  const packageJsonPath = path.join(packageRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
}

function resolveDefaultEntrypoint(packageRoot: string, specifier: ExtensionSpecifier): string {
  if (specifier.type === 'monorepo') {
    const tsEntry = path.join(packageRoot, 'src', 'index.ts');
    const jsEntry = path.join(packageRoot, 'src', 'index.js');

    if (fs.existsSync(tsEntry)) {
      return tsEntry;
    }

    if (fs.existsSync(jsEntry)) {
      return jsEntry;
    }

    return tsEntry;
  }

  const packageJson = readPackageJson(packageRoot);

  if (packageJson) {
    if (typeof packageJson.main === 'string' && packageJson.main.trim().length > 0) {
      return path.resolve(packageRoot, packageJson.main);
    }

    if (typeof packageJson.exports === 'string' && packageJson.exports.trim().length > 0) {
      return path.resolve(packageRoot, packageJson.exports);
    }
  }

  return path.join(packageRoot, 'dist', 'index.js');
}

function resolveEntrypoint(packageRoot: string, specifier: ExtensionSpecifier, manifestEntrypoint?: string): string {
  const relativeEntry = manifestEntrypoint ?? './src/index.ts';

  if (path.isAbsolute(relativeEntry)) {
    return relativeEntry;
  }

  if (manifestEntrypoint) {
    return path.resolve(packageRoot, manifestEntrypoint);
  }

  return resolveDefaultEntrypoint(packageRoot, specifier);
}

function loadExtensionModule(entrypoint: string, workspaceRoot: string): Record<string, unknown> {
  const requireFromWorkspace = createRequire(path.join(workspaceRoot, 'package.json'));
  const resolved = requireFromWorkspace.resolve(entrypoint);

  return requireFromWorkspace(resolved) as Record<string, unknown>;
}

export class PluginResolver {
  private readonly logger = new Logger(PluginResolver.name);

  constructor(private readonly options: PluginResolverOptions) {}

  resolveSync(specifier: string): LoadedExtension {
    const parsed = parseExtensionSpecifier(specifier, this.options.workspaceRoot);
    const packageRoot = resolvePackageRoot(parsed, this.options.workspaceRoot);
    const manifest = loadExtensionManifest(packageRoot);

    if (manifest.kind !== this.options.expectedKind) {
      throw new Error(
        `Extension '${manifest.id}' kind '${manifest.kind}' does not match expected kind '${this.options.expectedKind}'.`,
      );
    }

    const entrypoint = resolveEntrypoint(packageRoot, parsed, manifest.entrypoint);
    const moduleExports = loadExtensionModule(entrypoint, this.options.workspaceRoot);
    const extension = findExtensionFactory(moduleExports);

    this.logger.log(`Loaded extension ${manifest.id} v${manifest.version} (${manifest.name})`);

    return {
      manifest,
      extension,
      packageRoot,
    };
  }
}
