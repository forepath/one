import type { ProviderPackageEntry } from './types';

const PASCAL_CASE_CLASS_NAME = /^[A-Z][A-Za-z0-9]*$/;
const FILE_SPECIFIER_PREFIX = 'file:';

export function isFilePluginEntry(entry: ProviderPackageEntry): boolean {
  return entry.pluginRelativePath !== undefined;
}

/**
 * Parses a comma-separated dynamic provider spec from env.
 * Supports `alias=@pkg`, `ClassName=@pkg`, bare `@pkg`, and `file:relative-dir` entries.
 */
export function parseProviderPackageSpec(raw: string | undefined): ProviderPackageEntry[] {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map(parseProviderPackageEntry);
}

function parseProviderPackageEntry(segment: string): ProviderPackageEntry {
  const equalsIndex = segment.indexOf('=');

  if (equalsIndex === -1) {
    return parseRightHandSide(segment);
  }

  const left = segment.slice(0, equalsIndex).trim();
  const right = segment.slice(equalsIndex + 1).trim();

  if (!right) {
    throw new Error(`Invalid dynamic provider entry '${segment}': missing value after '='`);
  }

  const parsedRight = parseRightHandSide(right);

  if (PASCAL_CASE_CLASS_NAME.test(left)) {
    return { ...parsedRight, classExport: left };
  }

  return { ...parsedRight, alias: left || undefined };
}

function parseRightHandSide(value: string): ProviderPackageEntry {
  if (value.startsWith(FILE_SPECIFIER_PREFIX)) {
    const pluginRelativePath = value.slice(FILE_SPECIFIER_PREFIX.length).trim();

    if (!pluginRelativePath) {
      throw new Error(`Invalid dynamic provider entry '${value}': missing path after 'file:'`);
    }

    if (pluginRelativePath.startsWith('@')) {
      throw new Error(`Invalid dynamic provider entry '${value}': 'file:' entries cannot use package specifiers`);
    }

    return {
      specifier: value,
      pluginRelativePath,
    };
  }

  return { specifier: value };
}

/**
 * Parses comma-separated install targets for DYNAMIC_PROVIDER_PLUGIN_INSTALL.
 */
export function parseProviderPluginInstallSpec(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}
