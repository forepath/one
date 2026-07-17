import { isSensitivePath } from './discover-files';
import { parseOpenApi } from './parse-openapi';
import { parseAsyncApi } from './parse-asyncapi';
import { parseMarkdown } from './parse-markdown';
import { extractControllerPaths, linkImplements, pathMatchesPrefix } from './link-implements';
import { linkDocuments } from './link-documents';
import { httpApiNodeId, channelApiNodeId, conceptNodeId, projectNodeId } from './schema';

describe('isSensitivePath', () => {
  it('should reject env and credential-like paths', () => {
    expect(isSensitivePath('apps/api/.env')).toBe(true);
    expect(isSensitivePath('apps/api/.env.local')).toBe(true);
    expect(isSensitivePath('libs/foo/my-secret-config.ts')).toBe(true);
    expect(isSensitivePath('libs/foo/credentials.json')).toBe(true);
    expect(isSensitivePath('libs/foo/openapi.yaml')).toBe(false);
  });
});

describe('parseOpenApi', () => {
  it('should emit api nodes and contains edges', () => {
    const yaml = `
openapi: 3.0.0
paths:
  /invoices:
    get:
      operationId: listInvoices
      summary: List invoices
    post:
      operationId: createInvoice
  /health:
    get:
      summary: Health
`;
    const result = parseOpenApi('libs/demo/spec/openapi.yaml', yaml);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining([
        httpApiNodeId('GET', '/invoices'),
        httpApiNodeId('POST', '/invoices'),
        httpApiNodeId('GET', '/health'),
      ]),
    );
    expect(result.edges.every((e) => e.type === 'contains')).toBe(true);
    expect(result.edges).toHaveLength(3);
  });
});

describe('parseAsyncApi', () => {
  it('should emit channel api nodes', () => {
    const yaml = `
asyncapi: 2.6.0
channels:
  billing/status:
    description: Billing live status
    publish:
      operationId: publishBillingStatus
`;
    const result = parseAsyncApi('libs/demo/spec/asyncapi.yaml', yaml);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe(channelApiNodeId('billing/status'));
    expect(result.nodes[0].attrs).toMatchObject({
      pathOrChannel: 'billing/status',
      operationId: 'publishBillingStatus',
      specKind: 'asyncapi',
    });
    expect(result.edges).toEqual([
      {
        from: 'file:libs/demo/spec/asyncapi.yaml',
        to: channelApiNodeId('billing/status'),
        type: 'contains',
      },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('should create concept nodes from H1/H2 and contains edges', () => {
    const md = `# Billing Domain

Intro about billing.

## Invoices API

See /invoices and project demo-api.
`;
    const result = parseMarkdown('docs/demo/features/billing.md', md);
    expect(result.headings).toHaveLength(2);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].id).toBe(conceptNodeId('demo-billing-domain'));
    expect(result.nodes[0].attrs).toMatchObject({
      title: 'Billing Domain',
      domain: 'demo',
      docPath: 'docs/demo/features/billing.md',
    });
    expect(result.edges).toHaveLength(2);
  });
});

describe('linkImplements', () => {
  it('should match controller prefixes to OpenAPI paths', () => {
    expect(extractControllerPaths(`@Controller('invoices')\nexport class X {}`)).toEqual(['/invoices']);
    expect(extractControllerPaths(`@Controller({ path: 'admin/billing' })\nexport class Y {}`)).toEqual([
      '/admin/billing',
    ]);
    expect(pathMatchesPrefix('/invoices/{id}', '/invoices')).toBe(true);
    expect(pathMatchesPrefix('/subscriptions', '/invoices')).toBe(false);

    const edges = linkImplements({
      controllerFiles: [
        {
          relativePath: 'libs/demo/src/invoices.controller.ts',
          absolutePath: '/tmp/does-not-exist-use-inline',
          projectName: 'demo-api',
        },
      ],
      apiNodes: [
        {
          id: httpApiNodeId('GET', '/invoices'),
          type: 'endpoint',
          attrs: {
            method: 'GET',
            pathOrChannel: '/invoices',
            specKind: 'openapi',
          },
        },
      ],
    });

    // File missing → no edges from filesystem read; test extract/path matching above instead.
    expect(edges).toEqual([]);
  });

  it('should build implements edges when controller source is readable', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-ctrl-'));
    const filePath = path.join(dir, 'invoices.controller.ts');
    fs.writeFileSync(filePath, `@Controller('invoices')\nexport class InvoicesController {}\n`);

    const edges = linkImplements({
      controllerFiles: [
        {
          relativePath: 'libs/demo/src/invoices.controller.ts',
          absolutePath: filePath,
          projectName: 'demo-api',
        },
      ],
      apiNodes: [
        {
          id: httpApiNodeId('GET', '/invoices'),
          type: 'endpoint',
          attrs: {
            method: 'GET',
            pathOrChannel: '/invoices',
            specKind: 'openapi',
          },
        },
        {
          id: httpApiNodeId('GET', '/health'),
          type: 'endpoint',
          attrs: {
            method: 'GET',
            pathOrChannel: '/health',
            specKind: 'openapi',
          },
        },
      ],
    });

    expect(edges).toEqual(
      expect.arrayContaining([
        {
          from: 'file:libs/demo/src/invoices.controller.ts',
          to: httpApiNodeId('GET', '/invoices'),
          type: 'implements',
        },
        {
          from: projectNodeId('demo-api'),
          to: httpApiNodeId('GET', '/invoices'),
          type: 'implements',
        },
      ]),
    );
    expect(edges.find((e) => e.to === httpApiNodeId('GET', '/health'))).toBeUndefined();
  });
});

describe('linkDocuments', () => {
  it('should link concepts to mentioned projects and API paths', () => {
    const conceptId = conceptNodeId('demo-invoices');
    const edges = linkDocuments({
      conceptNodes: [
        {
          id: conceptId,
          type: 'concept',
          attrs: {
            title: 'Invoices',
            docPath: 'docs/demo/features/invoices.md',
            domain: 'demo',
          },
        },
      ],
      projectNodes: [
        {
          id: projectNodeId('demo-api'),
          type: 'app',
          attrs: {
            name: 'demo-api',
            root: 'apps/demo/api',
            tags: [],
            type: 'app',
            targets: [],
          },
        },
      ],
      apiNodes: [
        {
          id: httpApiNodeId('GET', '/invoices'),
          type: 'endpoint',
          attrs: {
            method: 'GET',
            pathOrChannel: '/invoices',
            operationId: 'listInvoices',
            specKind: 'openapi',
          },
        },
      ],
      conceptTexts: new Map([[conceptId, 'The demo-api exposes /invoices via listInvoices.']]),
    });

    expect(edges).toEqual(
      expect.arrayContaining([
        { from: conceptId, to: projectNodeId('demo-api'), type: 'documents' },
        { from: conceptId, to: httpApiNodeId('GET', '/invoices'), type: 'documents' },
      ]),
    );
  });
});
