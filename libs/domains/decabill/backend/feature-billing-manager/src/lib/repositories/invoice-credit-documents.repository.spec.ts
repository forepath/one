import { InvoiceCreditDocumentsRepository } from './invoice-credit-documents.repository';

describe('InvoiceCreditDocumentsRepository', () => {
  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    getMany: jest.fn(),
  };
  const mockRepository = {
    find: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn(async (entity) => entity),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };
  const repository = new InvoiceCreditDocumentsRepository(mockRepository as never);

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
  });

  it('existsAuthorizedByPdfStorageKey returns true when a tenant-scoped row exists', async () => {
    mockQueryBuilder.getCount.mockResolvedValue(2);

    await expect(repository.existsAuthorizedByPdfStorageKey('credit.pdf')).resolves.toBe(true);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('credit.pdf_storage_key = :storageKey', {
      storageKey: 'credit.pdf',
    });
  });

  it('existsAuthorizedByPdfStorageKey returns false when missing', async () => {
    mockQueryBuilder.getCount.mockResolvedValue(0);

    await expect(repository.existsAuthorizedByPdfStorageKey('missing.pdf')).resolves.toBe(false);
  });
});
