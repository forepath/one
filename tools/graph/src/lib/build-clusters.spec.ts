import { buildClusterSlice, inferDomainFromPath } from './build-clusters';
import { contextNodeId, domainNodeId, featureGroupNodeId, KnowledgeNode, projectNodeId } from './schema';

describe('inferDomainFromPath', () => {
  it('should infer domain from libs, apps, and docs paths', () => {
    expect(inferDomainFromPath('libs/domains/decabill/backend/feature-billing-manager')).toBe('decabill');
    expect(inferDomainFromPath('apps/agenstra/backend-agent-manager')).toBe('agenstra');
    expect(inferDomainFromPath('docs/forepath/README.md')).toBe('forepath');
    expect(inferDomainFromPath('tools/graph/src/index.ts')).toBeUndefined();
  });
});

describe('buildClusterSlice', () => {
  it('should create domain, context, and feature-group nodes with belongs_to edges', () => {
    const projectNodes: KnowledgeNode[] = [
      {
        id: projectNodeId('demo-api'),
        type: 'app',
        attrs: {
          name: 'demo-api',
          root: 'apps/demo-api',
          tags: ['domain:demo', 'scope:backend', 'type:app'],
          type: 'app',
          targets: ['build'],
        },
      },
      {
        id: projectNodeId('demo-feature'),
        type: 'lib',
        attrs: {
          name: 'demo-feature',
          root: 'libs/domains/demo/backend/feature-x',
          tags: ['scope:backend', 'type:feature'],
          type: 'lib',
          targets: [],
        },
      },
    ];

    const slice = buildClusterSlice({
      projectNodes,
      fileNodes: [
        {
          id: 'file:docs/demo/billing.md',
          type: 'doc',
          attrs: { path: 'docs/demo/billing.md', languageOrKind: 'md' },
        },
      ],
      conceptNodes: [
        {
          id: 'concept:demo-billing',
          type: 'concept',
          attrs: { title: 'Billing', docPath: 'docs/demo/billing.md', domain: 'demo' },
        },
      ],
    });

    const ids = new Set(slice.nodes.map((n) => n.id));
    expect(ids.has(domainNodeId('demo'))).toBe(true);
    expect(ids.has(contextNodeId('backend'))).toBe(true);
    expect(ids.has(featureGroupNodeId('app'))).toBe(true);
    expect(ids.has(featureGroupNodeId('feature'))).toBe(true);

    const domainNode = slice.nodes.find((n) => n.id === domainNodeId('demo'));
    expect(domainNode?.type).toBe('domain');
    expect(domainNode?.attrs).toMatchObject({ name: 'demo', kind: 'domain', label: 'domain' });

    expect(
      slice.edges.some(
        (e) => e.type === 'belongs_to' && e.from === projectNodeId('demo-api') && e.to === domainNodeId('demo'),
      ),
    ).toBe(true);
    expect(
      slice.edges.some(
        (e) => e.type === 'belongs_to' && e.from === projectNodeId('demo-feature') && e.to === domainNodeId('demo'),
      ),
    ).toBe(true);
    expect(
      slice.edges.some(
        (e) => e.type === 'belongs_to' && e.from === 'file:docs/demo/billing.md' && e.to === domainNodeId('demo'),
      ),
    ).toBe(true);

    expect(slice.projectAttrUpdates.get(projectNodeId('demo-api'))).toMatchObject({
      domain: 'demo',
      context: 'backend',
      featureGroup: 'app',
    });
    expect(slice.projectAttrUpdates.get(projectNodeId('demo-feature'))).toMatchObject({
      domain: 'demo',
      context: 'backend',
      featureGroup: 'feature',
    });
  });
});
