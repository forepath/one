import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { ProjectNodeAttrs } from '../schema';
import { KnowledgeGraphIndex, NodeSummary } from './graph-index';

export interface MentionHit {
  path: string;
  owningProject: NodeSummary | null;
  soft: boolean;
}

export interface MentionsResult {
  recipe: 'mentions';
  project: NodeSummary;
  patterns: string[];
  declaredDependents: NodeSummary[];
  declaredDependencies: NodeSummary[];
  mentionFiles: MentionHit[];
  softReferenceFiles: MentionHit[];
  softReferenceProjects: NodeSummary[];
  note: string;
}

export interface MentionsOptions {
  workspaceRoot: string;
  /** `workspace` searches outside the project root; default. */
  scope?: 'workspace' | 'neighbors';
  maxFiles?: number;
}

/** Bare name/basename tokens shorter than this are omitted (use root path / package name instead). */
export const MIN_BARE_MENTION_TOKEN = 8;

const RG_EXCLUDE_GLOBS = [
  '!node_modules/**',
  '!.git/**',
  '!dist/**',
  '!.nx/**',
  '!coverage/**',
  '!tmp/**',
  '!.angular/**',
  '!**/.cache/**',
  '!**/vite/deps/**',
  '!**/__fixtures__/**',
  '!graph/graph.json',
  '!graph/graph.html',
];

const FALLBACK_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.nx',
  'coverage',
  'tmp',
  '.angular',
  '.cache',
  '__fixtures__',
]);

/**
 * Find textual mentions of a project that may not appear as Nx `depends_on` edges.
 * Graph answers declared coupling; this closes the soft-reference hole from content search.
 */
export function findMentions(
  index: KnowledgeGraphIndex,
  projectName: string,
  options: MentionsOptions
): MentionsResult {
  const project = index.resolveProject(projectName);
  const attrs = project.attrs as ProjectNodeAttrs;
  const projectRoot = (attrs.root || '').replace(/\\/g, '/').replace(/\/$/, '');
  const patterns = buildMentionPatterns(options.workspaceRoot, attrs);
  const maxFiles = options.maxFiles ?? 80;

  const declaredDependents = index
    .edgesIn(project.id, 'depends_on')
    .map((e) => index.getNode(e.from))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map((n) => index.summarize(n));

  const declaredDependencies = index
    .edgesOut(project.id, 'depends_on')
    .map((e) => index.getNode(e.to))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map((n) => index.summarize(n));

  const declaredRelatedIds = new Set<string>([
    project.id,
    ...declaredDependents.map((d) => d.id),
    ...declaredDependencies.map((d) => d.id),
  ]);

  const neighborRoots =
    options.scope === 'neighbors'
      ? [...declaredDependents, ...declaredDependencies].map((d) => d.root).filter((r): r is string => !!r)
      : null;

  const files = searchMentionFiles({
    workspaceRoot: options.workspaceRoot,
    patterns,
    excludeRoot: projectRoot,
    neighborRoots,
    maxFiles: maxFiles * 3,
  });

  const mentionFiles: MentionHit[] = [];
  const softReferenceFiles: MentionHit[] = [];
  const softProjects = new Map<string, NodeSummary>();

  for (const file of files) {
    if (mentionFiles.length >= maxFiles) break;
    if (isNoisyMentionPath(file)) continue;
    const owner = index.projectForPath(file);
    const owningProject = owner ? index.summarize(owner) : null;
    const soft = !owner || !declaredRelatedIds.has(owner.id);
    const hit: MentionHit = { path: file, owningProject, soft };
    mentionFiles.push(hit);
    if (soft) {
      softReferenceFiles.push(hit);
      if (owningProject) softProjects.set(owningProject.id, owningProject);
    }
  }

  return {
    recipe: 'mentions',
    project: index.summarize(project),
    patterns,
    declaredDependents,
    declaredDependencies,
    mentionFiles,
    softReferenceFiles,
    softReferenceProjects: [...softProjects.values()],
    note:
      'depends_on = declared Nx/tool/package coupling. softReference* = textual mentions outside that set — use for copy-paste/import-string consumers, not build blast radius. Short bare names (<8 chars) are omitted from patterns; prefer package name / project root path.',
  };
}

export function buildMentionPatterns(workspaceRoot: string, attrs: ProjectNodeAttrs): string[] {
  const patterns = new Set<string>();

  if (attrs.name && attrs.name.length >= MIN_BARE_MENTION_TOKEN) {
    patterns.add(attrs.name);
  }

  if (attrs.root) {
    const root = attrs.root.replace(/\\/g, '/').replace(/\/$/, '');
    if (root) {
      patterns.add(root);
    }
    const base = path.posix.basename(root);
    if (base && base.length >= MIN_BARE_MENTION_TOKEN) {
      patterns.add(base);
    }
  }

  const pkgPath = path.join(workspaceRoot, attrs.root || '', 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name && pkg.name.length >= 3) {
        patterns.add(pkg.name);
      }
    } catch {
      // ignore invalid package.json
    }
  }

  return [...patterns];
}

export function isNoisyMentionPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return (
    normalized.startsWith('.angular/') ||
    normalized.includes('/.angular/') ||
    normalized.includes('/.cache/') ||
    normalized.startsWith('.cache/') ||
    normalized.includes('/vite/deps/') ||
    normalized.includes('/__fixtures__/') ||
    normalized.startsWith('__fixtures__/') ||
    normalized.startsWith('dist/') ||
    normalized.startsWith('coverage/') ||
    normalized.startsWith('tmp/') ||
    normalized.includes('/node_modules/') ||
    normalized.startsWith('node_modules/')
  );
}

function searchMentionFiles(input: {
  workspaceRoot: string;
  patterns: string[];
  excludeRoot: string;
  neighborRoots: string[] | null;
  maxFiles: number;
}): string[] {
  if (input.patterns.length === 0) return [];

  const rgArgs = ['-l', '--hidden', ...RG_EXCLUDE_GLOBS.flatMap((g) => ['--glob', g]), '-e', input.patterns.map(escapeRegex).join('|')];
  rgArgs.push(...(input.neighborRoots && input.neighborRoots.length > 0 ? input.neighborRoots : ['.']));

  const rg = spawnSync('rg', rgArgs, {
    cwd: input.workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  let files: string[] = [];
  if (rg.status === 0 || rg.status === 1) {
    files = (rg.stdout || '')
      .split('\n')
      .map((l) => l.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
      .filter(Boolean);
  } else {
    files = fallbackWalkSearch(input);
  }

  const exclude = input.excludeRoot.replace(/\/$/, '');
  return files
    .filter((f) => {
      if (isNoisyMentionPath(f)) return false;
      if (!exclude) return true;
      return f !== exclude && !f.startsWith(`${exclude}/`);
    })
    .slice(0, input.maxFiles);
}

function fallbackWalkSearch(input: {
  workspaceRoot: string;
  patterns: string[];
  excludeRoot: string;
  neighborRoots: string[] | null;
  maxFiles: number;
}): string[] {
  const roots =
    input.neighborRoots && input.neighborRoots.length > 0
      ? input.neighborRoots.map((r) => path.join(input.workspaceRoot, r))
      : [input.workspaceRoot];
  const lowered = input.patterns.map((p) => p.toLowerCase());
  const hits: string[] = [];

  const walk = (dir: string): void => {
    if (hits.length >= input.maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= input.maxFiles) return;
      if (FALLBACK_SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|json|md|yaml|yml|html|mdc)$/i.test(entry.name)) continue;
      const rel = path.relative(input.workspaceRoot, full).replace(/\\/g, '/');
      if (isNoisyMentionPath(rel)) continue;
      if (input.excludeRoot && (rel === input.excludeRoot || rel.startsWith(`${input.excludeRoot}/`))) {
        continue;
      }
      try {
        const text = fs.readFileSync(full, 'utf8').toLowerCase();
        if (lowered.some((p) => text.includes(p))) {
          hits.push(rel);
        }
      } catch {
        // ignore
      }
    }
  };

  for (const root of roots) {
    if (fs.existsSync(root)) walk(root);
  }
  return hits;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
