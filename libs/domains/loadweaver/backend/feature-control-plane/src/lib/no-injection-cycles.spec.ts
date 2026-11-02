import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Constructor injection cycles between providers (A injects B … injects A, also through `useExisting` / `useClass`
 * aliases) make Nest wait forever while it instantiates the module: the app neither starts nor fails, it just hangs
 * (the control plane stopped after `UsersAuthModule`). Lazy `ModuleRef` lookups and `forwardRef` are not edges.
 * Complements `no-import-cycles.spec.ts` (runtime import cycles).
 */
const LIB_ROOT = join(__dirname, '..');
const ROOTS = [LIB_ROOT, join(LIB_ROOT, '../../feature-fleet/src'), join(LIB_ROOT, '../../feature-node-agent/src')];

function sourceFiles(root: string): string[] {
  const out: string[] = [];

  for (const name of readdirSync(root)) {
    const path = join(root, name);

    if (statSync(path).isDirectory()) {
      if (name !== 'integration' && name !== 'node_modules') out.push(...sourceFiles(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(path);
  }

  return out;
}

/** Splits a parameter list at top-level commas. */
function splitParams(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of text) {
    if ('(<[{'.includes(char)) depth++;
    if (')>]}'.includes(char)) depth--;

    if (char === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += char;
  }

  if (current.trim()) out.push(current);

  return out;
}

/** The constructor parameter list of the class starting at `from` (balanced parentheses), or null. */
function constructorParams(source: string, from: number): string | null {
  const nextClass = source.indexOf('\nexport class ', from + 1);
  const start = source.indexOf('constructor(', from);

  if (start < 0 || (nextClass >= 0 && start > nextClass)) return null;

  let depth = 0;

  for (let i = start + 'constructor'.length; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] === ')' && --depth === 0) return source.slice(start + 'constructor('.length, i);
  }

  return null;
}

/** Provider → what it waits for at construction (class names / injection tokens). */
export function injectionGraph(files: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const add = (from: string, to: string): void => {
    graph.set(from, [...(graph.get(from) ?? []), to]);
  };

  for (const file of files) {
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(
      /@(?:Injectable|Controller|WebSocketGateway|Processor|Resolver)\([^]*?export class (\w+)/g,
    )) {
      const params = constructorParams(source, (match.index ?? 0) + match[0].length);

      if (!params) continue;

      for (const param of splitParams(params)) {
        if (param.includes('forwardRef')) continue;

        const token = /@Inject\(\s*(\w+)\s*\)/.exec(param)?.[1] ?? /\w+\??\s*:\s*([A-Z]\w*)/.exec(param)?.[1];

        if (token) add(match[1], token);
      }
    }

    for (const match of source.matchAll(/provide:\s*(\w+)\s*,\s*use(?:Existing|Class):\s*(\w+)/g))
      add(match[1], match[2]);
  }

  return graph;
}

function cycles(graph: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  let counter = 0;
  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter++);
    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
    }

    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string | undefined;

      do {
        member = stack.pop();

        if (member) {
          onStack.delete(member);
          component.push(member);
        }
      } while (member && member !== node);

      if (component.length > 1 || (graph.get(node) ?? []).includes(node)) result.push(component.sort());
    }
  };

  for (const node of graph.keys()) if (!index.has(node)) visit(node);

  return result;
}

describe('no constructor injection cycles between providers', () => {
  it('detects a cycle through a useExisting alias (self-check of the parser)', () => {
    const graph = new Map([
      ['InstallService', ['ClusterIdentityService', 'APT_SNAPSHOT_READER']],
      ['APT_SNAPSHOT_READER', ['AptSnapshotService']],
      ['AptSnapshotService', ['InstallService']],
    ]);

    expect(cycles(graph)).toEqual([['APT_SNAPSHOT_READER', 'AptSnapshotService', 'InstallService']]);
  });

  it.each(ROOTS.map((root) => [relative(join(LIB_ROOT, '../..'), root), root]))('%s', (_name, root) => {
    expect(cycles(injectionGraph(sourceFiles(root)))).toEqual([]);
  });
});
