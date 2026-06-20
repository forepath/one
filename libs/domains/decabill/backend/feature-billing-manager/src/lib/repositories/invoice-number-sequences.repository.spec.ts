import { InvoiceNumberSequencesRepository } from './invoice-number-sequences.repository';

describe('InvoiceNumberSequencesRepository', () => {
  it('nextInvoiceNumber increments sequence within transaction', async () => {
    const sequenceRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (row) => row),
    };
    const mockRepository = {
      manager: {
        transaction: jest.fn(async (callback) =>
          callback({
            getRepository: () => sequenceRepo,
          }),
        ),
      },
    };
    const repository = new InvoiceNumberSequencesRepository(mockRepository as never);
    const number = await repository.nextInvoiceNumber(2026);

    expect(number).toBe('INV-2026-00001');
    expect(sequenceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2026, tenantId: 'default', lastValue: 1 }),
    );
  });

  it('formats padded invoice numbers for existing sequence row', async () => {
    const sequenceRepo = {
      findOne: jest.fn().mockResolvedValue({ year: 2026, tenantId: 'default', lastValue: 41 }),
      create: jest.fn(),
      save: jest.fn().mockImplementation(async (row) => row),
    };
    const mockRepository = {
      manager: {
        transaction: jest.fn(async (callback) =>
          callback({
            getRepository: () => sequenceRepo,
          }),
        ),
      },
    };
    const repository = new InvoiceNumberSequencesRepository(mockRepository as never);

    await expect(repository.nextInvoiceNumber(2026)).resolves.toBe('INV-2026-00042');
  });
});
