import { InvoiceVoidDocumentsRepository } from './invoice-void-documents.repository';

describe('InvoiceVoidDocumentsRepository', () => {
  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
  };
  const mockRepository = {
    findOne: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn(async (entity) => entity),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };
  const repository = new InvoiceVoidDocumentsRepository(mockRepository as never);

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
  });

  it('existsAuthorizedByPdfStorageKey returns true when a tenant-scoped row exists', async () => {
    mockQueryBuilder.getCount.mockResolvedValue(1);

    await expect(repository.existsAuthorizedByPdfStorageKey('void.pdf')).resolves.toBe(true);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('voidDoc.pdf_storage_key = :storageKey', {
      storageKey: 'void.pdf',
    });
  });

  it('existsAuthorizedByPdfStorageKey returns false when missing', async () => {
    mockQueryBuilder.getCount.mockResolvedValue(0);

    await expect(repository.existsAuthorizedByPdfStorageKey('missing.pdf')).resolves.toBe(false);
  });
});
