import { BillingEmailAttachmentResolver } from './billing-email-attachment.resolver';

describe('BillingEmailAttachmentResolver', () => {
  const invoicePdfService = {
    readPdf: jest.fn(),
  };
  const timeReportPdfService = {
    readPdf: jest.fn(),
  };
  const invoicesRepository = {
    existsAuthorizedByPdfOrTimeReportStorageKey: jest.fn(),
  };
  const voidDocumentsRepository = {
    existsAuthorizedByPdfStorageKey: jest.fn(),
  };
  const creditDocumentsRepository = {
    existsAuthorizedByPdfStorageKey: jest.fn(),
  };
  const resolver = new BillingEmailAttachmentResolver(
    invoicePdfService as never,
    timeReportPdfService as never,
    invoicesRepository as never,
    voidDocumentsRepository as never,
    creditDocumentsRepository as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    invoicesRepository.existsAuthorizedByPdfOrTimeReportStorageKey.mockResolvedValue(false);
    voidDocumentsRepository.existsAuthorizedByPdfStorageKey.mockResolvedValue(false);
    creditDocumentsRepository.existsAuthorizedByPdfStorageKey.mockResolvedValue(false);
  });

  it('resolves invoice pdf attachments after tenant authorization', async () => {
    const content = Buffer.from('invoice');

    invoicesRepository.existsAuthorizedByPdfOrTimeReportStorageKey.mockResolvedValue(true);
    invoicePdfService.readPdf.mockResolvedValue(content);

    const result = await resolver.resolve([{ storageKey: 'inv/key.pdf', filename: 'INV-1.pdf' }]);

    expect(invoicesRepository.existsAuthorizedByPdfOrTimeReportStorageKey).toHaveBeenCalledWith('inv/key.pdf');
    expect(invoicePdfService.readPdf).toHaveBeenCalledWith('inv/key.pdf');
    expect(timeReportPdfService.readPdf).not.toHaveBeenCalled();
    expect(result).toEqual([{ filename: 'INV-1.pdf', content }]);
  });

  it('resolves time report attachments via ProjectTimeReportPdfService', async () => {
    const content = Buffer.from('time');

    invoicesRepository.existsAuthorizedByPdfOrTimeReportStorageKey.mockResolvedValue(true);
    timeReportPdfService.readPdf.mockResolvedValue(content);

    const result = await resolver.resolve([{ storageKey: 'time/key.pdf', filename: 'time-report-INV-1.pdf' }]);

    expect(timeReportPdfService.readPdf).toHaveBeenCalledWith('time/key.pdf');
    expect(invoicePdfService.readPdf).not.toHaveBeenCalled();
    expect(result).toEqual([{ filename: 'time-report-INV-1.pdf', content }]);
  });

  it('authorizes void document keys via void repository', async () => {
    voidDocumentsRepository.existsAuthorizedByPdfStorageKey.mockResolvedValue(true);
    invoicePdfService.readPdf.mockResolvedValue(Buffer.from('void'));

    const result = await resolver.resolve([{ storageKey: 'void.pdf', filename: 'CN-1.pdf' }]);

    expect(voidDocumentsRepository.existsAuthorizedByPdfStorageKey).toHaveBeenCalledWith('void.pdf');
    expect(result).toEqual([{ filename: 'CN-1.pdf', content: Buffer.from('void') }]);
  });

  it('authorizes credit document keys via credit repository', async () => {
    creditDocumentsRepository.existsAuthorizedByPdfStorageKey.mockResolvedValue(true);
    invoicePdfService.readPdf.mockResolvedValue(Buffer.from('credit'));

    const result = await resolver.resolve([{ storageKey: 'credit.pdf', filename: 'CN-2.pdf' }]);

    expect(creditDocumentsRepository.existsAuthorizedByPdfStorageKey).toHaveBeenCalledWith('credit.pdf');
    expect(result).toEqual([{ filename: 'CN-2.pdf', content: Buffer.from('credit') }]);
  });

  it('rejects unauthorized storage keys before reading PDFs', async () => {
    await expect(resolver.resolve([{ storageKey: 'evil.pdf', filename: 'INV-1.pdf' }])).rejects.toThrow(
      'Email attachment storage key is not authorized for this tenant',
    );

    expect(invoicePdfService.readPdf).not.toHaveBeenCalled();
    expect(timeReportPdfService.readPdf).not.toHaveBeenCalled();
  });

  it('resolves mixed attachment lists in order', async () => {
    invoicesRepository.existsAuthorizedByPdfOrTimeReportStorageKey.mockResolvedValue(true);
    invoicePdfService.readPdf.mockResolvedValue(Buffer.from('inv'));
    timeReportPdfService.readPdf.mockResolvedValue(Buffer.from('time'));

    const result = await resolver.resolve([
      { storageKey: 'a.pdf', filename: 'INV-1.pdf' },
      { storageKey: 'b.pdf', filename: 'time-report-INV-1.pdf' },
    ]);

    expect(result).toEqual([
      { filename: 'INV-1.pdf', content: Buffer.from('inv') },
      { filename: 'time-report-INV-1.pdf', content: Buffer.from('time') },
    ]);
  });

  describe('offer PDFs', () => {
    const offersRepository = { existsAuthorizedByPdfStorageKey: jest.fn() };
    const offerPdfService = { readPdf: jest.fn() };
    const withOffers = new BillingEmailAttachmentResolver(
      invoicePdfService as never,
      timeReportPdfService as never,
      invoicesRepository as never,
      voidDocumentsRepository as never,
      creditDocumentsRepository as never,
      offersRepository as never,
      offerPdfService as never,
    );

    it('authorizes tenant-scoped offer keys and reads them from the offer storage', async () => {
      offersRepository.existsAuthorizedByPdfStorageKey.mockResolvedValue(true);
      offerPdfService.readPdf.mockResolvedValue(Buffer.from('offer'));

      const result = await withOffers.resolve([{ storageKey: 'user-1/offer.pdf', filename: 'OFF-1.pdf' }]);

      expect(offersRepository.existsAuthorizedByPdfStorageKey).toHaveBeenCalledWith('user-1/offer.pdf');
      expect(offerPdfService.readPdf).toHaveBeenCalledWith('user-1/offer.pdf');
      expect(invoicePdfService.readPdf).not.toHaveBeenCalled();
      expect(result).toEqual([{ filename: 'OFF-1.pdf', content: Buffer.from('offer') }]);
    });

    it('rejects offer keys that are not authorized for the tenant', async () => {
      offersRepository.existsAuthorizedByPdfStorageKey.mockResolvedValue(false);

      await expect(withOffers.resolve([{ storageKey: 'other/offer.pdf', filename: 'OFF-2.pdf' }])).rejects.toThrow(
        'not authorized',
      );
      expect(offerPdfService.readPdf).not.toHaveBeenCalled();
    });

    it('fails closed for offer keys when the offer services are not wired', async () => {
      await expect(resolver.resolve([{ storageKey: 'user-1/offer.pdf', filename: 'OFF-1.pdf' }])).rejects.toThrow(
        'not authorized',
      );
    });
  });
});
