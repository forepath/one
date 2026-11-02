import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

/**
 * Runtime import cycles between files that contain injectable classes leave constructor parameter types
 * `undefined` while decorators run, so Nest can't resolve them ("argument Object at index [n]") and the app
 * doesn't start — something only a real boot showed. This keeps such cycles out of the Loadweaver backends.
 */
const LIB_ROOT = join(__dirname, '..');
const ROOTS = [LIB_ROOT, join(LIB_ROOT, '../../feature-fleet/src'), join(LIB_ROOT, '../../feature-node-agent/src')];
/** Known cycles that only share constants used at call time (no injection between them). */
const ALLOWED = new Set(['lib/workloads/checkpoint.manager.ts|lib/workloads/restored-runtime.ts']);

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

function runtimeImports(file: string, source: string, known: Set<string>): string[] {
  const out: string[] = [];

  for (const match of source.matchAll(/^import\s+(type\s+)?([^;]*?)from\s+'(\.[^']+)'/gms)) {
    if (match[1]) continue;

    const braces = /\{([^}]*)\}/.exec(match[2]);
    const onlyTypes =
      braces &&
      !/^\s*[A-Za-z_$][\w$]*\s*,/.test(match[2]) &&
      braces[1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .every((name) => name.startsWith('type '));

    if (onlyTypes) continue;

    const target = normalize(join(dirname(file), match[3]));
    const resolved = [`${target}.ts`, join(target, 'index.ts')].find((candidate) => known.has(candidate));

    if (resolved) out.push(resolved);
  }

  return out;
}

function cyclesWithInjectables(root: string): string[][] {
  const files = sourceFiles(root);
  const known = new Set(files);
  const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
  const graph = new Map(files.map((file) => [file, runtimeImports(file, sources.get(file) ?? '', known)]));
  // Tarjan's strongly connected components.
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

      if (component.length > 1 && component.some((file) => sources.get(file)?.includes('@Injectable'))) {
        result.push(component.map((file) => relative(root, file)).sort());
      }
    }
  };

  for (const file of files) if (!index.has(file)) visit(file);

  return result.filter((component) => !ALLOWED.has(component.join('|')));
}

describe('no runtime import cycles between injectables', () => {
  it.each(ROOTS.map((root) => [relative(join(LIB_ROOT, '../..'), root), root]))('%s', (_name, root) => {
    expect(cyclesWithInjectables(root)).toEqual([]);
  });
});
