import { Injectable } from '@nestjs/common';
import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';

import type { InvoiceEntity } from '../../entities/invoice.entity';
import { InvoicePdfHtmlRendererService } from '../../services/invoice-pdf-html-renderer.service';
import { StoredFileRegistryService } from '../../services/stored-file-registry.service';
import { buildProjectTimeReportStorageKey } from '../../utils/project-time-report-storage.util';

import { ProjectTimeReportPdfTemplateService } from './project-time-report-pdf-template.service';
import type { ProjectTimeReportViewModel } from './project-time-report-pdf-view.model';

@Injectable()
export class ProjectTimeReportPdfService {
  constructor(
    private readonly templateService: ProjectTimeReportPdfTemplateService,
    private readonly htmlRenderer: InvoicePdfHtmlRendererService,
    private readonly fileStorage: FileStorageService,
    private readonly storedFileRegistry: StoredFileRegistryService,
  ) {}

  async renderPdf(viewModel: ProjectTimeReportViewModel): Promise<Uint8Array> {
    const html = this.templateService.buildHtml(viewModel);

    return await this.htmlRenderer.renderHtmlToPdf(html);
  }

  async generateAndStore(invoice: InvoiceEntity, viewModel: ProjectTimeReportViewModel): Promise<string> {
    const pdfBytes = await this.renderPdf(viewModel);
    const storageKey = buildProjectTimeReportStorageKey(invoice);
    const content = Buffer.from(pdfBytes);

    await this.fileStorage.writeCustomerTimesheetFile(storageKey, content);
    await this.storedFileRegistry.registerFromBuffer({
      tenantId: getTenantIdOrDefault(),
      scope: FileStorageScope.customerTimesheets,
      storageKey,
      content,
    });

    return storageKey;
  }

  async readPdf(storageKey: string): Promise<Buffer> {
    return await this.fileStorage.readCustomerTimesheetFile(storageKey);
  }
}
