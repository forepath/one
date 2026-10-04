import type { InvoiceEntity } from '../../entities/invoice.entity';

import { ProjectTimeReportPdfService } from './project-time-report-pdf.service';

describe('ProjectTimeReportPdfService', () => {
  const templateService = { buildHtml: jest.fn().mockReturnValue('<html></html>') };
  const htmlRenderer = { renderHtmlToPdf: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) };
  const fileStorage = {
    writeCustomerTimesheetFile: jest.fn().mockResolvedValue(undefined),
    readCustomerTimesheetFile: jest.fn(),
  };
  const storedFileRegistry = {
    isSigningEnabled: jest.fn().mockReturnValue(false),
    reserve: jest.fn(),
    registerFromBuffer: jest.fn().mockResolvedValue({}),
  };
  const service = new ProjectTimeReportPdfService(
    templateService as never,
    htmlRenderer as never,
    fileStorage as never,
    storedFileRegistry as never,
  );
  const invoice = {
    id: 'inv-1',
    subscriptionId: 'sub-1',
    userId: 'user-1',
  } as InvoiceEntity;
  const viewModel = { title: 'Time report' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renderPdf builds html and renders pdf', async () => {
    const pdf = await service.renderPdf(viewModel);

    expect(templateService.buildHtml).toHaveBeenCalledWith(viewModel);
    expect(htmlRenderer.renderHtmlToPdf).toHaveBeenCalledWith('<html></html>');
    expect(pdf).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('generateAndStore writes pdf via file storage', async () => {
    const storageKey = await service.generateAndStore(invoice, viewModel);

    expect(storageKey).toBe('sub-1/inv-1-time-report.pdf');
    expect(fileStorage.writeCustomerTimesheetFile).toHaveBeenCalledWith(
      'sub-1/inv-1-time-report.pdf',
      expect.any(Buffer),
    );
  });

  it('readPdf reads via file storage', async () => {
    fileStorage.readCustomerTimesheetFile.mockResolvedValue(Buffer.from('pdf'));

    const buffer = await service.readPdf('sub-1/inv-1-time-report.pdf');

    expect(buffer).toEqual(Buffer.from('pdf'));
    expect(fileStorage.readCustomerTimesheetFile).toHaveBeenCalledWith('sub-1/inv-1-time-report.pdf');
  });
});
