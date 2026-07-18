import * as fs from 'fs';
import * as path from 'path';

import type { ProjectGraph } from '@nx/devkit';

import { isToolsProjectRoot, KnowledgeEdge, projectNodeId, toolNodeId } from './schema';

export interface ToolIdentity {
  /** Graph node id for the tool (`project:sbom` or `tool:ci`). */
  toolNodeId: string;
  /** Strings that identify this tool when found in a consumer project.json. */
  identifiers: string[];
}

export interface LinkToolUsageResult {
  edges: KnowledgeEdge[];
  /** Tool identities used for matching (tests / debugging). */
  tools: ToolIdentity[];
}

/**
 * Collect identifiers for a tool from its Nx project name and optional package.json `name`.
 */
export function collectToolIdentifiers(options: {
  projectName?: string;
  packageName?: string;
  dirName?: string;
}): string[] {
  const ids = new Set<string>();
  if (options.projectName) {
    ids.add(options.projectName);
  }
  if (options.dirName) {
    ids.add(options.dirName);
  }
  if (options.packageName) {
    ids.add(options.packageName);
    const scoped = /^@[^/]+\/(.+)$/.exec(options.packageName);
    if (scoped?.[1]) {
      ids.add(scoped[1]);
    }
  }
  return [...ids].filter((id) => id.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when project.json text references a tool identifier in a usage context:
 * - package name (scoped or path-like)
 * - executor plugin id (`name:…` / `@scope/name:…`)
 * - Nx `implicitDependencies` entry
 * - path under `tools/<name>`
 */
export function projectJsonReferencesIdentifier(projectJsonText: string, identifier: string): boolean {
  if (!identifier || !projectJsonText.includes(identifier)) {
    return false;
  }

  const escaped = escapeRegExp(identifier);

  // High confidence: npm package id (scoped or contains `/`).
  if (identifier.startsWith('@') || identifier.includes('/')) {
    return true;
  }

  // Executor / plugin package: "executor": "…identifier:…"
  if (new RegExp(`"executor"\\s*:\\s*"[^"]*${escaped}:[^"]*"`, 'i').test(projectJsonText)) {
    return true;
  }

  // Nx implicitDependencies: "identifier"
  if (new RegExp(`"implicitDependencies"\\s*:\\s*\\[[^\\]]*"(?:[^"]*",\\s*)*${escaped}"`, 's').test(projectJsonText)) {
    return true;
  }

  // Path reference to the tool directory.
  if (new RegExp(`tools[/\\\\]${escaped}(?:[/\\\\"']|$)`).test(projectJsonText)) {
    return true;
  }

  return false;
}

function readPackageName(packageJsonPath: string): string | undefined {
  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: unknown };
    return typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build tool identities from Nx tools/* projects and non-Nx tools/* directories.
 */
export function resolveToolIdentities(workspaceRoot: string, projectGraph: ProjectGraph): ToolIdentity[] {
  const tools: ToolIdentity[] = [];
  const nxToolDirNames = new Set<string>();

  for (const [name, node] of Object.entries(projectGraph.nodes)) {
    const root = (node.data.root ?? '').replace(/\\/g, '/');
    if (!isToolsProjectRoot(root)) {
      continue;
    }
    const dirName = path.basename(root);
    nxToolDirNames.add(dirName);
    const packageName = readPackageName(path.join(workspaceRoot, root, 'package.json'));
    tools.push({
      toolNodeId: projectNodeId(name),
      identifiers: collectToolIdentifiers({ projectName: name, packageName, dirName }),
    });
  }

  const toolsRoot = path.join(workspaceRoot, 'tools');
  if (fs.existsSync(toolsRoot)) {
    for (const entry of fs.readdirSync(toolsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || nxToolDirNames.has(entry.name)) {
        continue;
      }
      const packageName = readPackageName(path.join(toolsRoot, entry.name, 'package.json'));
      tools.push({
        toolNodeId: toolNodeId(entry.name),
        identifiers: collectToolIdentifiers({ dirName: entry.name, packageName }),
      });
    }
  }

  return tools;
}

/**
 * Link apps/libs → tools when a consumer's project.json references a tool identifier.
 */
export function linkToolUsage(options: {
  projectGraph: ProjectGraph;
  workspaceRoot: string;
  /** Optional override for tests. */
  tools?: ToolIdentity[];
}): LinkToolUsageResult {
  const tools = options.tools ?? resolveToolIdentities(options.workspaceRoot, options.projectGraph);
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();

  for (const [projectName, node] of Object.entries(options.projectGraph.nodes)) {
    const root = (node.data.root ?? '').replace(/\\/g, '/');
    if (isToolsProjectRoot(root)) {
      continue;
    }

    const projectJsonPath = path.join(options.workspaceRoot, root, 'project.json');
    if (!fs.existsSync(projectJsonPath)) {
      continue;
    }

    let text: string;
    try {
      text = fs.readFileSync(projectJsonPath, 'utf8');
    } catch {
      continue;
    }

    const fromId = projectNodeId(projectName);
    for (const tool of tools) {
      const matched = tool.identifiers.some((identifier) => projectJsonReferencesIdentifier(text, identifier));
      if (!matched) {
        continue;
      }
      const key = `${fromId}->${tool.toolNodeId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push({ from: fromId, to: tool.toolNodeId, type: 'depends_on' });
    }
  }

  return { edges, tools };
}
