import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { InvoiceEntity } from '../../entities/invoice.entity';

import { ProjectTimeReportPdfService } from './project-time-report-pdf.service';

jest.mock('fs', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs');

  return {
    ...actualFs,
    promises: {
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn(),
    },
  };
});

describe('ProjectTimeReportPdfService', () => {
  const templateService = { buildHtml: jest.fn().mockReturnValue('<html></html>') };
  const htmlRenderer = { renderHtmlToPdf: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) };
  const service = new ProjectTimeReportPdfService(templateService as never, htmlRenderer as never);
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

  it('generateAndStore writes pdf under storage root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'time-report-'));

    process.env.BILLING_INVOICE_PDF_STORAGE_PATH = root;

    const storageKey = await service.generateAndStore(invoice, viewModel);

    expect(storageKey).toBe('sub-1/inv-1-time-report.pdf');
    expect(fs.promises.mkdir).toHaveBeenCalled();
    expect(fs.promises.writeFile).toHaveBeenCalled();

    delete process.env.BILLING_INVOICE_PDF_STORAGE_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolveAbsolutePath rejects path traversal', () => {
    expect(() => service.resolveAbsolutePath('../escape.pdf')).toThrow('Invalid time report PDF path');
  });

  it('readPdf reads from resolved path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'time-report-read-'));

    process.env.BILLING_INVOICE_PDF_STORAGE_PATH = root;
    (fs.promises.readFile as jest.Mock).mockResolvedValue(Buffer.from('pdf'));

    const buffer = await service.readPdf('sub-1/inv-1-time-report.pdf');

    expect(buffer).toEqual(Buffer.from('pdf'));
    expect(fs.promises.readFile).toHaveBeenCalled();

    delete process.env.BILLING_INVOICE_PDF_STORAGE_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  });
});
