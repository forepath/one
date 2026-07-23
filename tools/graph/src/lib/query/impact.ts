import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { ProjectNodeAttrs } from '../schema';
import { KnowledgeGraphIndex, NodeSummary } from './graph-index';
import { RecipeR1Result, recipeR1 } from './recipes';

export interface ImpactPathMapping {
  path: string;
  project: NodeSummary | null;
}

export interface ImpactResult {
  recipe: 'impact';
  baseRef?: string;
  paths: string[];
  mappings: ImpactPathMapping[];
  projects: Array<{
    project: NodeSummary;
    matchedPaths: string[];
    r1: RecipeR1Result;
  }>;
  unmappedPaths: string[];
  sharedDependencyIds: string[];
  docPaths: string[];
}

export interface CollectImpactPathsOptions {
  workspaceRoot: string;
  paths?: string[];
  baseRef?: string;
  includeUncommitted?: boolean;
}

/**
 * Collect changed paths from explicit list and/or git diff.
 */
export function collectImpactPaths(options: CollectImpactPathsOptions): { paths: string[]; baseRef?: string } {
  const set = new Set<string>();

  for (const p of options.paths ?? []) {
    const normalized = normalizeRepoPath(p);
    if (normalized) set.add(normalized);
  }

  const includeUncommitted = options.includeUncommitted !== false;
  if (options.baseRef) {
    for (const p of gitDiffNames(options.workspaceRoot, ['diff', '--name-only', `${options.baseRef}...HEAD`])) {
      set.add(p);
    }
  } else if (includeUncommitted) {
    for (const p of gitDiffNames(options.workspaceRoot, ['diff', '--name-only'])) {
      set.add(p);
    }
    for (const p of gitDiffNames(options.workspaceRoot, ['diff', '--cached', '--name-only'])) {
      set.add(p);
    }
    for (const p of gitDiffNames(options.workspaceRoot, ['ls-files', '--others', '--exclude-standard'])) {
      set.add(p);
    }
  }

  return { paths: [...set].sort(), baseRef: options.baseRef };
}

/**
 * Map changed paths → owning projects → R1 blast radius (diff → impact).
 */
export function computeImpact(
  index: KnowledgeGraphIndex,
  paths: string[],
  options?: { baseRef?: string; maxProjects?: number },
): ImpactResult {
  const maxProjects = options?.maxProjects ?? 25;
  const mappings: ImpactPathMapping[] = [];
  const byProject = new Map<
    string,
    { node: NonNullable<ReturnType<KnowledgeGraphIndex['projectForPath']>>; paths: string[] }
  >();
  const unmappedPaths: string[] = [];

  for (const rel of paths) {
    const project = index.projectForPath(rel);
    mappings.push({
      path: rel,
      project: project ? index.summarize(project) : null,
    });
    if (!project) {
      unmappedPaths.push(rel);
      continue;
    }
    const entry = byProject.get(project.id);
    if (entry) entry.paths.push(rel);
    else byProject.set(project.id, { node: project, paths: [rel] });
  }

  const projects: ImpactResult['projects'] = [];
  for (const entry of [...byProject.values()].slice(0, maxProjects)) {
    const name = (entry.node.attrs as ProjectNodeAttrs).name;
    projects.push({
      project: index.summarize(entry.node),
      matchedPaths: entry.paths,
      r1: recipeR1(index, name, { maxPerType: 20 }),
    });
  }

  const depCounts = new Map<string, number>();
  for (const p of projects) {
    for (const dep of [...p.r1.dependsOn.out, ...p.r1.dependsOn.in]) {
      if (!byProject.has(dep.id)) {
        depCounts.set(dep.id, (depCounts.get(dep.id) ?? 0) + 1);
      }
    }
  }
  const sharedDependencyIds = [...depCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const docPaths = [
    ...new Set(projects.flatMap((p) => p.r1.documents.map((d) => d.docPath).filter((x): x is string => !!x))),
  ].sort();

  return {
    recipe: 'impact',
    baseRef: options?.baseRef,
    paths,
    mappings,
    projects,
    unmappedPaths,
    sharedDependencyIds,
    docPaths,
  };
}

function gitDiffNames(workspaceRoot: string, args: string[]): string[] {
  const result = spawnSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return [];
  }
  return (result.stdout || '')
    .split('\n')
    .map((line) => normalizeRepoPath(line))
    .filter((p): p is string => !!p && !p.startsWith('graph/'));
}

function normalizeRepoPath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.startsWith('.git/')) return null;
  return trimmed.replace(/^\.\//, '');
}

export function readPathsFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Paths file not found: ${filePath}`);
  }
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => normalizeRepoPath(l))
    .filter((p): p is string => !!p);
}

export function resolvePathList(workspaceRoot: string, relOrAbs: string): string {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(workspaceRoot, relOrAbs);
}
