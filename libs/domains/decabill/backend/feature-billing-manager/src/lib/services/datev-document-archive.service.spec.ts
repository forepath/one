import * as fs from 'fs';

import { DatevExportScope } from '../constants/datev-export.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { DatevDocumentArchiveService } from './datev-document-archive.service';

describe('DatevDocumentArchiveService', () => {
  const invoicePdfService = {
    resolveAbsolutePath: jest.fn(),
  };
  const service = new DatevDocumentArchiveService(invoicePdfService as never);

  it('builds document.xml with escaped content', () => {
    const xml = service.buildDocumentXml([
      {
        relativePath: 'belege/INV-2026-00001.pdf',
        invoiceNumber: 'INV-2026-00001',
        documentDate: new Date('2026-01-15T00:00:00Z'),
      },
    ]);

    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<file>belege/INV-2026-00001.pdf</file>');
    expect(xml).toContain('<description>INV-2026-00001</description>');
  });

  it('builds tenant-prefixed paths for unified exports', () => {
    expect(service.buildDocumentRelativePath(DatevExportScope.UNIFIED, 'acme', 'INV-1.pdf')).toBe(
      'belege/acme/INV-1.pdf',
    );
  });

  it('builds flat belege path for tenant exports', () => {
    expect(service.buildDocumentRelativePath(DatevExportScope.TENANT, 'default', 'INV-1.pdf')).toBe('belege/INV-1.pdf');
  });

  it('builds Beleglink in DATEV format', () => {
    expect(service.buildBeleglink('belege/INV-1.pdf')).toBe('BEDI "belege/INV-1.pdf"');
  });

  it('escapes xml special characters in document metadata', () => {
    const xml = service.buildDocumentXml([
      {
        relativePath: 'belege/"INV"&<1>.pdf',
        invoiceNumber: 'INV & <1>',
        documentDate: new Date('2026-01-15T00:00:00Z'),
      },
    ]);

    expect(xml).toContain('&quot;INV&quot;&amp;&lt;1&gt;');
    expect(xml).toContain('INV &amp; &lt;1&gt;');
  });

  it('returns null when invoice has no pdf storage key', async () => {
    await expect(service.readInvoicePdf({ pdfStorageKey: null } as InvoiceEntity)).resolves.toBeNull();
    expect(invoicePdfService.resolveAbsolutePath).not.toHaveBeenCalled();
  });

  it('reads invoice pdf from storage', async () => {
    const readFile = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('pdf'));
    invoicePdfService.resolveAbsolutePath.mockReturnValue('/tmp/invoice.pdf');

    await expect(service.readInvoicePdf({ pdfStorageKey: 'invoice.pdf' } as InvoiceEntity)).resolves.toEqual(
      Buffer.from('pdf'),
    );
    expect(readFile).toHaveBeenCalledWith('/tmp/invoice.pdf');

    readFile.mockRestore();
  });

  it('returns null when invoice pdf cannot be read', async () => {
    const readFile = jest.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('missing'));
    invoicePdfService.resolveAbsolutePath.mockReturnValue('/tmp/missing.pdf');

    await expect(service.readInvoicePdf({ pdfStorageKey: 'missing.pdf' } as InvoiceEntity)).resolves.toBeNull();

    readFile.mockRestore();
  });

  it('reads pdf by storage key', async () => {
    const readFile = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('archive'));
    invoicePdfService.resolveAbsolutePath.mockReturnValue('/tmp/archive.pdf');

    await expect(service.readPdfByStorageKey('archive.pdf')).resolves.toEqual(Buffer.from('archive'));

    readFile.mockRestore();
  });
});
