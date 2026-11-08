/**
 * Jest stand-in for `src/lib/graphs/graph-worker.factory.ts` (its `import.meta.url` worker pattern does not compile
 * to CommonJS): no worker, so the graph viewer runs its jobs inline.
 */
export function graphWorkerFactory(): null {
  return null;
}
