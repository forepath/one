import { OssThresholdLedgersRepository } from './oss-threshold-ledgers.repository';

describe('OssThresholdLedgersRepository', () => {
  const mockRepository = {
    findOne: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn(async (entity) => ({ id: 'ledger-1', ...entity })),
  };
  const repository = new OssThresholdLedgersRepository(mockRepository as never);

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BILLING_OSS_THRESHOLD_EUR;
  });

  it('returns existing ledger when present', async () => {
    const existing = { id: 'ledger-1', tenantId: 'unified', calendarYear: 2026 };

    mockRepository.findOne.mockResolvedValue(existing);

    await expect(repository.findOrCreate('unified', 2026)).resolves.toBe(existing);
    expect(mockRepository.create).not.toHaveBeenCalled();
  });

  it('creates ledger with default threshold', async () => {
    mockRepository.findOne.mockResolvedValue(null);

    const created = await repository.findOrCreate('unified', 2026);

    expect(mockRepository.create).toHaveBeenCalledWith({
      tenantId: 'unified',
      calendarYear: 2026,
      crossBorderB2cNetTotal: 0,
      thresholdEur: 10_000,
    });
    expect(created).toEqual(expect.objectContaining({ tenantId: 'unified', thresholdEur: 10_000 }));
  });

  it('creates ledger with env threshold override', async () => {
    process.env.BILLING_OSS_THRESHOLD_EUR = '12500';
    mockRepository.findOne.mockResolvedValue(null);

    await repository.findOrCreate('unified', 2026);

    expect(mockRepository.create).toHaveBeenCalledWith(expect.objectContaining({ thresholdEur: 12_500 }));
  });

  it('falls back to default threshold for invalid env values', async () => {
    process.env.BILLING_OSS_THRESHOLD_EUR = 'not-a-number';
    mockRepository.findOne.mockResolvedValue(null);

    await repository.findOrCreate('unified', 2026);

    expect(mockRepository.create).toHaveBeenCalledWith(expect.objectContaining({ thresholdEur: 10_000 }));
  });

  it('save delegates to typeorm repository', async () => {
    const entity = { id: 'ledger-1' } as never;

    await expect(repository.save(entity)).resolves.toEqual({ id: 'ledger-1' });
    expect(mockRepository.save).toHaveBeenCalledWith(entity);
  });
});
