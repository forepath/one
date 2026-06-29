import { BadRequestException, Injectable } from '@nestjs/common';

import type { InvoiceEntity } from '../../entities/invoice.entity';
import { BillingIssuerConfigService } from '../../services/billing-issuer-config.service';
import type { ProjectEntity } from '../entities/project.entity';
import type { ProjectTimeEntryEntity } from '../entities/project-time-entry.entity';
import type { ProjectTimeReportRequestDto } from '../dto/project.dto';
import { ProjectTicketsRepository } from '../repositories/project-tickets.repository';
import { ProjectTimeEntriesRepository } from '../repositories/project-time-entries.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import { resolveProjectBillTimeRange } from '../utils/project-bill-time-range.utils';
import {
  formatProjectTimeReportDuration,
  formatProjectTimeReportPeriod,
  formatProjectTimeReportRange,
} from '../utils/project-time-report-format.util';

import { ProjectTimeReportPdfService } from './project-time-report-pdf.service';
import type { ProjectTimeReportEntryView, ProjectTimeReportViewModel } from './project-time-report-pdf-view.model';

@Injectable()
export class ProjectTimeReportService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly timeEntriesRepository: ProjectTimeEntriesRepository,
    private readonly ticketsRepository: ProjectTicketsRepository,
    private readonly timeReportPdfService: ProjectTimeReportPdfService,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
  ) {}

  async generateLivePdf(projectId: string, dto: ProjectTimeReportRequestDto): Promise<Buffer> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const { from, to } = resolveProjectBillTimeRange(new Date(dto.from), new Date(dto.to));
    const entries = await this.timeEntriesRepository.findByProjectInRange(projectId, from, to, {
      unbilledOnly: dto.unbilledOnly === true,
    });
    const viewModel = await this.buildViewModel(project, entries, from, to);

    return Buffer.from(await this.timeReportPdfService.renderPdf(viewModel));
  }

  async generateAndStoreForBilling(
    invoice: InvoiceEntity,
    project: ProjectEntity,
    entries: ProjectTimeEntryEntity[],
    from: Date,
    to: Date,
  ): Promise<string> {
    const viewModel = await this.buildViewModel(project, entries, from, to, invoice.invoiceNumber ?? undefined);

    return await this.timeReportPdfService.generateAndStore(invoice, viewModel);
  }

  async getPdfBufferForInvoice(invoice: InvoiceEntity): Promise<Buffer> {
    if (!invoice.projectId) {
      throw new BadRequestException('Time report is only available for project invoices');
    }

    if (invoice.timeReportStorageKey && process.env.BILLING_SKIP_FILE_CACHE !== 'true') {
      try {
        return await this.timeReportPdfService.readPdf(invoice.timeReportStorageKey);
      } catch {
        // Stored file missing — regenerate below.
      }
    }

    const project = await this.projectsRepository.findByIdOrThrow(invoice.projectId);
    const viewModel = await this.buildViewModelForInvoice(invoice, project);
    const pdfBytes = await this.timeReportPdfService.renderPdf(viewModel);

    if (invoice.timeReportStorageKey) {
      await this.timeReportPdfService.generateAndStore(invoice, viewModel);
    }

    return Buffer.from(pdfBytes);
  }

  async buildViewModelForInvoice(invoice: InvoiceEntity, project: ProjectEntity): Promise<ProjectTimeReportViewModel> {
    const entries = await this.timeEntriesRepository.findByInvoiceId(invoice.id);

    if (entries.length === 0) {
      throw new BadRequestException('No billed time entries linked to this invoice');
    }

    const from = entries.reduce((min, entry) => (entry.startedAt < min ? entry.startedAt : min), entries[0].startedAt);
    const to = entries.reduce((max, entry) => (entry.endedAt > max ? entry.endedAt : max), entries[0].endedAt);

    return await this.buildViewModel(project, entries, from, to, invoice.invoiceNumber ?? undefined);
  }

  private async buildViewModel(
    project: ProjectEntity,
    entries: ProjectTimeEntryEntity[],
    from: Date,
    to: Date,
    invoiceNumber?: string,
  ): Promise<ProjectTimeReportViewModel> {
    const ticketTitles = await this.ticketsRepository.findTitlesByIds(
      entries.map((entry) => entry.ticketId).filter((ticketId): ticketId is string => Boolean(ticketId)),
    );
    const totalMinutes = entries.reduce((sum, entry) => sum + entry.durationMinutes, 0);

    return {
      title: 'Time report',
      companyName: this.billingIssuerConfig.getConfig().name,
      projectName: project.name,
      rangeLabel: formatProjectTimeReportRange(from, to),
      invoiceNumber,
      entries: entries.map((entry) => this.mapEntry(entry, ticketTitles)),
      totalDuration: formatProjectTimeReportDuration(totalMinutes),
    };
  }

  private mapEntry(entry: ProjectTimeEntryEntity, ticketTitles: Map<string, string>): ProjectTimeReportEntryView {
    const description = entry.description?.trim();

    return {
      period: formatProjectTimeReportPeriod(entry.startedAt, entry.endedAt),
      duration: formatProjectTimeReportDuration(entry.durationMinutes),
      description: description || '—',
      ticket: entry.ticketId ? (ticketTitles.get(entry.ticketId) ?? '—') : '—',
      billingStatus: entry.billedAt ? 'Billed' : 'Unbilled',
    };
  }
}
