import { ZipArchive } from 'archiver';
import { PassThrough } from 'stream';

import { DEFAULT_TENANT, runWithTenantId } from '@forepath/shared/backend';
import { Injectable, Logger } from '@nestjs/common';

import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';
import type { DatevExportEntity } from '../entities/datev-export.entity';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { DatevExportRepository } from '../repositories/datev-export.repository';
import { InvoiceVoidDocumentsRepository } from '../repositories/invoice-void-documents.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { buildDatevExportFileName, buildDatevStorageKey, formatDatevHeaderDate } from '../utils/datev-format.util';
import { DatevBookingMapperService } from './datev-booking-mapper.service';
import { DatevDebtorAccountService } from './datev-debtor-account.service';
import { DatevDebtorMapperService } from './datev-debtor-mapper.service';
import { DatevDocumentArchiveService } from './datev-document-archive.service';
import type { DatevTenantExportConfig } from './datev-export-config.service';
import { DatevExportConfigService } from './datev-export-config.service';
import { DatevExportStorageService } from './datev-export-storage.service';
import { DatevExtfCsvService } from './datev-extf-csv.service';
import { BillingTenantService } from './billing-tenant.service';

export interface DatevExportRunParams {
  scope: DatevExportScope;
  tenantId: string;
  year: number;
  month: number;
  periodStart: Date;
  periodEnd: Date;
  triggeredBy: string;
  force?: boolean;
}

export interface DatevZipEntry {
  name: string;
  content: Buffer;
}

interface TaggedInvoice {
  invoice: InvoiceEntity;
  tenantId: string;
  isVoid: boolean;
}

@Injectable()
export class DatevExportService {
  private readonly logger = new Logger(DatevExportService.name);

  constructor(
    private readonly configService: DatevExportConfigService,
    private readonly billingTenantService: BillingTenantService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly voidDocumentsRepository: InvoiceVoidDocumentsRepository,
    private readonly exportRepository: DatevExportRepository,
    private readonly storageService: DatevExportStorageService,
    private readonly bookingMapper: DatevBookingMapperService,
    private readonly debtorMapper: DatevDebtorMapperService,
    private readonly debtorAccountService: DatevDebtorAccountService,
    private readonly extfCsvService: DatevExtfCsvService,
    private readonly documentArchiveService: DatevDocumentArchiveService,
  ) {}

  async runExport(params: DatevExportRunParams): Promise<DatevExportEntity> {
    if (!this.configService.isEnabled()) {
      throw new Error('DATEV export is disabled');
    }

    const storageOwnerTenantId = params.scope === DatevExportScope.UNIFIED ? DEFAULT_TENANT : params.tenantId;
    const existing = await this.exportRepository.findByPeriod(
      params.scope,
      storageOwnerTenantId,
      params.year,
      params.month,
    );

    if (existing?.status === DatevExportStatus.COMPLETED && !params.force) {
      return existing;
    }

    const exportRecord =
      existing ??
      (await this.exportRepository.create({
        scope: params.scope,
        tenantId: storageOwnerTenantId,
        periodYear: params.year,
        periodMonth: params.month,
        status: DatevExportStatus.PENDING,
        triggeredBy: params.triggeredBy,
      }));

    await this.exportRepository.update(exportRecord.id, {
      status: DatevExportStatus.RUNNING,
      startedAt: new Date(),
      errorMessage: undefined,
    });

    try {
      const result = await this.buildExportBundle(params);
      const fileName = buildDatevExportFileName(params.scope, params.year, params.month);
      const storageKey = buildDatevStorageKey(params.scope, storageOwnerTenantId, params.year, params.month, fileName);
      const zipBuffer = await this.createZipBuffer(result.zipEntries);

      await this.storageService.writeFile(storageKey, zipBuffer);

      const updated = await this.exportRepository.update(exportRecord.id, {
        status: DatevExportStatus.COMPLETED,
        storageKey,
        fileName,
        bookingCount: result.bookingCount,
        invoiceCount: result.invoiceCount,
        debtorCount: result.debtorCount,
        includedTenantIds: result.includedTenantIds,
        completedAt: new Date(),
      });

      return updated ?? exportRecord;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'DATEV export failed';

      this.logger.error(`DATEV export failed for ${params.scope} ${params.year}-${params.month}: ${message}`);

      const failed = await this.exportRepository.update(exportRecord.id, {
        status: DatevExportStatus.FAILED,
        errorMessage: message,
        completedAt: new Date(),
      });

      return failed ?? exportRecord;
    }
  }

  private async buildExportBundle(params: DatevExportRunParams): Promise<{
    zipEntries: DatevZipEntry[];
    bookingCount: number;
    invoiceCount: number;
    debtorCount: number;
    includedTenantIds: string[];
  }> {
    if (params.scope === DatevExportScope.TENANT) {
      return await runWithTenantId(params.tenantId, () => this.buildTenantBundle(params));
    }

    return await this.buildUnifiedBundle(params);
  }

  private async buildTenantBundle(params: DatevExportRunParams): Promise<{
    zipEntries: DatevZipEntry[];
    bookingCount: number;
    invoiceCount: number;
    debtorCount: number;
    includedTenantIds: string[];
  }> {
    const config = this.configService.resolveForTenant(params.tenantId);

    if (!config) {
      throw new Error(`DATEV configuration incomplete for tenant ${params.tenantId}`);
    }

    const issued = await this.invoicesRepository.findIssuedInPeriod(params.periodStart, params.periodEnd);
    const voided = await this.invoicesRepository.findVoidedInPeriod(params.periodStart, params.periodEnd);

    return await this.composeBundle({
      scope: DatevExportScope.TENANT,
      tenantId: params.tenantId,
      config,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      taggedInvoices: [
        ...issued.map((invoice) => ({ invoice, tenantId: params.tenantId, isVoid: false as const })),
        ...voided.map((invoice) => ({ invoice, tenantId: params.tenantId, isVoid: true as const })),
      ],
      includedTenantIds: [params.tenantId],
    });
  }

  private async buildUnifiedBundle(params: DatevExportRunParams): Promise<{
    zipEntries: DatevZipEntry[];
    bookingCount: number;
    invoiceCount: number;
    debtorCount: number;
    includedTenantIds: string[];
  }> {
    const config = this.configService.resolveUnified() ?? this.configService.resolveForTenant(DEFAULT_TENANT);

    if (!config) {
      throw new Error('DATEV unified export configuration is incomplete');
    }

    const tenantIds = [...this.billingTenantService.getConfiguredTenants()];
    const taggedInvoices: TaggedInvoice[] = [];

    for (const tenantId of tenantIds) {
      await runWithTenantId(tenantId, async () => {
        const issuedBatch = await this.invoicesRepository.findIssuedInPeriod(params.periodStart, params.periodEnd);
        const voidedBatch = await this.invoicesRepository.findVoidedInPeriod(params.periodStart, params.periodEnd);

        for (const invoice of issuedBatch) {
          taggedInvoices.push({ invoice, tenantId, isVoid: false });
        }

        for (const invoice of voidedBatch) {
          taggedInvoices.push({ invoice, tenantId, isVoid: true });
        }
      });
    }

    return await this.composeBundle({
      scope: DatevExportScope.UNIFIED,
      tenantId: DEFAULT_TENANT,
      config,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      taggedInvoices,
      includedTenantIds: tenantIds,
    });
  }

  private async composeBundle(input: {
    scope: DatevExportScope;
    tenantId: string;
    config: DatevTenantExportConfig;
    periodStart: Date;
    periodEnd: Date;
    taggedInvoices: TaggedInvoice[];
    includedTenantIds: string[];
  }): Promise<{
    zipEntries: DatevZipEntry[];
    bookingCount: number;
    invoiceCount: number;
    debtorCount: number;
    includedTenantIds: string[];
  }> {
    const bookingRows: string[][] = [];
    const debtorRows: string[][] = [];
    const debtorNumbers = new Map<string, number>();
    const zipEntries: DatevZipEntry[] = [];
    const documentEntries: { relativePath: string; invoiceNumber: string; documentDate: Date }[] = [];
    const invoiceIds = new Set<string>();
    const missingProfileInvoiceIds: string[] = [];

    for (const tagged of input.taggedInvoices) {
      const { invoice, tenantId: invoiceTenantId, isVoid } = tagged;

      await runWithTenantId(invoiceTenantId, async () => {
        const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);

        if (!profile) {
          missingProfileInvoiceIds.push(invoice.id);
          this.logger.warn(`Skipping invoice ${invoice.id} — customer profile missing`);

          return;
        }

        const tenantConfig =
          input.scope === DatevExportScope.UNIFIED
            ? (this.configService.resolveForTenant(invoiceTenantId) ?? input.config)
            : input.config;

        const debtorKey = `${invoiceTenantId}:${invoice.userId}`;
        let debtorNumber = debtorNumbers.get(debtorKey);

        if (debtorNumber == null) {
          debtorNumber = await this.debtorAccountService.resolveDebtorNumber(
            invoiceTenantId,
            invoice.userId,
            tenantConfig,
          );
          debtorNumbers.set(debtorKey, debtorNumber);
          debtorRows.push(this.debtorMapper.mapDebtorRow(profile, debtorNumber));
        }

        for (const line of invoice.lineItems ?? []) {
          const pdfFileName = isVoid
            ? `${invoice.invoiceNumber ?? invoice.id}-void.pdf`
            : `${invoice.invoiceNumber ?? invoice.id}.pdf`;
          const relativePath = this.documentArchiveService.buildDocumentRelativePath(
            input.scope,
            invoiceTenantId,
            pdfFileName,
          );
          const documentLink = tenantConfig.includeDocuments
            ? this.documentArchiveService.buildBeleglink(relativePath)
            : undefined;

          if (isVoid) {
            bookingRows.push(
              this.bookingMapper.mapVoidedLineItem({
                line,
                invoice,
                debtorAccount: debtorNumber,
                config: tenantConfig,
                scope: input.scope,
                tenantSlug: input.scope === DatevExportScope.UNIFIED ? invoiceTenantId : undefined,
                voidedAt: invoice.voidedAt ?? new Date(),
                documentLink,
              }),
            );
          } else {
            bookingRows.push(
              this.bookingMapper.mapIssuedLineItem({
                line,
                invoice,
                debtorAccount: debtorNumber,
                config: tenantConfig,
                scope: input.scope,
                tenantSlug: input.scope === DatevExportScope.UNIFIED ? invoiceTenantId : undefined,
                documentLink,
              }),
            );
          }

          if (tenantConfig.includeDocuments) {
            const pdfBuffer = isVoid
              ? await this.readVoidPdf(invoice)
              : await this.documentArchiveService.readInvoicePdf(invoice);

            if (pdfBuffer) {
              zipEntries.push({ name: relativePath, content: pdfBuffer });
              documentEntries.push({
                relativePath,
                invoiceNumber: invoice.invoiceNumber ?? invoice.id,
                documentDate: isVoid ? (invoice.voidedAt ?? new Date()) : (invoice.issuedAt ?? invoice.createdAt),
              });
            }
          }
        }

        invoiceIds.add(invoice.id);
      });
    }

    if (missingProfileInvoiceIds.length > 0) {
      throw new Error(`Customer profile missing for invoice(s): ${missingProfileInvoiceIds.join(', ')}`);
    }

    const batchLabel = `${input.periodStart.getUTCFullYear()}-${String(input.periodStart.getUTCMonth() + 1).padStart(2, '0')}`;
    const bookingCsv = this.extfCsvService.buildBookingBatchCsv({
      config: input.config,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      batchLabel,
      bookingRows,
    });

    zipEntries.unshift({
      name: `EXTF_Buchungsstapel_${formatDatevHeaderDate(input.periodStart)}_${formatDatevHeaderDate(input.periodEnd)}.csv`,
      content: bookingCsv,
    });

    if (debtorRows.length > 0) {
      zipEntries.splice(1, 0, {
        name: `EXTF_Debitoren_${formatDatevHeaderDate(input.periodStart)}_${formatDatevHeaderDate(input.periodEnd)}.csv`,
        content: this.extfCsvService.buildDebtorBatchCsv({
          config: input.config,
          debtorRows,
        }),
      });
    }

    if (input.config.includeDocuments && documentEntries.length > 0) {
      zipEntries.push({
        name: 'document.xml',
        content: Buffer.from(this.documentArchiveService.buildDocumentXml(documentEntries), 'utf8'),
      });
    }

    return {
      zipEntries,
      bookingCount: bookingRows.length,
      invoiceCount: invoiceIds.size,
      debtorCount: debtorRows.length,
      includedTenantIds: input.includedTenantIds,
    };
  }

  private async readVoidPdf(invoice: InvoiceEntity): Promise<Buffer | null> {
    const voidDocument = await this.voidDocumentsRepository.findByInvoiceId(invoice.id);

    if (voidDocument?.pdfStorageKey) {
      return await this.documentArchiveService.readPdfByStorageKey(voidDocument.pdfStorageKey);
    }

    return await this.documentArchiveService.readInvoicePdf(invoice);
  }

  private async createZipBuffer(entries: DatevZipEntry[]): Promise<Buffer> {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    const done = new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(stream);

    for (const entry of entries) {
      archive.append(entry.content, { name: entry.name });
    }

    await archive.finalize();

    return await done;
  }
}
