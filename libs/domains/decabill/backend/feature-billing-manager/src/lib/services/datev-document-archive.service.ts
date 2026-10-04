import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { FileStorageService } from '@forepath/shared/backend/util-file-storage';

import { DatevExportScope } from '../constants/datev-export.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

export interface DatevDocumentArchiveEntry {
  relativePath: string;
  invoiceNumber: string;
  documentDate: Date;
}

@Injectable()
export class DatevDocumentArchiveService {
  constructor(private readonly fileStorage: FileStorageService) {}

  buildDocumentXml(entries: DatevDocumentArchiveEntry[]): string {
    const documents = entries
      .map(
        (entry) =>
          `  <document>
    <extension>pdf</extension>
    <file>${this.escapeXml(entry.relativePath)}</file>
    <description>${this.escapeXml(entry.invoiceNumber)}</description>
    <date>${entry.documentDate.toISOString().slice(0, 10)}</date>
  </document>`,
      )
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<archive>\n${documents}\n</archive>\n`;
  }

  buildDocumentRelativePath(scope: DatevExportScope, tenantId: string, fileName: string): string {
    if (scope === DatevExportScope.UNIFIED) {
      return path.posix.join('belege', tenantId, fileName);
    }

    return path.posix.join('belege', fileName);
  }

  buildBeleglink(relativePath: string): string {
    return `BEDI "${relativePath}"`;
  }

  async readInvoicePdf(invoice: InvoiceEntity): Promise<Buffer | null> {
    if (!invoice.pdfStorageKey) {
      return null;
    }

    return await this.readPdfByStorageKey(invoice.pdfStorageKey);
  }

  async readSupplierInvoicePdf(
    invoice: import('../entities/supplier-invoice.entity').SupplierInvoiceEntity,
  ): Promise<Buffer | null> {
    if (!invoice.documentStorageKey) {
      return null;
    }

    try {
      return await this.fileStorage.readSupplierInvoiceFile(invoice.documentStorageKey);
    } catch {
      return null;
    }
  }

  async readPdfByStorageKey(storageKey: string): Promise<Buffer | null> {
    try {
      return await this.fileStorage.readCustomerInvoiceFile(storageKey);
    } catch {
      return null;
    }
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
