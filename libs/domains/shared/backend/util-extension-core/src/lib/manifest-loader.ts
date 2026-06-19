import * as fs from 'fs';
import * as path from 'path';

import Ajv from 'ajv';

import type { ForepathExtensionManifest } from './types';

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../schemas/forepath.extension.schema.json'), 'utf-8'),
) as Record<string, unknown>;

const ajv = new Ajv({ allErrors: true, strict: false });
const validateManifestSchema = ajv.compile(schema);

export const DEFAULT_EXTENSION_VERSION = '0.0.0';

export function normalizeForepathExtensionManifest(raw: Record<string, unknown>): ForepathExtensionManifest {
  const version =
    typeof raw.version === 'string' && raw.version.trim().length > 0 ? raw.version : DEFAULT_EXTENSION_VERSION;

  return {
    ...raw,
    id: String(raw.id),
    kind: String(raw.kind),
    name: String(raw.name),
    description: String(raw.description),
    version,
    entrypoint: typeof raw.entrypoint === 'string' ? raw.entrypoint : undefined,
  };
}

export function validateForepathExtensionManifest(manifest: ForepathExtensionManifest): void {
  const valid = validateManifestSchema(manifest);

  if (!valid) {
    const details = (validateManifestSchema.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
      .join('; ');

    throw new Error(`Invalid forepath.extension.json manifest: ${details}`);
  }
}

function readPackageJson(packageRoot: string): Record<string, unknown> | undefined {
  const packageJsonPath = path.join(packageRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
}

export function resolveManifestPath(packageRoot: string): string {
  const packageJson = readPackageJson(packageRoot);

  if (packageJson && typeof packageJson.forepath === 'object' && packageJson.forepath !== null) {
    const forepath = packageJson.forepath as Record<string, unknown>;
    const manifestRelative = forepath.extensionManifest;

    if (typeof manifestRelative === 'string' && manifestRelative.trim().length > 0) {
      return path.resolve(packageRoot, manifestRelative);
    }
  }

  return path.join(packageRoot, 'forepath.extension.json');
}

export function loadExtensionManifestFromFile(manifestPath: string): ForepathExtensionManifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Extension manifest not found at '${manifestPath}'.`);
  }

  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  const manifest = normalizeForepathExtensionManifest(raw);

  validateForepathExtensionManifest(manifest);

  return manifest;
}

export function loadExtensionManifest(packageRoot: string): ForepathExtensionManifest {
  const manifestPath = resolveManifestPath(packageRoot);

  return loadExtensionManifestFromFile(manifestPath);
}
