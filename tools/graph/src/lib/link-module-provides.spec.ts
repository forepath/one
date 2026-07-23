import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  extractBalancedBracketContents,
  extractModuleProvidedClassNames,
  linkModuleProvides,
} from './link-module-provides';
import { fileNodeId } from './schema';

describe('extractModuleProvidedClassNames', () => {
  it('should read controllers and providers from @Module metadata', () => {
    const source = `
@Module({
  imports: [TypeOrmModule.forFeature([InvoiceEntity])],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicesRepository, StatusGateway],
  exports: [InvoicesService],
})
export class InvoicesModule {}
`;
    expect(extractModuleProvidedClassNames(source)).toEqual(
      expect.arrayContaining(['InvoicesController', 'InvoicesService', 'InvoicesRepository', 'StatusGateway']),
    );
    expect(extractModuleProvidedClassNames(source)).not.toContain('InvoiceEntity');
  });
});

describe('extractBalancedBracketContents', () => {
  it('should extract nested arrays', () => {
    expect(extractBalancedBracketContents('[a, [b], c]', 0)).toBe('a, [b], c');
  });
});

describe('linkModuleProvides', () => {
  it('should emit provides edges from module to registered classes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-mod-'));
    const modulePath = path.join(dir, 'invoices.module.ts');
    const controllerPath = path.join(dir, 'invoices.controller.ts');
    const servicePath = path.join(dir, 'invoices.service.ts');
    fs.writeFileSync(
      modulePath,
      `@Module({ controllers: [InvoicesController], providers: [InvoicesService] })\nexport class InvoicesModule {}\n`,
    );
    fs.writeFileSync(controllerPath, 'export class InvoicesController {}\n');
    fs.writeFileSync(servicePath, 'export class InvoicesService {}\n');

    const edges = linkModuleProvides({
      moduleFiles: [
        {
          relativePath: 'apps/demo-api/src/invoices.module.ts',
          absolutePath: modulePath,
          projectName: 'demo-api',
        },
      ],
      targetFiles: [
        {
          relativePath: 'apps/demo-api/src/invoices.controller.ts',
          absolutePath: controllerPath,
          projectName: 'demo-api',
        },
        {
          relativePath: 'apps/demo-api/src/services/invoices.service.ts',
          absolutePath: servicePath,
          projectName: 'demo-api',
        },
      ],
      nodes: [
        {
          id: fileNodeId('apps/demo-api/src/invoices.controller.ts'),
          type: 'controller',
          attrs: {
            path: 'apps/demo-api/src/invoices.controller.ts',
            languageOrKind: 'ts',
            projectName: 'demo-api',
          },
        },
        {
          id: fileNodeId('apps/demo-api/src/services/invoices.service.ts'),
          type: 'service',
          attrs: {
            path: 'apps/demo-api/src/services/invoices.service.ts',
            languageOrKind: 'ts',
            projectName: 'demo-api',
          },
        },
      ],
    });

    expect(edges).toEqual(
      expect.arrayContaining([
        {
          from: fileNodeId('apps/demo-api/src/invoices.module.ts'),
          to: fileNodeId('apps/demo-api/src/invoices.controller.ts'),
          type: 'provides',
        },
        {
          from: fileNodeId('apps/demo-api/src/invoices.module.ts'),
          to: fileNodeId('apps/demo-api/src/services/invoices.service.ts'),
          type: 'provides',
        },
      ]),
    );
  });
});
