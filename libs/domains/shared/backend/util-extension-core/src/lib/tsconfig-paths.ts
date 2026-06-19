import * as fs from 'fs';
import * as path from 'path';

interface TsconfigPathsCache {
  workspaceRoot: string;
  paths: Record<string, string[]>;
}

let cache: TsconfigPathsCache | undefined;

function readTsconfigPaths(workspaceRoot: string): Record<string, string[]> {
  if (cache?.workspaceRoot === workspaceRoot) {
    return cache.paths;
  }

  const tsconfigPath = path.join(workspaceRoot, 'tsconfig.base.json');
  const raw = fs.readFileSync(tsconfigPath, 'utf-8');
  const parsed = JSON.parse(raw) as { compilerOptions?: { paths?: Record<string, string[]> } };
  const paths = parsed.compilerOptions?.paths ?? {};

  cache = { workspaceRoot, paths };

  return paths;
}

export function resolveMonorepoPackageRoot(importPath: string, workspaceRoot: string): string {
  const paths = readTsconfigPaths(workspaceRoot);
  const mapped = paths[importPath];

  if (!mapped?.[0]) {
    throw new Error(`No tsconfig path mapping found for monorepo import '${importPath}'.`);
  }

  const mappedPath = mapped[0];
  const absoluteEntry = path.resolve(workspaceRoot, mappedPath);

  if (mappedPath.includes('/src/')) {
    return path.resolve(workspaceRoot, mappedPath.split('/src/')[0] ?? mappedPath);
  }

  if (absoluteEntry.endsWith(`${path.sep}index.ts`) || absoluteEntry.endsWith(`${path.sep}index.js`)) {
    return path.dirname(path.dirname(absoluteEntry));
  }

  return path.dirname(absoluteEntry);
}
