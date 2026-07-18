import * as fs from 'fs';
import * as path from 'path';

import { KnowledgeEdge, KnowledgeNode, PackageNodeAttrs, PatchNodeAttrs, packageNodeId, patchNodeId } from './schema';

export interface DiscoverPatchesResult {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface ParsedPatchFileName {
  fileName: string;
  packageName: string;
  packageVersion?: string;
}

/**
 * Parse patch-package filenames:
 * - `lodash+4.17.21.patch`
 * - `@nestjs+common+11.1.6.patch` (scoped: first two `+` segments)
 */
export function parsePatchFileName(fileName: string): ParsedPatchFileName | null {
  if (!fileName.toLowerCase().endsWith('.patch')) {
    return null;
  }
  const stem = fileName.slice(0, -'.patch'.length);
  if (!stem.includes('+')) {
    return null;
  }

  if (stem.startsWith('@')) {
    const parts = stem.split('+');
    if (parts.length < 2) {
      return null;
    }
    const packageName = `${parts[0]}/${parts[1]}`;
    const packageVersion = parts.length >= 3 ? parts.slice(2).join('+') : undefined;
    return { fileName, packageName, packageVersion };
  }

  const plus = stem.indexOf('+');
  const packageName = stem.slice(0, plus);
  const packageVersion = stem.slice(plus + 1) || undefined;
  if (!packageName) {
    return null;
  }
  return { fileName, packageName, packageVersion };
}

/**
 * Discover patch-package files under `patches/` and link them to existing `package` nodes.
 * Patches for packages not attributed to any app are skipped (no orphan package inflation).
 */
export function discoverPatches(workspaceRoot: string, packageNodes: KnowledgeNode[]): DiscoverPatchesResult {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const packageIds = new Set(packageNodes.filter((n) => n.type === 'package').map((n) => n.id));

  const patchesDir = path.join(workspaceRoot, 'patches');
  if (!fs.existsSync(patchesDir)) {
    return { nodes, edges };
  }

  for (const entry of fs.readdirSync(patchesDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const parsed = parsePatchFileName(entry.name);
    if (!parsed) {
      continue;
    }

    const pkgId = packageNodeId(parsed.packageName);
    if (!packageIds.has(pkgId)) {
      continue;
    }

    const relativePath = path.join('patches', entry.name).replace(/\\/g, '/');
    const attrs: PatchNodeAttrs = {
      path: relativePath,
      fileName: parsed.fileName,
      packageName: parsed.packageName,
    };
    if (parsed.packageVersion) {
      attrs.packageVersion = parsed.packageVersion;
    }

    const id = patchNodeId(parsed.fileName);
    nodes.push({ id, type: 'patch', attrs });
    edges.push({ from: pkgId, to: id, type: 'contains' });

    // Prefer recording patch version on the package node when missing.
    const pkgNode = packageNodes.find((n) => n.id === pkgId);
    if (pkgNode && parsed.packageVersion) {
      const pkgAttrs = pkgNode.attrs as PackageNodeAttrs;
      if (!pkgAttrs.version) {
        pkgAttrs.version = parsed.packageVersion;
      }
    }
  }

  return { nodes, edges };
}
