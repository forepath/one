import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { KnowledgeGraphIndex, computeImpact, recipeR1, recipeR2, recipeR3, recipeR5 } from './index';
import { buildMentionPatterns, findMentions, isNoisyMentionPath } from './mentions';
import { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from '../schema';

function node(id: string, type: KnowledgeNode['type'], attrs: Record<string, unknown> = {}): KnowledgeNode {
  return { id, type, attrs: attrs as unknown as KnowledgeNode['attrs'] };
}

function edge(from: string, to: string, type: KnowledgeEdge['type']): KnowledgeEdge {
  return { from, to, type };
}

describe('knowledge graph query recipes', () => {
  const graph: KnowledgeGraph = {
    version: 1,
    generatedAt: '2026-07-23T00:00:00.000Z',
    nodes: [
      node('project:demo-lib', 'lib', { name: 'demo-lib', root: 'libs/demo-lib', tags: [], type: 'lib', targets: [] }),
      node('project:demo-app', 'app', { name: 'demo-app', root: 'apps/demo-app', tags: [], type: 'app', targets: [] }),
      node('project:other-app', 'app', {
        name: 'other-app',
        root: 'apps/other-app',
        tags: [],
        type: 'app',
        targets: [],
      }),
      node('file:libs/demo-lib/spec/openapi.yaml', 'openapi', {
        path: 'libs/demo-lib/spec/openapi.yaml',
        languageOrKind: 'openapi',
        projectName: 'demo-lib',
      }),
      node('file:libs/demo-lib/src/demo.controller.ts', 'controller', {
        path: 'libs/demo-lib/src/demo.controller.ts',
        languageOrKind: 'ts',
        projectName: 'demo-lib',
      }),
      node('api:HTTP:POST:/items', 'endpoint', {
        method: 'POST',
        pathOrChannel: '/items',
        operationId: 'createItem',
        specKind: 'openapi',
      }),
      node('concept:demo-items', 'concept', {
        title: 'Items',
        docPath: 'docs/demo/items.md',
        sectionAnchor: 'items',
      }),
    ],
    edges: [
      edge('project:demo-app', 'project:demo-lib', 'depends_on'),
      edge('project:demo-lib', 'file:libs/demo-lib/spec/openapi.yaml', 'contains'),
      edge('project:demo-lib', 'file:libs/demo-lib/src/demo.controller.ts', 'contains'),
      edge('file:libs/demo-lib/spec/openapi.yaml', 'api:HTTP:POST:/items', 'contains'),
      edge('file:libs/demo-lib/src/demo.controller.ts', 'api:HTTP:POST:/items', 'implements'),
      edge('concept:demo-items', 'project:demo-lib', 'documents'),
      edge('concept:demo-items', 'api:HTTP:POST:/items', 'documents'),
    ],
  };

  const index = new KnowledgeGraphIndex(graph);

  it('recipeR1 returns deps, contains, endpoints, and docs', () => {
    const result = recipeR1(index, 'demo-lib');
    expect(result.dependsOn.in.map((d) => d.id)).toContain('project:demo-app');
    expect(result.containsTotals.controller).toBe(1);
    expect(result.endpoints.some((e) => e.id === 'api:HTTP:POST:/items')).toBe(true);
    expect(result.documents.some((d) => d.docPath === 'docs/demo/items.md')).toBe(true);
  });

  it('recipeR2 lists doc paths', () => {
    const result = recipeR2(index, 'demo-lib');
    expect(result.docPaths).toEqual(['docs/demo/items.md']);
  });

  it('recipeR3 resolves method+path', () => {
    const result = recipeR3(index, { method: 'POST', path: '/items' });
    expect(result.owners.some((o) => o.id === 'project:demo-lib')).toBe(true);
    expect(result.implementers.some((i) => i.type === 'controller')).toBe(true);
  });

  it('recipeR5 finds keyword hits', () => {
    const result = recipeR5(index, 'createItem');
    expect(result.hits.some((h) => h.id === 'api:HTTP:POST:/items')).toBe(true);
  });

  it('computeImpact maps paths to projects', () => {
    const result = computeImpact(index, ['libs/demo-lib/src/demo.controller.ts', 'README.md']);
    expect(result.projects.some((p) => p.project.id === 'project:demo-lib')).toBe(true);
    expect(result.unmappedPaths).toContain('README.md');
  });

  it('findMentions reports soft references outside depends_on', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-mentions-'));
    try {
      fs.mkdirSync(path.join(tmp, 'apps/other-app'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'libs/demo-lib'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'apps/other-app/note.ts'), "import 'demo-lib';\n", 'utf8');
      fs.writeFileSync(path.join(tmp, 'libs/demo-lib/src.ts'), 'export const x = 1;\n', 'utf8');

      const result = findMentions(index, 'demo-lib', { workspaceRoot: tmp, maxFiles: 20 });
      expect(result.softReferenceFiles.some((f) => f.path === 'apps/other-app/note.ts')).toBe(true);
      expect(result.declaredDependents.some((d) => d.id === 'project:demo-app')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('buildMentionPatterns omits short bare names but keeps root and package', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-patterns-'));
    try {
      fs.mkdirSync(path.join(tmp, 'tools/graph'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'tools/graph/package.json'),
        JSON.stringify({ name: '@forepath/graph' }),
        'utf8'
      );
      const patterns = buildMentionPatterns(tmp, {
        name: 'graph',
        root: 'tools/graph',
        tags: [],
        type: 'tool',
        targets: [],
      });
      expect(patterns).toEqual(expect.arrayContaining(['tools/graph', '@forepath/graph']));
      expect(patterns).not.toContain('graph');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('isNoisyMentionPath filters caches and fixtures', () => {
    expect(isNoisyMentionPath('.angular/cache/x.js')).toBe(true);
    expect(isNoisyMentionPath('apps/x/vite/deps/chunk.js')).toBe(true);
    expect(isNoisyMentionPath('tools/graph/src/lib/__fixtures__/mini-workspace/a.ts')).toBe(true);
    expect(isNoisyMentionPath('apps/demo/src/main.ts')).toBe(false);
  });
});
