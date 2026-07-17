import { BillingEmailAttachmentResolver } from './billing-email-attachment.resolver';

describe('BillingEmailAttachmentResolver', () => {
  const invoicePdfService = {
    readPdf: jest.fn(),
  };
  const timeReportPdfService = {
    readPdf: jest.fn(),
  };

  const resolver = new BillingEmailAttachmentResolver(invoicePdfService as never, timeReportPdfService as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves invoice pdf attachments via InvoicePdfService', async () => {
    const content = Buffer.from('invoice');
    invoicePdfService.readPdf.mockResolvedValue(content);

    const result = await resolver.resolve([{ storageKey: 'inv/key.pdf', filename: 'INV-1.pdf' }]);

    expect(invoicePdfService.readPdf).toHaveBeenCalledWith('inv/key.pdf');
    expect(timeReportPdfService.readPdf).not.toHaveBeenCalled();
    expect(result).toEqual([{ filename: 'INV-1.pdf', content }]);
  });

  it('resolves time report attachments via ProjectTimeReportPdfService', async () => {
    const content = Buffer.from('time');
    timeReportPdfService.readPdf.mockResolvedValue(content);

    const result = await resolver.resolve([{ storageKey: 'time/key.pdf', filename: 'time-report-INV-1.pdf' }]);

    expect(timeReportPdfService.readPdf).toHaveBeenCalledWith('time/key.pdf');
    expect(invoicePdfService.readPdf).not.toHaveBeenCalled();
    expect(result).toEqual([{ filename: 'time-report-INV-1.pdf', content }]);
  });

  it('resolves mixed attachment lists in order', async () => {
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
});
