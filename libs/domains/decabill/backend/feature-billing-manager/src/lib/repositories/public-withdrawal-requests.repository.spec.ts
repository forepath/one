import { PublicWithdrawalRequestsRepository } from './public-withdrawal-requests.repository';

describe('PublicWithdrawalRequestsRepository', () => {
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
  };
  let repository: PublicWithdrawalRequestsRepository;

  beforeEach(() => {
    mockRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'req-1', ...value })),
      findOne: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    };
    repository = new PublicWithdrawalRequestsRepository(mockRepository as never);
  });

  it('creates a request', async () => {
    const expiresAt = new Date('2026-01-03T00:00:00Z');
    const result = await repository.createRequest('sub-1', 'ABC123', expiresAt);

    expect(mockRepository.create).toHaveBeenCalledWith({
      subscriptionId: 'sub-1',
      confirmationCode: 'ABC123',
      expiresAt,
    });
    expect(result.id).toBe('req-1');
  });

  it('finds active pending by subscription id', async () => {
    const pending = { id: 'req-1', subscriptionId: 'sub-1' };

    mockRepository.findOne.mockResolvedValue(pending);

    const result = await repository.findActivePendingBySubscriptionId('sub-1');

    expect(result).toEqual(pending);
  });

  it('marks code verified and confirmed', async () => {
    const verifiedAt = new Date();
    const confirmedAt = new Date();

    await repository.markCodeVerified('req-1', verifiedAt);
    await repository.markConfirmed('req-1', confirmedAt);

    expect(mockRepository.update).toHaveBeenCalledWith('req-1', { codeVerifiedAt: verifiedAt });
    expect(mockRepository.update).toHaveBeenCalledWith('req-1', { confirmedAt });
  });
});
