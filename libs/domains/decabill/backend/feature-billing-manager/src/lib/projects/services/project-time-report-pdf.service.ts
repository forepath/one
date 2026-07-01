import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';

import type { InvoiceEntity } from '../../entities/invoice.entity';
import { InvoicePdfHtmlRendererService } from '../../services/invoice-pdf-html-renderer.service';
import { buildProjectTimeReportStorageKey } from '../../utils/project-time-report-storage.util';

import { ProjectTimeReportPdfTemplateService } from './project-time-report-pdf-template.service';
import type { ProjectTimeReportViewModel } from './project-time-report-pdf-view.model';

@Injectable()
export class ProjectTimeReportPdfService {
  constructor(
    private readonly templateService: ProjectTimeReportPdfTemplateService,
    private readonly htmlRenderer: InvoicePdfHtmlRendererService,
  ) {}

  getStorageRoot(): string {
    return process.env.BILLING_INVOICE_PDF_STORAGE_PATH ?? path.join(process.cwd(), 'data', 'invoices');
  }

  resolveAbsolutePath(storageKey: string): string {
    const root = path.resolve(this.getStorageRoot());
    const absolute = path.resolve(root, storageKey);

    if (!absolute.startsWith(root + path.sep) && absolute !== root) {
      throw new Error('Invalid time report PDF path');
    }

    return absolute;
  }

  async renderPdf(viewModel: ProjectTimeReportViewModel): Promise<Uint8Array> {
    const html = this.templateService.buildHtml(viewModel);

    return await this.htmlRenderer.renderHtmlToPdf(html);
  }

  async generateAndStore(invoice: InvoiceEntity, viewModel: ProjectTimeReportViewModel): Promise<string> {
    const pdfBytes = await this.renderPdf(viewModel);
    const storageKey = buildProjectTimeReportStorageKey(invoice);
    const absolute = this.resolveAbsolutePath(storageKey);

    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.writeFile(absolute, pdfBytes);

    return storageKey;
  }

  async readPdf(storageKey: string): Promise<Buffer> {
    const absolute = this.resolveAbsolutePath(storageKey);

    return await fs.promises.readFile(absolute);
  }
}
