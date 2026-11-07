import { posix } from 'node:path';

import {
  mergeAgentGraphParts,
  type AgentGraphAttrValue,
  type AgentGraphEdge,
  type AgentGraphEdgeType,
  type AgentGraphNode,
  type AgentGraphNodeType,
} from '@forepath/agenstra/shared/util-opencode-config';

import { agentGraphLanguageOf } from './agent-graph-files.utils';
import type { AgentGraphManifest } from './agent-graph-manifests.utils';
import type { AgentGraphScannedDocument, AgentGraphScannedSource } from './agent-graph-scanners.utils';

/**
 * Builds the `code` (code + knowledge) and `paths` layers of an environment graph from a file listing and the
 * per-file scan results. Pure and deterministic: the same input yields the same ids, edges and communities.
 */

/** One entry of the worker file listing (relative to the working directory). */
export interface AgentGraphListedEntry {
  path: string;
  kind: 'file' | 'dir' | 'excluded';
  size?: number;
  /** Modification time (epoch seconds). */
  mtime?: number;
}

/** Scan result of one parsed file; persisted so unchanged files are not streamed again on rebuilds. */
export interface AgentGraphParsedFile {
  path: string;
  size: number;
  mtime: number;
  language?: string;
  source?: AgentGraphScannedSource;
  doc?: AgentGraphScannedDocument;
  manifest?: AgentGraphManifest;
  instructionKind?: string;
}

export interface AgentGraphBuildInput {
  environmentName: string;
  workingDirectory: string;
  mountPath?: string;
  listing: AgentGraphListedEntry[];
  parsed: Record<string, AgentGraphParsedFile>;
}

export interface AgentGraphLayerData {
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
}

export interface AgentGraphBuildResult {
  code: AgentGraphLayerData;
  paths: AgentGraphLayerData;
  languages: Record<string, number>;
  fileCount: number;
}

/** Above this many symbols only exported ones are kept (big repos would otherwise drown in locals). */
const MAX_SYMBOLS_ALL = 25_000;
const MAX_CONCEPT_LEVEL = 2;
const MAX_FANOUT_PER_IMPORT = 5;
const LABEL_PROPAGATION_ROUNDS = 12;

const JS_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.json',
];

export const AGENT_GRAPH_ENVIRONMENT_NODE_ID = 'environment';

export function agentGraphFileNodeId(path: string): string {
  return `file:${path}`;
}

export function agentGraphDirectoryNodeId(path: string): string {
  return `directory:${path || '.'}`;
}

export function agentGraphModuleNodeId(directory: string): string {
  return `module:${directory || '.'}`;
}

class GraphAccumulator {
  readonly nodes = new Map<string, AgentGraphNode>();
  private readonly edges = new Map<string, AgentGraphEdge>();

  node(id: string, type: AgentGraphNodeType, label: string, extra: Partial<AgentGraphNode> = {}): AgentGraphNode {
    const existing = this.nodes.get(id);

    if (existing) {
      return existing;
    }

    const node: AgentGraphNode = { id, type, label, ...extra };

    this.nodes.set(id, node);

    return node;
  }

  edge(
    from: string,
    to: string,
    type: AgentGraphEdgeType,
    confidence: 'extracted' | 'inferred' = 'extracted',
    attrs?: Record<string, AgentGraphAttrValue>,
  ): void {
    if (from === to || !this.nodes.has(from) || !this.nodes.has(to)) {
      return;
    }

    const key = `${type}|${from}|${to}`;

    if (!this.edges.has(key)) {
      this.edges.set(key, {
        from,
        to,
        type,
        ...(confidence === 'inferred' ? { confidence } : {}),
        ...(attrs ? { attrs } : {}),
      });
    }
  }

  result(): AgentGraphLayerData {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }
}

function dirOf(path: string): string {
  const dir = posix.dirname(path);

  return dir === '.' ? '' : dir;
}

function isInside(directory: string, path: string): boolean {
  return directory === '' || path === directory || path.startsWith(`${directory}/`);
}

/** Bare npm-style package name of a specifier (`@scope/pkg/sub` → `@scope/pkg`, `lodash/fp` → `lodash`). */
function bareJsPackageName(specifier: string): string {
  if (specifier.startsWith('node:')) {
    return specifier;
  }

  const parts = specifier.split('/');

  return specifier.startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
}

interface ModuleInfo {
  directory: string;
  name?: string;
  ecosystems: string[];
  manifests: AgentGraphManifest[];
}

/** Build both persisted layers. */
export function buildAgentGraphLayers(input: AgentGraphBuildInput): AgentGraphBuildResult {
  const files = input.listing.filter((entry) => entry.kind === 'file');
  const fileSet = new Set(files.map((entry) => entry.path));
  const parsedFiles = Object.values(input.parsed).filter((file) => fileSet.has(file.path));
  const languages: Record<string, number> = {};

  for (const entry of files) {
    const language = agentGraphLanguageOf(entry.path);

    if (language) {
      languages[language] = (languages[language] ?? 0) + 1;
    }
  }

  return {
    code: buildCodeLayer(input, parsedFiles, fileSet, languages),
    paths: buildPathsLayer(input),
    languages,
    fileCount: files.length,
  };
}

function buildCodeLayer(
  input: AgentGraphBuildInput,
  parsedFiles: AgentGraphParsedFile[],
  fileSet: Set<string>,
  languages: Record<string, number>,
): AgentGraphLayerData {
  const graph = new GraphAccumulator();
  const envId = AGENT_GRAPH_ENVIRONMENT_NODE_ID;

  graph.node(envId, 'environment', input.environmentName, {
    attrs: { workingDirectory: input.workingDirectory, ...(input.mountPath ? { mountPath: input.mountPath } : {}) },
  });

  for (const [language, count] of Object.entries(languages)) {
    graph.node(`language:${language}`, 'language', language, { attrs: { files: count } });
    graph.edge(envId, `language:${language}`, 'written_in', 'extracted', { files: count });
  }

  // Modules: one per manifest directory (tsconfig-only directories are not modules).
  const modules = new Map<string, ModuleInfo>();
  const aliases: { pattern: string; targets: string[] }[] = [];

  for (const file of parsedFiles) {
    if (!file.manifest) {
      continue;
    }

    const directory = dirOf(file.path);

    if (file.manifest.ecosystem === 'tsconfig') {
      for (const [pattern, targets] of Object.entries(file.manifest.pathAliases ?? {})) {
        aliases.push({
          pattern,
          targets: targets.map((target) => posix.normalize(posix.join(directory || '.', target))),
        });
      }

      continue;
    }

    const info = modules.get(directory) ?? { directory, ecosystems: [], manifests: [] };

    info.manifests.push(file.manifest);
    info.ecosystems = [...new Set([...info.ecosystems, file.manifest.ecosystem])];
    info.name = info.name ?? file.manifest.name;
    modules.set(directory, info);
  }

  const moduleDirectories = [...modules.keys()].sort((a, b) => b.length - a.length);
  const moduleOf = (path: string): string | undefined =>
    moduleDirectories.find((directory) => isInside(directory, path));
  const moduleByName = new Map<string, string>();

  for (const info of modules.values()) {
    const id = agentGraphModuleNodeId(info.directory);

    graph.node(id, 'module', info.name ?? (info.directory || input.environmentName), {
      path: info.directory || '.',
      attrs: { ecosystems: info.ecosystems, files: 0 },
    });

    if (info.name) {
      moduleByName.set(info.name, id);
    }
  }

  for (const info of modules.values()) {
    const id = agentGraphModuleNodeId(info.directory);
    const parent = info.directory
      ? moduleDirectories.find((directory) => directory !== info.directory && isInside(directory, info.directory))
      : undefined;

    graph.edge(parent !== undefined ? agentGraphModuleNodeId(parent) : envId, id, 'contains');
  }

  // Files, instructions, docs.
  const containerOf = (path: string): string => {
    const module = moduleOf(path);

    return module !== undefined ? agentGraphModuleNodeId(module) : envId;
  };

  for (const file of parsedFiles) {
    const id = agentGraphFileNodeId(file.path);
    const language = file.language ?? agentGraphLanguageOf(file.path);
    const type: AgentGraphNodeType = file.instructionKind ? 'instruction' : file.doc ? 'doc' : 'file';
    const label =
      file.instructionKind && file.doc?.title
        ? `${posix.basename(file.path)} — ${file.doc.title}`
        : posix.basename(file.path);

    graph.node(id, type, label, {
      path: file.path,
      attrs: {
        ...(language ? { language } : {}),
        size: file.size,
        ...(file.instructionKind ? { kind: file.instructionKind } : {}),
        ...(file.doc?.title ? { title: file.doc.title } : {}),
        ...(file.manifest ? { manifest: file.manifest.ecosystem } : {}),
      },
    });

    const container = containerOf(file.path);

    graph.edge(container, id, 'contains');

    const module = graph.nodes.get(container);

    if (module?.type === 'module' && module.attrs) {
      module.attrs['files'] = Number(module.attrs['files'] ?? 0) + 1;
    }
  }

  // Symbols.
  const totalSymbols = parsedFiles.reduce((sum, file) => sum + (file.source?.symbols.length ?? 0), 0);
  const exportedOnly = totalSymbols > MAX_SYMBOLS_ALL;
  /** `namespace.Symbol` → file path (Java / Kotlin / C# / PHP imports). */
  const qualifiedSymbols = new Map<string, string>();
  /** namespace → file paths. */
  const namespaceFiles = new Map<string, string[]>();

  for (const file of parsedFiles) {
    const source = file.source;

    if (!source) {
      continue;
    }

    if (source.namespace) {
      const list = namespaceFiles.get(source.namespace) ?? [];

      list.push(file.path);
      namespaceFiles.set(source.namespace, list);
    }

    for (const symbol of source.symbols) {
      if (source.namespace) {
        qualifiedSymbols.set(`${source.namespace.replace(/\\/g, '.')}.${symbol.name}`, file.path);
      }

      if (exportedOnly && !symbol.exported) {
        continue;
      }

      const id = `symbol:${file.path}#${symbol.name}`;

      graph.node(id, 'symbol', symbol.name, {
        path: file.path,
        attrs: { kind: symbol.kind, exported: symbol.exported, line: symbol.line },
      });
      graph.edge(agentGraphFileNodeId(file.path), id, 'defines');
    }
  }

  // Import resolution.
  const goModules = [...modules.values()]
    .filter((info) => info.ecosystems.includes('go') && info.name)
    .map((info) => ({ name: info.name as string, directory: info.directory }));
  const filesByDirectory = new Map<string, string[]>();

  for (const path of fileSet) {
    const directory = dirOf(path);
    const list = filesByDirectory.get(directory) ?? [];

    list.push(path);
    filesByDirectory.set(directory, list);
  }

  const resolveCandidates = (base: string, extensions: string[]): string | undefined => {
    const normalized = posix.normalize(base);

    if (normalized.startsWith('..')) {
      return undefined;
    }

    if (fileSet.has(normalized)) {
      return normalized;
    }

    for (const extension of extensions) {
      if (fileSet.has(`${normalized}${extension}`)) {
        return `${normalized}${extension}`;
      }
    }

    for (const extension of extensions) {
      if (fileSet.has(`${normalized}/index${extension}`)) {
        return `${normalized}/index${extension}`;
      }
    }

    return undefined;
  };
  const packageNode = (name: string, ecosystem: string): string => {
    const id = `package:${name}`;

    graph.node(id, 'package', name, { attrs: { ecosystem } });

    return id;
  };

  for (const file of parsedFiles) {
    const source = file.source;

    if (!source || source.imports.length === 0) {
      continue;
    }

    const fromId = agentGraphFileNodeId(file.path);
    const directory = dirOf(file.path);
    const language = file.language ?? agentGraphLanguageOf(file.path) ?? '';
    const link = (targetPath: string | undefined, confidence: 'extracted' | 'inferred' = 'extracted'): boolean => {
      if (!targetPath) {
        return false;
      }

      graph.node(agentGraphFileNodeId(targetPath), 'file', posix.basename(targetPath), { path: targetPath });
      graph.edge(fromId, agentGraphFileNodeId(targetPath), 'imports', confidence);

      return true;
    };

    for (const { specifier } of source.imports) {
      switch (language) {
        case 'typescript':
        case 'javascript':
        case 'vue':
        case 'svelte': {
          if (specifier.startsWith('.')) {
            link(resolveCandidates(posix.join(directory || '.', specifier), JS_EXTENSIONS));
            break;
          }

          const aliased = resolveAlias(specifier, aliases, (base) => resolveCandidates(base, JS_EXTENSIONS));

          if (link(aliased, 'inferred')) {
            break;
          }

          const name = bareJsPackageName(specifier);
          const local = moduleByName.get(specifier) ?? moduleByName.get(name);

          if (local) {
            graph.edge(fromId, local, 'imports');
          } else {
            graph.edge(fromId, packageNode(name, 'npm'), 'imports');
          }

          break;
        }

        case 'python': {
          if (specifier.startsWith('.')) {
            const dots = specifier.match(/^\.+/)?.[0].length ?? 1;
            let base = directory;

            for (let index = 1; index < dots; index++) {
              base = dirOf(base);
            }

            const rest = specifier.slice(dots).replace(/\./g, '/');

            link(resolveCandidates(posix.join(base || '.', rest || '__init__'), ['.py', '/__init__.py']));
            break;
          }

          const asPath = specifier.replace(/\./g, '/');
          const roots = ['', 'src', ...[...modules.keys()].filter(Boolean)];
          const resolved = roots
            .map((root) => resolveCandidates(posix.join(root || '.', asPath), ['.py', '/__init__.py']))
            .find(Boolean);

          if (!link(resolved)) {
            graph.edge(fromId, packageNode(specifier.split('.')[0].toLowerCase(), 'python'), 'imports');
          }

          break;
        }

        case 'go': {
          const goModule = goModules.find(
            (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
          );

          if (goModule) {
            const target = posix.join(
              goModule.directory || '.',
              specifier.slice(goModule.name.length).replace(/^\//, ''),
            );
            const targets = (filesByDirectory.get(target === '.' ? '' : target) ?? [])
              .filter((path) => path.endsWith('.go') && !path.endsWith('_test.go'))
              .slice(0, MAX_FANOUT_PER_IMPORT);

            targets.forEach((path) => link(path));
          } else if (specifier.includes('.')) {
            graph.edge(fromId, packageNode(specifier.split('/').slice(0, 3).join('/'), 'go'), 'imports');
          }

          break;
        }

        case 'java':
        case 'kotlin':
        case 'scala':
        case 'php':
        case 'csharp': {
          const normalized = specifier.replace(/\\/g, '.');
          const exact = qualifiedSymbols.get(normalized);

          if (exact) {
            link(exact);
            break;
          }

          const namespace = namespaceFiles.get(normalized) ?? namespaceFiles.get(specifier);

          if (namespace) {
            namespace.slice(0, MAX_FANOUT_PER_IMPORT).forEach((path) => link(path, 'inferred'));
          } else if (language === 'php' && (specifier.startsWith('.') || specifier.includes('/'))) {
            link(resolveCandidates(posix.join(directory || '.', specifier), ['.php']));
          }

          break;
        }

        case 'rust': {
          if (specifier.startsWith('mod:')) {
            const name = specifier.slice(4);

            link(resolveCandidates(posix.join(directory || '.', name), ['.rs', '/mod.rs']));
            break;
          }

          const parts = specifier.split('::');

          if (parts[0] === 'crate' || parts[0] === 'super' || parts[0] === 'self') {
            const crateRoot = moduleOf(file.path);
            const base =
              parts[0] === 'crate'
                ? posix.join(crateRoot || '.', 'src')
                : parts[0] === 'super'
                  ? dirOf(directory) || '.'
                  : directory || '.';

            for (let length = parts.length - 1; length >= 1; length--) {
              const resolved = resolveCandidates(posix.join(base, ...parts.slice(1, length + 1)), ['.rs', '/mod.rs']);

              if (link(resolved)) {
                break;
              }
            }
          } else if (!['std', 'core', 'alloc'].includes(parts[0])) {
            graph.edge(fromId, packageNode(parts[0].replace(/_/g, '-'), 'cargo'), 'imports');
          }

          break;
        }

        case 'dart': {
          const pkg = specifier.match(/^package:([^/]+)\/(.+)$/);

          if (pkg) {
            const local = moduleByName.get(pkg[1]);
            const localDirectory = local ? local.slice('module:'.length) : undefined;

            if (
              !(
                localDirectory !== undefined &&
                link(resolveCandidates(posix.join(localDirectory === '.' ? '' : localDirectory, 'lib', pkg[2]), []))
              )
            ) {
              graph.edge(fromId, packageNode(pkg[1], 'dart'), 'imports');
            }
          } else if (!specifier.startsWith('dart:')) {
            link(resolveCandidates(posix.join(directory || '.', specifier), ['.dart']));
          }

          break;
        }

        case 'lua': {
          link(resolveCandidates(specifier.replace(/\./g, '/'), ['.lua', '/init.lua']), 'inferred');
          break;
        }

        case 'ruby':
        case 'c':
        case 'cpp':
        case 'shell': {
          if (specifier.startsWith('.')) {
            link(resolveCandidates(posix.join(directory || '.', specifier), ['.rb', '.h', '.hpp', '.sh', '.bash']));
          } else if (language === 'ruby') {
            graph.edge(fromId, packageNode(specifier.split('/')[0], 'ruby'), 'imports');
          }

          break;
        }

        default:
          break;
      }
    }
  }

  // Module dependencies (manifest level).
  for (const info of modules.values()) {
    const id = agentGraphModuleNodeId(info.directory);

    for (const manifest of info.manifests) {
      for (const dependency of manifest.dependencies) {
        const local =
          moduleByName.get(dependency) ??
          (dependency.startsWith('project:')
            ? resolveProjectReference(dependency, info.directory, modules)
            : undefined);

        if (local) {
          graph.edge(id, local, 'depends_on');
        } else if (!dependency.startsWith('project:')) {
          graph.edge(id, packageNode(dependency, manifest.ecosystem), 'depends_on');
        }
      }
    }
  }

  // Knowledge: headings as concepts, links and path mentions.
  for (const file of parsedFiles) {
    if (!file.doc) {
      continue;
    }

    const fromId = agentGraphFileNodeId(file.path);
    const directory = dirOf(file.path);

    for (const heading of file.doc.headings) {
      if (heading.level > MAX_CONCEPT_LEVEL || !heading.slug) {
        continue;
      }

      const id = `concept:${file.path}#${heading.slug}`;

      graph.node(id, 'concept', heading.text, { path: file.path, attrs: { level: heading.level, line: heading.line } });
      graph.edge(fromId, id, 'contains');
    }

    for (const target of file.doc.links) {
      const resolved = resolveCandidates(posix.join(directory || '.', decodeSafe(target)), [
        '.md',
        '/README.md',
        '/index.md',
      ]);

      if (resolved && graph.nodes.has(agentGraphFileNodeId(resolved))) {
        graph.edge(fromId, agentGraphFileNodeId(resolved), 'links_to');
      }
    }

    for (const mention of file.doc.pathMentions) {
      const resolved = resolveCandidates(mention, []) ?? resolveCandidates(posix.join(directory || '.', mention), []);

      if (resolved && graph.nodes.has(agentGraphFileNodeId(resolved))) {
        graph.edge(fromId, agentGraphFileNodeId(resolved), 'documents', 'inferred');
      }
    }
  }

  const layer = graph.result();

  assignAgentGraphCommunities(layer);

  return layer;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveProjectReference(
  dependency: string,
  fromDirectory: string,
  modules: Map<string, ModuleInfo>,
): string | undefined {
  const reference = dependency.slice('project:'.length);
  // .csproj references are file paths; Gradle references are `:a:b` project paths.
  const candidate =
    reference.includes('/') || reference.endsWith('.csproj')
      ? dirOf(posix.normalize(posix.join(fromDirectory || '.', reference)))
      : reference.replace(/:/g, '/');

  return modules.has(candidate) ? agentGraphModuleNodeId(candidate) : undefined;
}

/** tsconfig `paths` alias resolution (`@app/*` → `src/app/*`). */
function resolveAlias(
  specifier: string,
  aliases: { pattern: string; targets: string[] }[],
  resolve: (base: string) => string | undefined,
): string | undefined {
  for (const { pattern, targets } of aliases) {
    const star = pattern.indexOf('*');
    let captured: string | undefined;

    if (star === -1) {
      captured = specifier === pattern ? '' : undefined;
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);

      if (
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        specifier.length >= prefix.length + suffix.length
      ) {
        captured = specifier.slice(prefix.length, specifier.length - suffix.length);
      }
    }

    if (captured === undefined) {
      continue;
    }

    for (const target of targets) {
      const resolved = resolve(target.replace('*', captured));

      if (resolved) {
        return resolved;
      }
    }
  }

  return undefined;
}

function buildPathsLayer(input: AgentGraphBuildInput): AgentGraphLayerData {
  const graph = new GraphAccumulator();
  const rootId = agentGraphDirectoryNodeId('');
  const totals = new Map<string, { files: number; bytes: number }>();

  graph.node(rootId, 'directory', input.workingDirectory, { path: '.', attrs: { root: true } });

  if (input.mountPath) {
    graph.node('mount:self', 'mount', input.mountPath, { attrs: { readOnly: true } });
    graph.edge(rootId, 'mount:self', 'mounted_at');
  }

  const ensureDirectory = (path: string, excluded = false): string => {
    if (!path) {
      return rootId;
    }

    const id = agentGraphDirectoryNodeId(path);

    if (!graph.nodes.has(id)) {
      const parent = ensureDirectory(dirOf(path));

      graph.node(id, 'directory', posix.basename(path), { path, ...(excluded ? { attrs: { excluded: true } } : {}) });
      graph.edge(parent, id, 'contains');
    } else if (excluded) {
      const node = graph.nodes.get(id);

      if (node) {
        node.attrs = { ...(node.attrs ?? {}), excluded: true };
      }
    }

    return id;
  };

  for (const entry of input.listing) {
    if (entry.kind === 'dir' || entry.kind === 'excluded') {
      ensureDirectory(entry.path, entry.kind === 'excluded');
      continue;
    }

    const parent = ensureDirectory(dirOf(entry.path));
    const id = agentGraphFileNodeId(entry.path);
    const language = agentGraphLanguageOf(entry.path);

    graph.node(id, 'file', posix.basename(entry.path), {
      path: entry.path,
      attrs: { size: entry.size ?? 0, ...(language ? { language } : {}) },
    });
    graph.edge(parent, id, 'contains');

    // Roll sizes up to every ancestor directory (root included).
    let directory = dirOf(entry.path);

    for (;;) {
      const total = totals.get(directory) ?? { files: 0, bytes: 0 };

      total.files += 1;
      total.bytes += entry.size ?? 0;
      totals.set(directory, total);

      if (!directory) {
        break;
      }

      directory = dirOf(directory);
    }
  }

  for (const [directory, total] of totals) {
    const node = graph.nodes.get(agentGraphDirectoryNodeId(directory));

    if (node) {
      node.attrs = { ...(node.attrs ?? {}), files: total.files, bytes: total.bytes };
    }
  }

  const layer = graph.result();

  assignAgentGraphCommunities(layer);

  return layer;
}

/**
 * Label propagation (deterministic: fixed order, ties broken by smallest label). Hubs that connect everything
 * (environment / language / package nodes) do not propagate, otherwise one community would swallow the graph.
 * Communities are renumbered by size (0 = largest).
 */
export function assignAgentGraphCommunities(layer: AgentGraphLayerData): void {
  const passive = new Set<AgentGraphNodeType>(['environment', 'language', 'package', 'mount']);
  const index = new Map<string, number>();

  layer.nodes.forEach((node, position) => index.set(node.id, position));

  const neighbors: number[][] = layer.nodes.map(() => []);

  for (const edge of layer.edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);

    if (from === undefined || to === undefined) {
      continue;
    }

    if (!passive.has(layer.nodes[to].type)) {
      neighbors[from].push(to);
    }

    if (!passive.has(layer.nodes[from].type)) {
      neighbors[to].push(from);
    }
  }

  const labels = layer.nodes.map((_, position) => position);

  for (let round = 0; round < LABEL_PROPAGATION_ROUNDS; round++) {
    let changed = false;

    for (let position = 0; position < layer.nodes.length; position++) {
      const list = neighbors[position];

      if (list.length === 0) {
        continue;
      }

      const counts = new Map<number, number>();

      for (const neighbor of list) {
        counts.set(labels[neighbor], (counts.get(labels[neighbor]) ?? 0) + 1);
      }

      let best = labels[position];
      let bestCount = counts.get(best) ?? 0;

      for (const [label, count] of counts) {
        if (count > bestCount || (count === bestCount && label < best)) {
          best = label;
          bestCount = count;
        }
      }

      if (best !== labels[position]) {
        labels[position] = best;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  const sizes = new Map<number, number>();

  for (const label of labels) {
    sizes.set(label, (sizes.get(label) ?? 0) + 1);
  }

  const ranking = new Map(
    [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([label], rank) => [label, rank] as const),
  );

  layer.nodes.forEach((node, position) => {
    node.community = ranking.get(labels[position]) ?? 0;
  });
}

/**
 * `all` view of an environment: code + paths (+ references) merged by node id (a file node links its imports, its
 * directory and the prompts that touched it). The environment node anchors the path tree and the prompt sessions.
 * Communities of the structure layers are kept; nodes only present in `extra` get communities after them.
 */
export function mergeAgentGraphLayers(
  structure: AgentGraphLayerData[],
  extra?: AgentGraphLayerData,
): AgentGraphLayerData {
  const merged = mergeAgentGraphParts(extra ? [...structure, extra] : structure);
  const ids = new Set(merged.nodes.map((node) => node.id));
  const anchors: AgentGraphEdge[] = [];

  if (ids.has(AGENT_GRAPH_ENVIRONMENT_NODE_ID)) {
    if (ids.has(agentGraphDirectoryNodeId(''))) {
      anchors.push({ from: AGENT_GRAPH_ENVIRONMENT_NODE_ID, to: agentGraphDirectoryNodeId(''), type: 'contains' });
    }

    if (extra) {
      const inSession = new Set(extra.edges.filter((edge) => edge.from.startsWith('session:')).map((edge) => edge.to));

      for (const node of extra.nodes) {
        if (node.type === 'session' || (node.type === 'prompt' && !inSession.has(node.id))) {
          anchors.push({ from: AGENT_GRAPH_ENVIRONMENT_NODE_ID, to: node.id, type: 'contains' });
        }
      }
    }
  }

  const layer = mergeAgentGraphParts([merged, { nodes: [], edges: anchors }]);
  let structureMax = -1;

  for (const part of structure) {
    for (const node of part.nodes) {
      structureMax = Math.max(structureMax, node.community ?? -1);
    }
  }

  const extraIds = new Set(extra?.nodes.map((node) => node.id) ?? []);
  const structureIds = new Set(structure.flatMap((part) => part.nodes.map((node) => node.id)));

  layer.nodes = layer.nodes.map((node) =>
    extraIds.has(node.id) && !structureIds.has(node.id)
      ? { ...node, community: structureMax + 1 + (node.community ?? 0) }
      : node,
  );

  return layer;
}

/**
 * Star topology per environment: the `environment` node is the hub of every layer. Paths hang below it via the root
 * folder, prompt references via their chat sessions (and prompts without a session).
 */
export function anchorAgentGraphLayerAtEnvironment(
  layer: AgentGraphLayerData,
  environment: { label: string; attrs?: Record<string, AgentGraphAttrValue> },
): AgentGraphLayerData {
  const envNode: AgentGraphNode = {
    id: AGENT_GRAPH_ENVIRONMENT_NODE_ID,
    type: 'environment',
    label: environment.label,
    ...(environment.attrs ? { attrs: environment.attrs } : {}),
  };
  const targets = new Set(layer.edges.map((edge) => edge.to));
  const anchors: AgentGraphEdge[] = layer.nodes
    .filter(
      (node) =>
        node.id !== AGENT_GRAPH_ENVIRONMENT_NODE_ID &&
        !targets.has(node.id) &&
        (node.id === agentGraphDirectoryNodeId('') || node.type === 'session' || node.type === 'prompt'),
    )
    .map((node) => ({ from: AGENT_GRAPH_ENVIRONMENT_NODE_ID, to: node.id, type: 'contains' as const }));

  return mergeAgentGraphParts([layer, { nodes: [envNode], edges: anchors }]);
}
