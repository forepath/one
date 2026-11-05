import { DatevCreditorAccountService } from './datev-creditor-account.service';
import type { DatevTenantExportConfig } from './datev-export-config.service';

describe('DatevCreditorAccountService', () => {
  const creditorAccountsRepository = {
    findByTenantAndSupplierId: jest.fn(),
    findMaxCreditorNumber: jest.fn(),
    create: jest.fn(),
  };
  const billingNotificationPublisher = {
    publishCreditorRangeExhausted: jest.fn(),
    publishSupplierCreditorAllocated: jest.fn(),
  };

  const service = new DatevCreditorAccountService(
    creditorAccountsRepository as never,
    billingNotificationPublisher as never,
  );

  const config: DatevTenantExportConfig = {
    consultantNumber: '1234567',
    clientNumber: '56789',
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
    debtorAccountEnd: 69_999,
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
    dictationAbbr: 'DEC',
    fiscalYearStartMonth: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns existing creditor number', async () => {
    creditorAccountsRepository.findByTenantAndSupplierId.mockResolvedValue({ creditorNumber: 70_001 });

    const number = await service.resolveCreditorNumber('default', 'supplier-1', config);

    expect(number).toBe(70_001);
  });

  it('publishes exhausted webhook when range is full', async () => {
    creditorAccountsRepository.findByTenantAndSupplierId.mockResolvedValue(null);
    creditorAccountsRepository.findMaxCreditorNumber.mockResolvedValue(99_999);

    await expect(service.resolveCreditorNumber('default', 'supplier-1', config)).rejects.toThrow(
      'Creditor account range exhausted',
    );

    expect(billingNotificationPublisher.publishCreditorRangeExhausted).toHaveBeenCalled();
  });

  it('publishes supplier_creditor.allocated when a new creditor number is allocated', async () => {
    creditorAccountsRepository.findByTenantAndSupplierId.mockResolvedValue(null);
    creditorAccountsRepository.findMaxCreditorNumber.mockResolvedValue(70_004);
    creditorAccountsRepository.create.mockResolvedValue({ creditorNumber: 70_005 });

    const number = await service.resolveCreditorNumber('default', 'supplier-1', config);

    expect(number).toBe(70_005);
    expect(billingNotificationPublisher.publishSupplierCreditorAllocated).toHaveBeenCalledWith({
      tenantId: 'default',
      supplierId: 'supplier-1',
      creditorNumber: 70_005,
    });
  });

  it('does not publish supplier_creditor.allocated for an existing creditor number', async () => {
    creditorAccountsRepository.findByTenantAndSupplierId.mockResolvedValue({ creditorNumber: 70_001 });

    await service.resolveCreditorNumber('default', 'supplier-1', config);

    expect(billingNotificationPublisher.publishSupplierCreditorAllocated).not.toHaveBeenCalled();
  });
});
