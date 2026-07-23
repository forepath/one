import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  extractBalancedParenContents,
  extractConstructorInjectedTypes,
  extractExportedClassNames,
  linkInjects,
  resolveInjectableTarget,
} from './link-injects';
import { fileNodeId } from './schema';

describe('extractBalancedParenContents', () => {
  it('should extract nested decorator argument lists', () => {
    const source = 'constructor(@Inject(FOO) private readonly x: XService, y: YService)';
    const open = source.indexOf('(');
    expect(extractBalancedParenContents(source, open)).toBe('@Inject(FOO) private readonly x: XService, y: YService');
  });
});

describe('extractConstructorInjectedTypes', () => {
  it('should collect PascalCase constructor param types', () => {
    const source = `
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    @Optional() private readonly invoicesRepository: InvoicesRepository,
  ) {}
}
`;
    expect(extractConstructorInjectedTypes(source)).toEqual(['InvoicesService', 'InvoicesRepository']);
  });

  it('should return empty when no constructor exists', () => {
    expect(extractConstructorInjectedTypes('export class X {}')).toEqual([]);
  });
});

describe('extractExportedClassNames', () => {
  it('should find exported classes', () => {
    expect(extractExportedClassNames('export class InvoicesService {}\nexport class Other {}')).toEqual([
      'InvoicesService',
      'Other',
    ]);
  });
});

describe('resolveInjectableTarget', () => {
  it('should prefer same-project matches', () => {
    const byClassName = new Map([
      [
        'InvoicesService',
        [
          { nodeId: 'file:a/invoices.service.ts', projectName: 'demo-api' },
          { nodeId: 'file:b/invoices.service.ts', projectName: 'other' },
        ],
      ],
    ]);
    expect(resolveInjectableTarget('InvoicesService', 'demo-api', byClassName)).toBe('file:a/invoices.service.ts');
  });

  it('should use unique global match when project differs', () => {
    const byClassName = new Map([
      ['InvoicesService', [{ nodeId: 'file:a/invoices.service.ts', projectName: 'other' }]],
    ]);
    expect(resolveInjectableTarget('InvoicesService', 'demo-api', byClassName)).toBe('file:a/invoices.service.ts');
  });

  it('should skip ambiguous global matches', () => {
    const byClassName = new Map([
      [
        'InvoicesService',
        [
          { nodeId: 'file:a/invoices.service.ts', projectName: 'a' },
          { nodeId: 'file:b/invoices.service.ts', projectName: 'b' },
        ],
      ],
    ]);
    expect(resolveInjectableTarget('InvoicesService', 'demo-api', byClassName)).toBeUndefined();
  });
});

describe('linkInjects', () => {
  it('should link controllers and gateways to injected services/repositories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-injects-'));
    const controllerPath = path.join(dir, 'invoices.controller.ts');
    const gatewayPath = path.join(dir, 'status.gateway.ts');
    const servicePath = path.join(dir, 'invoices.service.ts');
    const repositoryPath = path.join(dir, 'invoices.repository.ts');

    fs.writeFileSync(
      controllerPath,
      `export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicesRepository: InvoicesRepository,
  ) {}
}
`,
    );
    fs.writeFileSync(
      gatewayPath,
      `export class StatusGateway {
  constructor(private readonly invoicesService: InvoicesService) {}
}
`,
    );
    fs.writeFileSync(servicePath, 'export class InvoicesService {}\n');
    fs.writeFileSync(repositoryPath, 'export class InvoicesRepository {}\n');

    const edges = linkInjects({
      injectorFiles: [
        {
          relativePath: 'apps/demo-api/src/invoices.controller.ts',
          absolutePath: controllerPath,
          projectName: 'demo-api',
        },
        {
          relativePath: 'apps/demo-api/src/gateways/status.gateway.ts',
          absolutePath: gatewayPath,
          projectName: 'demo-api',
        },
      ],
      targetFiles: [
        {
          relativePath: 'apps/demo-api/src/services/invoices.service.ts',
          absolutePath: servicePath,
          projectName: 'demo-api',
        },
        {
          relativePath: 'apps/demo-api/src/repositories/invoices.repository.ts',
          absolutePath: repositoryPath,
          projectName: 'demo-api',
        },
      ],
      nodes: [
        {
          id: fileNodeId('apps/demo-api/src/services/invoices.service.ts'),
          type: 'service',
          attrs: {
            path: 'apps/demo-api/src/services/invoices.service.ts',
            languageOrKind: 'ts',
            projectName: 'demo-api',
          },
        },
        {
          id: fileNodeId('apps/demo-api/src/repositories/invoices.repository.ts'),
          type: 'repository',
          attrs: {
            path: 'apps/demo-api/src/repositories/invoices.repository.ts',
            languageOrKind: 'ts',
            projectName: 'demo-api',
          },
        },
      ],
    });

    expect(edges).toEqual(
      expect.arrayContaining([
        {
          from: fileNodeId('apps/demo-api/src/invoices.controller.ts'),
          to: fileNodeId('apps/demo-api/src/services/invoices.service.ts'),
          type: 'injects',
        },
        {
          from: fileNodeId('apps/demo-api/src/invoices.controller.ts'),
          to: fileNodeId('apps/demo-api/src/repositories/invoices.repository.ts'),
          type: 'injects',
        },
        {
          from: fileNodeId('apps/demo-api/src/gateways/status.gateway.ts'),
          to: fileNodeId('apps/demo-api/src/services/invoices.service.ts'),
          type: 'injects',
        },
      ]),
    );
    expect(edges).toHaveLength(3);
  });
});
