import * as fs from 'fs';
import * as path from 'path';

import type { ProjectGraph } from '@nx/devkit';

import { FileLanguageOrKind, fileNodeId, fileNodeTypeFromKind, KnowledgeEdge, KnowledgeNode } from './schema';

const SENSITIVE_NAME_RE = /(^|[/\\])(\.env($|\.)|.*secret.*|.*credential.*)/i;
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git', 'coverage', 'tmp']);

export interface DiscoveredFile {
  relativePath: string;
  absolutePath: string;
  languageOrKind: FileLanguageOrKind;
  projectName?: string;
}

export interface DiscoverFilesResult {
  files: DiscoveredFile[];
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SENSITIVE_NAME_RE.test(normalized);
}

function walkDir(dir: string, visitor: (absolutePath: string) => void): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(absolutePath, visitor);
    } else if (entry.isFile()) {
      visitor(absolutePath);
    }
  }
}

function classifyProjectFile(fileName: string): FileLanguageOrKind | null {
  const lower = fileName.toLowerCase();
  if (lower === 'openapi.yaml' || lower === 'openapi.yml') {
    return 'openapi';
  }
  if (lower === 'asyncapi.yaml' || lower === 'asyncapi.yml') {
    return 'asyncapi';
  }
  if (lower.endsWith('.mmd')) {
    return 'mmd';
  }
  if (lower.endsWith('.md')) {
    return 'md';
  }
  if (lower.endsWith('controller.ts') || lower.includes('controller.')) {
    if (lower.endsWith('.ts') && !lower.endsWith('.spec.ts') && !lower.endsWith('.d.ts')) {
      return 'ts';
    }
  }
  return null;
}

/**
 * Discover OpenAPI/AsyncAPI specs, Nest controllers, Mermaid diagrams, and Markdown
 * under project roots; Markdown under docs/; top-level workspace Markdown/diagrams.
 */
export function discoverFiles(workspaceRoot: string, projectGraph: ProjectGraph): DiscoverFilesResult {
  const files: DiscoveredFile[] = [];
  const seen = new Set<string>();

  const addFile = (absolutePath: string, languageOrKind: FileLanguageOrKind, projectName?: string): void => {
    const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
    if (seen.has(relativePath) || isSensitivePath(relativePath)) {
      return;
    }
    seen.add(relativePath);
    files.push({ relativePath, absolutePath, languageOrKind, projectName });
  };

  for (const [name, node] of Object.entries(projectGraph.nodes)) {
    const rootAbs = path.join(workspaceRoot, node.data.root);
    walkDir(rootAbs, (absolutePath) => {
      const kind = classifyProjectFile(path.basename(absolutePath));
      if (!kind) {
        return;
      }
      // Controllers: only *controller*.ts (already filtered in classify)
      if (kind === 'ts') {
        const base = path.basename(absolutePath).toLowerCase();
        if (!base.includes('controller')) {
          return;
        }
      }
      addFile(absolutePath, kind, name);
    });
  }

  const docsRoot = path.join(workspaceRoot, 'docs');
  walkDir(docsRoot, (absolutePath) => {
    const lower = absolutePath.toLowerCase();
    if (lower.endsWith('.md')) {
      addFile(absolutePath, 'md');
    } else if (lower.endsWith('.mmd')) {
      addFile(absolutePath, 'mmd');
    }
  });

  if (fs.existsSync(workspaceRoot)) {
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.md')) {
        addFile(path.join(workspaceRoot, entry.name), 'md');
      } else if (lower.endsWith('.mmd')) {
        addFile(path.join(workspaceRoot, entry.name), 'mmd');
      }
    }
  }

  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];

  for (const file of files) {
    const id = fileNodeId(file.relativePath);
    nodes.push({
      id,
      type: fileNodeTypeFromKind(file.languageOrKind, file.relativePath),
      attrs: {
        path: file.relativePath,
        languageOrKind: file.languageOrKind,
        projectName: file.projectName,
      },
    });

    if (file.projectName) {
      edges.push({
        from: `project:${file.projectName}`,
        to: id,
        type: 'contains',
      });
    }
  }

  return { files, nodes, edges };
}
