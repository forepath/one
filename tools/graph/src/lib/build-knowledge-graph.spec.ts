import * as path from 'path';

import type { ProjectGraph } from '@nx/devkit';

import { buildKnowledgeGraph } from './build-knowledge-graph';
import { httpApiNodeId, channelApiNodeId, projectNodeId } from './schema';

describe('buildKnowledgeGraph (fixture workspace)', () => {
  const workspaceRoot = path.join(__dirname, '__fixtures__/mini-workspace');

  const projectGraph = {
    nodes: {
      'demo-api': {
        name: 'demo-api',
        type: 'app',
        data: {
          root: 'apps/demo-api',
          projectType: 'application',
          tags: ['domain:demo'],
          targets: { build: {} },
        },
      },
      'demo-feature': {
        name: 'demo-feature',
        type: 'lib',
        data: {
          root: 'libs/demo-feature',
          projectType: 'library',
          tags: ['domain:demo'],
          targets: {},
        },
      },
    },
    dependencies: {
      'demo-api': [{ source: 'demo-api', target: 'demo-feature', type: 'static' }],
      'demo-feature': [],
    },
  } as unknown as ProjectGraph;

  it('should assemble projects, specs, docs, implements, and documents', () => {
    const graph = buildKnowledgeGraph({
      projectGraph,
      workspaceRoot,
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    expect(graph.version).toBe(1);
    expect(graph.generatedAt).toBe('2026-07-17T00:00:00.000Z');

    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(ids.has(projectNodeId('demo-api'))).toBe(true);
    expect(ids.has(projectNodeId('demo-feature'))).toBe(true);
    expect(ids.has('file:libs/demo-feature/spec/openapi.yaml')).toBe(true);
    expect(ids.has('file:libs/demo-feature/spec/asyncapi.yaml')).toBe(true);
    expect(ids.has('file:apps/demo-api/src/invoices.controller.ts')).toBe(true);
    expect(ids.has('file:docs/demo/billing.md')).toBe(true);
    expect(ids.has(httpApiNodeId('GET', '/invoices'))).toBe(true);
    expect(ids.has(httpApiNodeId('POST', '/invoices'))).toBe(true);
    expect(ids.has(channelApiNodeId('demo/status'))).toBe(true);
    expect(ids.has('domain:demo')).toBe(true);

    const demoApi = graph.nodes.find((n) => n.id === projectNodeId('demo-api'));
    expect(demoApi?.attrs).toMatchObject({ domain: 'demo' });

    expect(
      graph.edges.some(
        (e) => e.type === 'belongs_to' && e.from === projectNodeId('demo-api') && e.to === 'domain:demo',
      ),
    ).toBe(true);

    expect(
      graph.edges.some(
        (e) =>
          e.type === 'depends_on' && e.from === projectNodeId('demo-api') && e.to === projectNodeId('demo-feature'),
      ),
    ).toBe(true);

    expect(
      graph.edges.some(
        (e) =>
          e.type === 'implements' &&
          e.from === 'file:apps/demo-api/src/invoices.controller.ts' &&
          e.to === httpApiNodeId('GET', '/invoices'),
      ),
    ).toBe(true);

    expect(graph.edges.some((e) => e.type === 'documents' && e.to === projectNodeId('demo-api'))).toBe(true);

    expect(graph.nodes.length).toBeGreaterThanOrEqual(10);
    expect(graph.edges.length).toBeGreaterThanOrEqual(8);
  });
});
