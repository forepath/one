import { VatIdValidationSource, VatIdValidationStatus } from '../constants/vat-id-validation.constants';

import { VatIdValidationJobHandler } from './vat-id-validation.job-handler';

describe('VatIdValidationJobHandler', () => {
  const vatIdValidationService = {
    validateAsync: jest.fn(),
  };
  const customerProfilesRepository = {
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  };

  const handler = new VatIdValidationJobHandler(vatIdValidationService as never, customerProfilesRepository as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists async validation result onto the profile', async () => {
    const validatedAt = new Date('2026-07-01T00:00:00Z');

    vatIdValidationService.validateAsync.mockResolvedValue({
      status: VatIdValidationStatus.VALID,
      source: VatIdValidationSource.VIES_ASYNC,
      validatedAt,
      vatId: 'DE123456789',
    });
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({ id: 'profile-1' });
    customerProfilesRepository.update.mockResolvedValue({ id: 'profile-1' });

    await handler.processUnit({
      profileId: 'profile-1',
      userId: 'user-1',
      vatId: 'DE123456789',
    });

    expect(vatIdValidationService.validateAsync).toHaveBeenCalledWith({
      profileId: 'profile-1',
      userId: 'user-1',
      vatId: 'DE123456789',
    });
    expect(customerProfilesRepository.update).toHaveBeenCalledWith('profile-1', {
      vatId: 'DE123456789',
      vatIdValidationStatus: VatIdValidationStatus.VALID,
      vatIdValidatedAt: validatedAt,
      vatIdValidationSource: VatIdValidationSource.VIES_ASYNC,
    });
  });

  it('clears vatId when validation returns null', async () => {
    vatIdValidationService.validateAsync.mockResolvedValue({
      status: VatIdValidationStatus.INVALID,
      source: VatIdValidationSource.FORMAT_ONLY,
      validatedAt: new Date(),
      vatId: null,
    });
    customerProfilesRepository.findByIdOrThrow.mockResolvedValue({ id: 'profile-2' });

    await handler.processUnit({
      profileId: 'profile-2',
      userId: 'user-2',
      vatId: 'BAD',
    });

    expect(customerProfilesRepository.update).toHaveBeenCalledWith(
      'profile-2',
      expect.objectContaining({
        vatId: undefined,
        vatIdValidationStatus: VatIdValidationStatus.INVALID,
      }),
    );
  });
});
