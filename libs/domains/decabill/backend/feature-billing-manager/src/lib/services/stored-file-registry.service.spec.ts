import { FileStorageScope } from '@forepath/shared/backend/util-file-storage';

import { StoredFileEntity } from '../entities/stored-file.entity';
import { deriveStoredFileLongSha } from '../utils/stored-file-hash.util';
import { StoredFileRegistryService } from './stored-file-registry.service';

describe('StoredFileRegistryService', () => {
  const secret = 'unit-test-signing-secret';

  function createService(overrides?: {
    findOne?: jest.Mock;
    save?: jest.Mock;
    create?: jest.Mock;
    find?: jest.Mock;
    count?: jest.Mock;
    readFile?: jest.Mock;
    getSecret?: jest.Mock;
  }) {
    const storedFiles = {
      findOne: overrides?.findOne ?? jest.fn().mockResolvedValue(null),
      save: overrides?.save ?? jest.fn(async (row: StoredFileEntity) => row),
      create: overrides?.create ?? jest.fn((input: Partial<StoredFileEntity>) => ({ ...input }) as StoredFileEntity),
      find: overrides?.find ?? jest.fn().mockResolvedValue([]),
      count: overrides?.count ?? jest.fn().mockResolvedValue(0),
    };
    const fileStorage = {
      readFile: overrides?.readFile ?? jest.fn(),
    };
    const signingConfig = {
      getSecret: overrides?.getSecret ?? jest.fn().mockReturnValue(secret),
    };

    return {
      service: new StoredFileRegistryService(storedFiles as never, fileStorage as never, signingConfig as never),
      storedFiles,
      fileStorage,
      signingConfig,
    };
  }

  it('registerFromBuffer hashes content and signs with tenant envelope', async () => {
    const saved: StoredFileEntity[] = [];
    const { service, storedFiles } = createService({
      save: jest.fn(async (row: StoredFileEntity) => {
        if (!row.id) {
          row.id = '11111111-1111-1111-1111-111111111111';
        }
        saved.push({ ...row });
        return row;
      }),
    });

    const row = await service.registerFromBuffer({
      tenantId: 'default',
      scope: FileStorageScope.customerInvoices,
      storageKey: 'sub/a.pdf',
      content: Buffer.from('pdf-bytes'),
    });

    expect(row.contentSha256).toHaveLength(64);
    expect(row.byteSize).toBe(String(Buffer.from('pdf-bytes').length));
    expect(row.signature).toHaveLength(64);
    expect(row.signatureAlg).toBe('hmac-sha256');
    expect(row.signatureVersion).toBe('v1');
    expect(row.longSha).toBe(deriveStoredFileLongSha(row.id));
    expect(storedFiles.create).toHaveBeenCalled();
  });

  it('verifyFromStorage fails closed when tenant-bound signature mismatches', async () => {
    const content = Buffer.from('pdf-bytes');
    const { service } = createService({
      getSecret: jest.fn().mockReturnValue(secret),
      readFile: jest.fn().mockResolvedValue(content),
      save: jest.fn(async (row: StoredFileEntity) => {
        row.id = '11111111-1111-1111-1111-111111111111';
        return row;
      }),
    });

    const registered = await service.registerFromBuffer({
      tenantId: 'default',
      scope: FileStorageScope.customerInvoices,
      storageKey: 'sub/a.pdf',
      content,
    });

    registered.tenantId = 'other-tenant';

    await expect(service.verifyFromStorage(registered)).resolves.toBe(false);
  });

  it('findMapForKeys indexes by scope and storage key', async () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      scope: FileStorageScope.customerOffers,
      storageKey: 'user/offer.pdf',
      longSha: 'a'.repeat(40),
      tenantId: 'default',
    } as StoredFileEntity;

    const { service } = createService({
      find: jest.fn().mockResolvedValue([row]),
    });

    const map = await service.findMapForKeys([
      { scope: FileStorageScope.customerOffers, storageKey: 'user/offer.pdf' },
    ]);

    expect(map.get(service.cacheKey(FileStorageScope.customerOffers, 'user/offer.pdf'))).toBe(row);
  });

  it('reserve creates a row and returns identity short SHA', async () => {
    const { service } = createService({
      save: jest.fn(async (row: StoredFileEntity) => {
        if (!row.id) {
          row.id = '22222222-2222-2222-2222-222222222222';
        }

        return row;
      }),
    });

    const reserved = await service.reserve('default', FileStorageScope.customerInvoices, 'sub/a.pdf');

    expect(reserved.id).toBe('22222222-2222-2222-2222-222222222222');
    expect(reserved.shas.short).toHaveLength(7);
    expect(reserved.shas.long).toBe(deriveStoredFileLongSha(reserved.id));
  });

  it('verifyFromBuffer validates upload digests and HMAC without storage reads', async () => {
    const content = Buffer.from('pdf-bytes');
    const { service, fileStorage } = createService({
      save: jest.fn(async (row: StoredFileEntity) => {
        row.id = '11111111-1111-1111-1111-111111111111';
        return row;
      }),
    });

    const registered = await service.registerFromBuffer({
      tenantId: 'default',
      scope: FileStorageScope.customerInvoices,
      storageKey: 'sub/a.pdf',
      content,
    });

    expect(service.verifyFromBuffer(registered, content)).toBe(true);
    expect(service.verifyFromBuffer(registered, Buffer.from('tampered'))).toBe(false);
    expect(fileStorage.readFile).not.toHaveBeenCalled();
  });

  it('findByDocumentId looks up by short prefix or full long SHA', async () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      longSha: 'abcdef1' + '0'.repeat(33),
      tenantId: 'default',
    } as StoredFileEntity;
    const find = jest.fn().mockResolvedValue([row]);
    const { service } = createService({ find });

    await expect(service.findByDocumentId('abcdef1')).resolves.toEqual([row]);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ longSha: expect.anything() }),
      }),
    );

    find.mockClear();
    await expect(service.findByDocumentId(row.longSha)).resolves.toEqual([row]);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { longSha: row.longSha },
      }),
    );

    await expect(service.findByDocumentId('not-hex')).resolves.toEqual([]);
  });

  it('findByContentSha256 returns matching rows', async () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      contentSha256: 'abc',
      tenantId: 'default',
    } as StoredFileEntity;
    const find = jest.fn().mockResolvedValue([row]);
    const { service } = createService({ find });

    await expect(service.findByContentSha256('abc')).resolves.toEqual([row]);
    expect(find).toHaveBeenCalled();
  });
});
