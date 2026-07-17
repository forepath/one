import * as fs from 'fs';
import * as path from 'path';

import type { KnowledgeGraph } from './schema';

/**
 * Atomically write graph JSON to disk (temp file then rename).
 */
export function writeGraphJsonAtomic(outDir: string, graph: KnowledgeGraph): string {
  fs.mkdirSync(outDir, { recursive: true });
  const finalPath = path.join(outDir, 'graph.json');
  const tempPath = path.join(outDir, `.graph.json.${process.pid}.tmp`);
  const content = `${JSON.stringify(graph, null, 2)}\n`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, finalPath);
  return finalPath;
}
