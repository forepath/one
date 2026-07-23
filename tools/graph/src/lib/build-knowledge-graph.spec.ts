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

  it('should assemble projects, typed sources, specs, docs, implements, and documents', () => {
    const graph = buildKnowledgeGraph({
      projectGraph,
      workspaceRoot,
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    expect(graph.version).toBe(1);
    expect(graph.generatedAt).toBe('2026-07-17T00:00:00.000Z');

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const ids = new Set(byId.keys());

    expect(ids.has(projectNodeId('demo-api'))).toBe(true);
    expect(ids.has(projectNodeId('demo-feature'))).toBe(true);
    expect(ids.has('file:libs/demo-feature/spec/openapi.yaml')).toBe(true);
    expect(ids.has('file:libs/demo-feature/spec/asyncapi.yaml')).toBe(true);
    expect(ids.has('file:apps/demo-api/src/invoices.controller.ts')).toBe(true);
    expect(ids.has('file:docs/demo/billing.md')).toBe(true);
    expect(ids.has(httpApiNodeId('GET', '/invoices'))).toBe(true);
    expect(ids.has(httpApiNodeId('POST', '/invoices'))).toBe(true);
    expect(ids.has(channelApiNodeId('demo/status'))).toBe(true);
    expect(byId.get(channelApiNodeId('demo/status'))?.type).toBe('channel');
    expect(byId.get(httpApiNodeId('GET', '/invoices'))?.type).toBe('endpoint');
    expect(ids.has('domain:demo')).toBe(true);

    expect(byId.get('file:apps/demo-api/src/invoices.controller.ts')?.type).toBe('controller');
    expect(byId.get('file:apps/demo-api/src/gateways/status.gateway.ts')?.type).toBe('gateway');
    expect(byId.get('file:apps/demo-api/src/services/invoice-overdue.job-handler.ts')?.type).toBe('job');
    expect(byId.get('file:apps/demo-api/src/services/invoices.service.ts')?.type).toBe('service');
    expect(byId.get('file:apps/demo-api/src/entities/invoice.entity.ts')?.type).toBe('entity');
    expect(byId.get('file:apps/demo-api/src/dto/create-invoice.dto.ts')?.type).toBe('dto');
    expect(byId.get('file:apps/demo-api/src/repositories/invoices.repository.ts')?.type).toBe('repository');
    expect(byId.get('file:apps/demo-api/src/guards/tenant-user.guard.ts')?.type).toBe('guard');
    expect(byId.get('file:apps/demo-api/src/demo-api.module.ts')?.type).toBe('module');
    expect(byId.get('file:apps/demo-api/src/providers/demo-cloud.provider.ts')?.type).toBe('provider');
    expect(byId.get('file:apps/demo-api/src/payment-processors/processors/stripe-payment.processor.ts')?.type).toBe(
      'provider',
    );

    const emailNode = byId.get('file:apps/demo-api/src/templates/invoice-issued');
    expect(emailNode?.type).toBe('email');
    expect(emailNode?.attrs).toMatchObject({
      templateName: 'invoice-issued',
      projectName: 'demo-api',
    });
    expect((emailNode?.attrs as { memberFiles?: string[] }).memberFiles).toEqual(
      expect.arrayContaining(['invoice-issued.template.html', 'invoice-issued.template.txt']),
    );
    expect(ids.has('file:apps/demo-api/src/templates/email-layout.partial.html')).toBe(false);

    expect(ids.has('webhook-event:demo-api:invoice.issued')).toBe(true);
    expect(byId.get('webhook-event:demo-api:invoice.issued')?.type).toBe('webhook-event');
    expect(ids.has('file:apps/demo-api/src/notifications/demo-notification.events.ts')).toBe(false);

    const stateNode = byId.get('file:libs/demo-feature/src/lib/state/invoices');
    expect(stateNode?.type).toBe('state');
    expect(stateNode?.attrs).toMatchObject({
      sliceName: 'invoices',
      projectName: 'demo-feature',
    });
    expect((stateNode?.attrs as { memberFiles?: string[] }).memberFiles).toEqual(
      expect.arrayContaining([
        'invoices.actions.ts',
        'invoices.reducer.ts',
        'invoices.effects.ts',
        'invoices.selectors.ts',
      ]),
    );
    expect(ids.has('file:libs/demo-feature/src/lib/state/invoices/invoices.actions.ts')).toBe(false);

    expect(byId.get('file:libs/demo-feature/src/lib/services/invoices.service.ts')?.type).toBe('service');

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

    expect(
      graph.edges.some(
        (e) =>
          e.type === 'implements' &&
          e.from === 'file:apps/demo-api/src/gateways/status.gateway.ts' &&
          e.to === channelApiNodeId('demo/status'),
      ),
    ).toBe(true);

    expect(
      graph.edges.some(
        (e) =>
          e.type === 'injects' &&
          e.from === 'file:apps/demo-api/src/invoices.controller.ts' &&
          e.to === 'file:apps/demo-api/src/services/invoices.service.ts',
      ),
    ).toBe(true);

    expect(
      graph.edges.some(
        (e) =>
          e.type === 'injects' &&
          e.from === 'file:apps/demo-api/src/invoices.controller.ts' &&
          e.to === 'file:apps/demo-api/src/repositories/invoices.repository.ts',
      ),
    ).toBe(true);

    expect(
      graph.edges.some(
        (e) =>
          e.type === 'injects' &&
          e.from === 'file:apps/demo-api/src/gateways/status.gateway.ts' &&
          e.to === 'file:apps/demo-api/src/services/invoices.service.ts',
      ),
    ).toBe(true);

    expect(
      graph.edges.some(
        (e) =>
          e.type === 'contains' &&
          e.from === 'file:libs/demo-feature/src/lib/state/invoices' &&
          e.to === 'file:libs/demo-feature/src/lib/services/invoices.service.ts',
      ),
    ).toBe(true);

    expect(graph.edges.some((e) => e.type === 'documents' && e.to === projectNodeId('demo-api'))).toBe(true);

    expect(graph.nodes.length).toBeGreaterThanOrEqual(10);
    expect(graph.edges.length).toBeGreaterThanOrEqual(8);
  });
});
