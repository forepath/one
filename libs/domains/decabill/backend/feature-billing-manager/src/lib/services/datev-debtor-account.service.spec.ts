import { SHARED_NUMBER_SCOPE } from '@forepath/shared/backend';
import { QueryFailedError } from 'typeorm';

import type { CustomerProfileEntity } from '../entities/customer-profile.entity';

import { DatevDebtorAccountService } from './datev-debtor-account.service';
import type { DatevTenantExportConfig } from './datev-export-config.service';

describe('DatevDebtorAccountService', () => {
  const repository = {
    findByTenantAndUserId: jest.fn(),
    findMaxDebtorNumber: jest.fn(),
    create: jest.fn(),
  };
  const billingNotificationPublisher = {
    publishDebtorRangeExhausted: jest.fn(),
  };
  const service = new DatevDebtorAccountService(repository as never, billingNotificationPublisher as never);
  const config: DatevTenantExportConfig = {
    consultantNumber: '1',
    clientNumber: '2',
    chartOfAccounts: 'SKR03',
    accountLength: 4,
    revenueAccountStandard: '8400',
    revenueAccountReduced: '8300',
    revenueAccountReverseCharge: '8336',
    revenueAccountOss: '8400',
    revenueAccountThirdCountry: '8338',
    expenseAccountStandard: '4900',
    expenseAccountReduced: '4800',
    expenseAccountReverseCharge: '4836',
    expenseAccountOss: '4900',
    expenseAccountThirdCountry: '4838',
    debtorAccountStart: 10_000,
    debtorAccountEnd: 10_002,
    creditorAccountStart: 70_000,
    creditorAccountEnd: 99_999,
    buKeyStandard: '',
    buKeyReduced: '',
    buKeyReverseCharge: '',
    buKeyOss: '',
    buKeyThirdCountry: '',
    expenseBuKeyStandard: '',
    expenseBuKeyReduced: '',
    includeDocuments: true,
    includeBankPostings: true,
    dictationAbbr: 'DEC',
    fiscalYearStartMonth: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns existing debtor number idempotently', async () => {
    repository.findByTenantAndUserId.mockResolvedValue({ debtorNumber: 10_001 });

    const number = await service.resolveDebtorNumber('default', 'user-1', config);

    expect(number).toBe(10_001);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('allocates next debtor number when none exists', async () => {
    repository.findByTenantAndUserId.mockResolvedValue(null);
    repository.findMaxDebtorNumber.mockResolvedValue(10_000);
    repository.create.mockResolvedValue({ debtorNumber: 10_001 });

    const number = await service.resolveDebtorNumber('default', 'user-1', config);

    expect(number).toBe(10_001);
    expect(repository.findMaxDebtorNumber).toHaveBeenCalledWith(SHARED_NUMBER_SCOPE);
    expect(repository.create).toHaveBeenCalledWith('default', 'user-1', 10_001, SHARED_NUMBER_SCOPE);
  });

  it('throws and notifies when debtor range is exhausted', async () => {
    repository.findByTenantAndUserId.mockResolvedValue(null);
    repository.findMaxDebtorNumber.mockResolvedValue(10_002);

    await expect(service.resolveDebtorNumber('default', 'user-1', config)).rejects.toThrow(/exhausted/);
    expect(billingNotificationPublisher.publishDebtorRangeExhausted).toHaveBeenCalledWith({
      tenantId: 'default',
      nextCandidate: 10_003,
      rangeStart: 10_000,
      rangeEnd: 10_002,
      allocationScope: SHARED_NUMBER_SCOPE,
    });
  });

  it('formats company name as display name', () => {
    const profile = { company: 'Acme GmbH', userId: 'user-1' } as CustomerProfileEntity;

    expect(service.formatDebtorDisplayName(profile)).toBe('Acme GmbH');
  });

  it('falls back to full name, email, or user id', () => {
    expect(
      service.formatDebtorDisplayName({
        firstName: 'Jane',
        lastName: 'Doe',
        userId: 'user-1',
      } as CustomerProfileEntity),
    ).toBe('Jane Doe');
    expect(
      service.formatDebtorDisplayName({ email: 'jane@example.com', userId: 'user-1' } as CustomerProfileEntity),
    ).toBe('jane@example.com');
    expect(service.formatDebtorDisplayName({ userId: 'user-1' } as CustomerProfileEntity)).toBe('user-1');
  });

  it('allocates first debtor number when scope has none', async () => {
    repository.findByTenantAndUserId.mockResolvedValue(null);
    repository.findMaxDebtorNumber.mockResolvedValue(null);
    repository.create.mockResolvedValue({ debtorNumber: 10_000 });

    const number = await service.resolveDebtorNumber('default', 'user-2', config);

    expect(number).toBe(10_000);
    expect(repository.create).toHaveBeenCalledWith('default', 'user-2', 10_000, SHARED_NUMBER_SCOPE);
  });

  it('retries allocation after a unique-constraint race', async () => {
    repository.findByTenantAndUserId.mockResolvedValue(null);
    repository.findMaxDebtorNumber.mockResolvedValue(10_000);
    repository.create
      .mockRejectedValueOnce(new QueryFailedError('INSERT', [], { code: '23505' } as never))
      .mockResolvedValueOnce({ debtorNumber: 10_001 });

    const number = await service.resolveDebtorNumber('default', 'user-1', config);

    expect(number).toBe(10_001);
    expect(repository.create).toHaveBeenCalledTimes(2);
  });
});
