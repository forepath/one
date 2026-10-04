import { FileStorageProviderFactory } from './file-storage-provider.factory';
import { FileStorageService } from './file-storage.service';
import type { FileStorageProvider } from './file-storage-provider.interface';
import { FileStorageScope } from './file-storage-scope.constants';

describe('FileStorageService', () => {
  const originalEnv = process.env;
  let factory: FileStorageProviderFactory;
  let provider: FileStorageProvider;
  let service: FileStorageService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FILE_STORAGE_ROOT: '/data',
      FILE_STORAGE_PROVIDER: 'local',
      FILE_STORAGE_LAYOUT_DUAL_READ_ENABLED: 'false',
    };
    factory = new FileStorageProviderFactory();
    provider = {
      getType: () => 'local',
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue(Buffer.from('bytes')),
      fileExists: jest.fn().mockResolvedValue(true),
    };
    factory.registerProvider(provider);
    service = new FileStorageService(factory);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('delegates invoice helpers to customer invoices scope under canonical root', async () => {
    await service.writeInvoiceFile('sub/a.pdf', Buffer.from('x'));
    await service.readInvoiceFile('sub/a.pdf');
    await service.invoiceFileExists('sub/a.pdf');

    expect(provider.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(pathJoin('customer', 'invoices')),
      'sub/a.pdf',
      Buffer.from('x'),
    );
    expect(provider.readFile).toHaveBeenCalledWith(
      expect.stringContaining(pathJoin('customer', 'invoices')),
      'sub/a.pdf',
    );
    expect(provider.fileExists).toHaveBeenCalledWith(
      expect.stringContaining(pathJoin('customer', 'invoices')),
      'sub/a.pdf',
    );
  });

  it('delegates datev helpers to export/datev scope', async () => {
    await service.writeDatevExportFile('t/2026/01/e.zip', Buffer.from('z'));

    expect(provider.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(pathJoin('export', 'datev')),
      't/2026/01/e.zip',
      Buffer.from('z'),
    );
  });

  it('writeFile uses explicit scope', async () => {
    await service.writeFile(FileStorageScope.datevExports, 'k.zip', Buffer.from('z'));

    expect(provider.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(pathJoin('export', 'datev')),
      'k.zip',
      Buffer.from('z'),
    );
  });

  it('propagates factory error for invalid FILE_STORAGE_PROVIDER', async () => {
    process.env.FILE_STORAGE_PROVIDER = 'locl';

    await expect(service.readInvoiceFile('a.pdf')).rejects.toThrow(
      "File storage provider 'locl' not found. Available: local",
    );
  });
});

function pathJoin(...parts: string[]): string {
  return parts.join('/');
}
