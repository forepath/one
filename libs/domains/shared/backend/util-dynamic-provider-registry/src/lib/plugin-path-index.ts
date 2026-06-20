import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { assertAllowlistedSpecifier } from './assert-runtime-dependency';
import { assertPathUnderPluginRoot } from './assert-plugin-path';
import type { ProviderLoadTarget } from './types';
import { DEFAULT_SPECIFIER_ALLOWLIST_PREFIXES } from './types';

interface PackageManifest {
  name?: string;
  main?: string;
}

let cachedPluginPath: string | undefined;
let cachedIndex: Map<string, ProviderLoadTarget> | undefined;

export function resetPluginPathIndexCache(): void {
  cachedPluginPath = undefined;
  cachedIndex = undefined;
}

export function buildPluginPathIndex(
  pluginPath: string,
  allowlistPrefixes: readonly string[] = DEFAULT_SPECIFIER_ALLOWLIST_PREFIXES,
): Map<string, ProviderLoadTarget> {
  if (cachedPluginPath === pluginPath && cachedIndex) {
    return cachedIndex;
  }

  const index = new Map<string, ProviderLoadTarget>();

  if (!existsSync(pluginPath)) {
    cachedPluginPath = pluginPath;
    cachedIndex = index;

    return index;
  }

  indexPackagesInDirectory(pluginPath, pluginPath, index, allowlistPrefixes);

  const nodeModulesRoot = join(pluginPath, 'node_modules');

  if (existsSync(nodeModulesRoot)) {
    indexScopedPackagesInNodeModules(nodeModulesRoot, pluginPath, index, allowlistPrefixes);
  }

  cachedPluginPath = pluginPath;
  cachedIndex = index;

  return index;
}

function indexPackagesInDirectory(
  directoryPath: string,
  pluginRoot: string,
  index: Map<string, ProviderLoadTarget>,
  allowlistPrefixes: readonly string[],
): void {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') {
      continue;
    }

    const packageDirectory = join(directoryPath, entry.name);
    const packageJsonPath = join(packageDirectory, 'package.json');

    if (!existsSync(packageJsonPath)) {
      continue;
    }

    addPackageToIndex(packageDirectory, packageJsonPath, pluginRoot, index, allowlistPrefixes);
  }
}

function indexScopedPackagesInNodeModules(
  nodeModulesRoot: string,
  pluginRoot: string,
  index: Map<string, ProviderLoadTarget>,
  allowlistPrefixes: readonly string[],
): void {
  for (const entry of readdirSync(nodeModulesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name.startsWith('@')) {
      const scopeDirectory = join(nodeModulesRoot, entry.name);

      for (const scopedEntry of readdirSync(scopeDirectory, { withFileTypes: true })) {
        if (!scopedEntry.isDirectory()) {
          continue;
        }

        const packageDirectory = join(scopeDirectory, scopedEntry.name);
        const packageJsonPath = join(packageDirectory, 'package.json');

        if (existsSync(packageJsonPath)) {
          addPackageToIndex(packageDirectory, packageJsonPath, pluginRoot, index, allowlistPrefixes);
        }
      }

      continue;
    }

    const packageDirectory = join(nodeModulesRoot, entry.name);
    const packageJsonPath = join(packageDirectory, 'package.json');

    if (existsSync(packageJsonPath)) {
      addPackageToIndex(packageDirectory, packageJsonPath, pluginRoot, index, allowlistPrefixes);
    }
  }
}

function addPackageToIndex(
  packageDirectory: string,
  packageJsonPath: string,
  pluginRoot: string,
  index: Map<string, ProviderLoadTarget>,
  allowlistPrefixes: readonly string[],
): void {
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest;

  if (!manifest.name) {
    return;
  }

  try {
    assertAllowlistedSpecifier(manifest.name, allowlistPrefixes);
  } catch {
    return;
  }

  const mainPath = resolvePackageMain(packageDirectory, manifest.main);
  const target: ProviderLoadTarget = {
    source: 'plugin-path',
    specifier: manifest.name,
    entryPath: packageDirectory,
    packageJsonPath,
    mainPath,
  };

  index.set(manifest.name, target);
}

function resolvePackageMain(packageDirectory: string, mainField: string | undefined): string {
  if (mainField) {
    return join(packageDirectory, mainField);
  }

  const indexJs = join(packageDirectory, 'index.js');

  if (existsSync(indexJs)) {
    return indexJs;
  }

  return join(packageDirectory, 'index.js');
}

export function lookupPluginPathTarget(
  packageName: string,
  pluginPath: string,
  allowlistPrefixes: readonly string[] = DEFAULT_SPECIFIER_ALLOWLIST_PREFIXES,
): ProviderLoadTarget | undefined {
  const index = buildPluginPathIndex(pluginPath, allowlistPrefixes);

  return index.get(packageName);
}

export function buildPluginPathTargetFromRelativePath(
  pluginRelativePath: string,
  pluginRoot: string,
  allowlistPrefixes: readonly string[] = DEFAULT_SPECIFIER_ALLOWLIST_PREFIXES,
): ProviderLoadTarget {
  const entryPath = assertPathUnderPluginRoot(pluginRelativePath, pluginRoot);
  const packageJsonPath = join(entryPath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    throw new Error(`Plugin directory '${entryPath}' is missing package.json`);
  }

  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest;

  if (!manifest.name) {
    throw new Error(`Plugin package.json at '${packageJsonPath}' is missing 'name'`);
  }

  assertAllowlistedSpecifier(manifest.name, allowlistPrefixes);

  return {
    source: 'plugin-path',
    specifier: manifest.name,
    entryPath,
    packageJsonPath,
    mainPath: resolvePackageMain(entryPath, manifest.main),
  };
}
