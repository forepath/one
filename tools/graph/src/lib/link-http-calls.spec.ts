import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  extractHttpCalls,
  extractInjectedClassTokens,
  frontendUrlToApiPath,
  linkHttpCalls,
  linkStateFacadeInjects,
  pathPatternKey,
} from './link-http-calls';
import { fileNodeId, httpApiNodeId } from './schema';

describe('frontendUrlToApiPath / pathPatternKey', () => {
  it('should normalize frontend templates to openapi-like patterns', () => {
    expect(frontendUrlToApiPath('`${this.apiUrl}/invoices/summary`'.slice(1, -1))).toBe('/invoices/summary');
    expect(frontendUrlToApiPath('${this.apiUrl}/invoices/${subscriptionId}')).toBe('/invoices/{param}');
    expect(pathPatternKey('/invoices/{subscriptionId}/ref/{invoiceRefId}')).toBe('/invoices/{param}/ref/{param}');
    expect(pathPatternKey('/invoices/{param}/ref/{param}')).toBe('/invoices/{param}/ref/{param}');
  });
});

describe('extractHttpCalls', () => {
  it('should extract method and path from HttpClient calls', () => {
    const source = `
export class InvoicesService {
  getSummary() {
    return this.http.get<InvoicesSummaryResponse>(\`\${this.apiUrl}/invoices/summary\`);
  }
  pay(id: string) {
    return this.http.post(\`\${this.apiUrl}/invoices/ref/\${id}/pay\`, {});
  }
}
`;
    expect(extractHttpCalls(source)).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: '/invoices/summary' },
        { method: 'POST', path: '/invoices/ref/{param}/pay' },
      ]),
    );
  });
});

describe('extractInjectedClassTokens', () => {
  it('should find inject(Service) tokens', () => {
    expect(extractInjectedClassTokens('private readonly x = inject(InvoicesService);')).toEqual(['InvoicesService']);
  });
});

describe('linkHttpCalls', () => {
  it('should link frontend services to matching OpenAPI endpoints', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-http-'));
    const servicePath = path.join(dir, 'invoices.service.ts');
    fs.writeFileSync(
      servicePath,
      `export class InvoicesService {
  getSummary() { return this.http.get(\`\${this.apiUrl}/invoices/summary\`); }
}
`,
    );

    const edges = linkHttpCalls({
      serviceFiles: [
        {
          relativePath: 'libs/domains/decabill/frontend/data-access-x/src/lib/services/invoices.service.ts',
          absolutePath: servicePath,
          projectName: 'decabill-frontend-data-access-x',
        },
      ],
      endpointNodes: [
        {
          id: httpApiNodeId('GET', '/invoices/summary'),
          type: 'endpoint',
          attrs: {
            method: 'GET',
            pathOrChannel: '/invoices/summary',
            specKind: 'openapi',
          },
        },
      ],
    });

    expect(edges).toEqual([
      {
        from: fileNodeId('libs/domains/decabill/frontend/data-access-x/src/lib/services/invoices.service.ts'),
        to: httpApiNodeId('GET', '/invoices/summary'),
        type: 'calls',
      },
    ]);
  });
});

describe('linkStateFacadeInjects', () => {
  it('should link state slices to services injected in facades', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-facade-'));
    const stateDir = path.join(dir, 'invoices');
    fs.mkdirSync(stateDir);
    fs.writeFileSync(
      path.join(stateDir, 'invoices.facade.ts'),
      `export class InvoicesFacade { private readonly s = inject(InvoicesService); }\n`,
    );
    const servicePath = path.join(dir, 'invoices.service.ts');
    fs.writeFileSync(servicePath, 'export class InvoicesService {}\n');

    const edges = linkStateFacadeInjects({
      stateDirs: [
        {
          relativePath: 'libs/x/src/lib/state/invoices',
          absolutePath: stateDir,
          projectName: 'x',
          memberFiles: ['invoices.facade.ts'],
        },
      ],
      serviceFiles: [
        {
          relativePath: 'libs/x/src/lib/services/invoices.service.ts',
          absolutePath: servicePath,
          projectName: 'x',
        },
      ],
      nodes: [
        {
          id: fileNodeId('libs/x/src/lib/services/invoices.service.ts'),
          type: 'service',
          attrs: {
            path: 'libs/x/src/lib/services/invoices.service.ts',
            languageOrKind: 'ts',
            projectName: 'x',
          },
        },
      ],
    });

    expect(edges).toEqual([
      {
        from: fileNodeId('libs/x/src/lib/state/invoices'),
        to: fileNodeId('libs/x/src/lib/services/invoices.service.ts'),
        type: 'injects',
      },
    ]);
  });
});
