import * as fs from 'fs';
import * as path from 'path';

import type { ProjectGraph } from '@nx/devkit';

import {
  FileLanguageOrKind,
  FileNodeAttrs,
  emailTemplateStem,
  fileNodeId,
  fileNodeTypeFromPath,
  isEmailTemplateFile,
  isIndexedTsSourceFile,
  isWebhookEventsCatalogFile,
  KnowledgeEdge,
  KnowledgeNode,
} from './schema';

const SENSITIVE_NAME_RE = /(^|[/\\])(\.env($|\.)|.*secret.*|.*credential.*)/i;
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git', 'coverage', 'tmp']);

const STATE_MEMBER_HINT_RE = /\.(actions|reducer|effects|selectors)\.ts$/i;

export interface DiscoveredFile {
  relativePath: string;
  absolutePath: string;
  languageOrKind: FileLanguageOrKind;
  projectName?: string;
  /** When set, this entry represents an accumulated NgRx state slice directory. */
  stateSlice?: {
    sliceName: string;
    memberFiles: string[];
  };
  /** When set, this entry represents an accumulated email template stem. */
  emailTemplate?: {
    templateName: string;
    memberFiles: string[];
  };
  /** Catalog file parsed into individual `webhook-event` nodes (no file node emitted). */
  webhookEventsCatalog?: boolean;
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

function walkDir(dir: string, visitor: (absolutePath: string, entryName: string, isDirectory: boolean) => void): void {
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
      visitor(absolutePath, entry.name, true);
      walkDir(absolutePath, visitor);
    } else if (entry.isFile()) {
      visitor(absolutePath, entry.name, false);
    }
  }
}

function classifyProjectFile(fileName: string, relativePath: string): FileLanguageOrKind | null {
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
  if (isEmailTemplateFile(fileName)) {
    return 'template';
  }
  if (isWebhookEventsCatalogFile(fileName) || isIndexedTsSourceFile(relativePath)) {
    return 'ts';
  }
  return null;
}

/**
 * True when `dirAbs` is an NgRx slice folder (`…/state/<slice>/`) with at least one
 * actions/reducer/effects/selectors member.
 */
export function isNgrxStateSliceDir(dirAbs: string): { sliceName: string; memberFiles: string[] } | null {
  const parentName = path.basename(path.dirname(dirAbs));
  if (parentName.toLowerCase() !== 'state') {
    return null;
  }
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
    return null;
  }

  const memberFiles: string[] = [];
  let hasHint = false;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.ts') || lower.endsWith('.spec.ts') || lower.endsWith('.d.ts')) {
      continue;
    }
    memberFiles.push(entry.name);
    if (STATE_MEMBER_HINT_RE.test(entry.name)) {
      hasHint = true;
    }
  }

  if (!hasHint || memberFiles.length === 0) {
    return null;
  }

  memberFiles.sort((a, b) => a.localeCompare(b));
  return { sliceName: path.basename(dirAbs), memberFiles };
}

/**
 * Relative path of a file if it lives under an NgRx state slice directory.
 */
export function stateSliceRelativePathForFile(workspaceRoot: string, absoluteFilePath: string): string | null {
  let current = path.dirname(absoluteFilePath);
  const rootResolved = path.resolve(workspaceRoot);
  while (current.startsWith(rootResolved) && current !== rootResolved) {
    const slice = isNgrxStateSliceDir(current);
    if (slice) {
      return path.relative(workspaceRoot, current).replace(/\\/g, '/');
    }
    current = path.dirname(current);
  }
  return null;
}

interface EmailAccumulator {
  templateName: string;
  dirAbs: string;
  projectName?: string;
  memberFiles: string[];
}

/**
 * Discover OpenAPI/AsyncAPI specs, architectural TS sources, NgRx state slices,
 * email templates, webhook event catalogs, Mermaid diagrams, and Markdown.
 */
export function discoverFiles(workspaceRoot: string, projectGraph: ProjectGraph): DiscoverFilesResult {
  const files: DiscoveredFile[] = [];
  const seen = new Set<string>();
  const stateDirsSeen = new Set<string>();
  const emailByKey = new Map<string, EmailAccumulator>();

  const addFile = (
    absolutePath: string,
    languageOrKind: FileLanguageOrKind,
    projectName?: string,
    extras?: Pick<DiscoveredFile, 'stateSlice' | 'emailTemplate' | 'webhookEventsCatalog'>,
  ): void => {
    const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
    if (seen.has(relativePath) || isSensitivePath(relativePath)) {
      return;
    }
    seen.add(relativePath);
    files.push({
      relativePath,
      absolutePath,
      languageOrKind,
      projectName,
      stateSlice: extras?.stateSlice,
      emailTemplate: extras?.emailTemplate,
      webhookEventsCatalog: extras?.webhookEventsCatalog,
    });
  };

  for (const [name, node] of Object.entries(projectGraph.nodes)) {
    const rootAbs = path.join(workspaceRoot, node.data.root);
    walkDir(rootAbs, (absolutePath, entryName, isDirectory) => {
      if (isDirectory) {
        const slice = isNgrxStateSliceDir(absolutePath);
        if (!slice) {
          return;
        }
        const rel = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
        if (stateDirsSeen.has(rel)) {
          return;
        }
        stateDirsSeen.add(rel);
        addFile(absolutePath, 'ts', name, { stateSlice: slice });
        return;
      }

      const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');

      if (isEmailTemplateFile(entryName)) {
        const stem = emailTemplateStem(entryName);
        if (!stem) {
          return;
        }
        const dirAbs = path.dirname(absolutePath);
        const key = `${name}|${path.relative(workspaceRoot, dirAbs).replace(/\\/g, '/')}|${stem}`;
        const existing = emailByKey.get(key);
        if (existing) {
          if (!existing.memberFiles.includes(entryName)) {
            existing.memberFiles.push(entryName);
            existing.memberFiles.sort((a, b) => a.localeCompare(b));
          }
        } else {
          emailByKey.set(key, {
            templateName: stem,
            dirAbs,
            projectName: name,
            memberFiles: [entryName],
          });
        }
        return;
      }

      const kind = classifyProjectFile(entryName, relativePath);
      if (!kind) {
        return;
      }

      if (kind === 'ts') {
        if (isWebhookEventsCatalogFile(entryName)) {
          addFile(absolutePath, kind, name, { webhookEventsCatalog: true });
          return;
        }
        const underState = stateSliceRelativePathForFile(workspaceRoot, absolutePath);
        if (underState) {
          return;
        }
      }

      addFile(absolutePath, kind, name);
    });
  }

  for (const email of emailByKey.values()) {
    const virtualAbs = path.join(email.dirAbs, email.templateName);
    addFile(virtualAbs, 'template', email.projectName, {
      emailTemplate: {
        templateName: email.templateName,
        memberFiles: [...email.memberFiles].sort((a, b) => a.localeCompare(b)),
      },
    });
  }

  const docsRoot = path.join(workspaceRoot, 'docs');
  walkDir(docsRoot, (absolutePath, _entryName, isDirectory) => {
    if (isDirectory) {
      return;
    }
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
    if (file.webhookEventsCatalog) {
      continue;
    }

    const id = fileNodeId(file.relativePath);
    let type: ReturnType<typeof fileNodeTypeFromPath>;
    if (file.stateSlice) {
      type = 'state';
    } else if (file.emailTemplate) {
      type = 'email';
    } else {
      type = fileNodeTypeFromPath(file.languageOrKind, file.relativePath);
    }

    const attrs: FileNodeAttrs = {
      path: file.relativePath,
      languageOrKind: file.languageOrKind,
      projectName: file.projectName,
    };
    if (file.stateSlice) {
      attrs.sliceName = file.stateSlice.sliceName;
      attrs.memberFiles = file.stateSlice.memberFiles;
    }
    if (file.emailTemplate) {
      attrs.templateName = file.emailTemplate.templateName;
      attrs.memberFiles = file.emailTemplate.memberFiles;
    }

    nodes.push({ id, type, attrs });

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
