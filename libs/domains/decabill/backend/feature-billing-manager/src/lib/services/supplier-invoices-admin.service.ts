import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { randomUUID } from 'crypto';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SupplierDocumentSource } from '../constants/supplier-document-source.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import { EinvoiceTaxCategoryCode, TaxMode } from '../constants/tax-mode.constants';
import type {
  CreateSupplierInvoiceDto,
  IssueSupplierInvoiceDto,
  MarkSupplierInvoicePaymentStatusDto,
  PaginatedSupplierInvoicesResponseDto,
  SupplierExpenseStatisticsResponseDto,
  SupplierInvoiceDetailResponseDto,
  UpdateSupplierInvoiceDto,
} from '../dto/supplier-invoice.dto';
import type { SupplierInvoiceEntity } from '../entities/supplier-invoice.entity';
import type { SupplierInvoiceLineItemEntity } from '../entities/supplier-invoice-line-item.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { SupplierInvoiceLineItemsRepository } from '../repositories/supplier-invoice-line-items.repository';
import { SupplierInvoiceNumberSequencesRepository } from '../repositories/supplier-invoice-number-sequences.repository';
import { SupplierInvoicesRepository } from '../repositories/supplier-invoices.repository';
import { SupplierProfilesRepository } from '../repositories/supplier-profiles.repository';
import { mapSupplierInvoiceLineItemsToInputs } from '../utils/map-supplier-invoice-line-items.util';
import { fillMeterHistoryPeriodSeries } from '../utils/meter-history-date.util';
import { resolvePaymentReceivedAt } from '../utils/resolve-payment-received-at.util';
import { assertSupplierInvoiceDraftEditable } from '../utils/supplier-invoice-mutability.util';
import { buildSupplierInvoicePdfStorageKey } from '../utils/supplier-invoice-pdf-storage.util';

import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { SupplierContractsService } from './supplier-contracts.service';
import { StoredFileRegistryService } from './stored-file-registry.service';
import { SupplierInvoicePdfService } from './supplier-invoice-pdf.service';
import { SupplierProfilesService } from './supplier-profiles.service';
import { TaxCalculationService } from './tax-calculation.service';

const MARK_PAID_ALLOWED: InvoiceStatus[] = [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE];

const ALLOWED_SUPPLIER_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/xml',
  'text/xml',
  'application/octet-stream',
]);

const MAX_SUPPLIER_DOCUMENT_BYTES = 15 * 1024 * 1024;

/** Multipart upload shape used by Nest FileInterceptor (avoids Express.Multer typing in unit tests). */
export type UploadedSupplierDocument = {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
  size?: number;
};

@Injectable()
export class SupplierInvoicesAdminService {
  constructor(
    private readonly supplierInvoicesRepository: SupplierInvoicesRepository,
    private readonly supplierInvoiceLineItemsRepository: SupplierInvoiceLineItemsRepository,
    private readonly supplierProfilesRepository: SupplierProfilesRepository,
    private readonly supplierProfilesService: SupplierProfilesService,
    private readonly supplierContractsService: SupplierContractsService,
    private readonly supplierInvoiceNumberSequencesRepository: SupplierInvoiceNumberSequencesRepository,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly billingIssuerConfigService: BillingIssuerConfigService,
    private readonly supplierInvoicePdfService: SupplierInvoicePdfService,
    private readonly fileStorage: FileStorageService,
    private readonly auditLog: BillingAuditLogService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly storedFileRegistry: StoredFileRegistryService,
  ) {}

  async list(params: {
    supplierId?: string;
    status?: InvoiceStatus;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<PaginatedSupplierInvoicesResponseDto> {
    const { items, total } = await this.supplierInvoicesRepository.findAll(params);

    return {
      items: await Promise.all(items.map((invoice) => this.mapDetail(invoice))),
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async getById(id: string): Promise<SupplierInvoiceDetailResponseDto> {
    return await this.mapDetail(await this.supplierInvoicesRepository.findByIdOrThrow(id));
  }

  async getStatistics(params: {
    from: Date;
    to: Date;
    groupBy: 'day' | 'month';
    supplierId?: string;
  }): Promise<SupplierExpenseStatisticsResponseDto> {
    const [totals, breakdown, sparseSeries] = await Promise.all([
      this.supplierInvoicesRepository.sumExpenseTotals(),
      this.supplierInvoicesRepository.summaryStats(),
      this.supplierInvoicesRepository.sumExpenseGrossByPeriod(
        params.from,
        params.to,
        params.groupBy,
        params.supplierId,
      ),
    ]);
    const from = params.from.toISOString().slice(0, 10);
    const to = params.to.toISOString().slice(0, 10);
    const series = fillMeterHistoryPeriodSeries(sparseSeries, from, to, params.groupBy, (period) => ({
      period,
      totalGross: 0,
    }));

    return {
      totalGross: totals.totalGross,
      invoiceCount: totals.count,
      openCount: breakdown.openCount,
      openGross: breakdown.openGross,
      paidCount: breakdown.paidCount,
      paidGross: breakdown.paidGross,
      draftCount: breakdown.draftCount,
      series,
      from,
      to,
      groupBy: params.groupBy,
    };
  }

  async createDraft(
    dto: CreateSupplierInvoiceDto,
    adminUserId: string,
    document?: UploadedSupplierDocument,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    const supplier = await this.supplierProfilesRepository.findByIdOrThrow(dto.supplierId);
    const contractId = await this.resolveContractId(dto.supplierId, dto.contractNumber);
    const invoiceNumber = await this.resolveManualInvoiceNumber(dto.invoiceNumber);
    const totals = this.computeTotals(dto.lineItems, supplier.country);
    const draft = await this.supplierInvoicesRepository.create({
      supplierId: dto.supplierId,
      contractId,
      invoiceNumber,
      status: InvoiceStatus.DRAFT,
      currency: dto.currency ?? 'EUR',
      issueDate: dto.issueDate ?? null,
      dueDate: dto.dueDate ?? null,
      ...totals,
      supplierVatId: supplier.vatId ?? null,
      supplierCountry: supplier.country ?? null,
      supplierCustomerType: supplier.customerType ?? null,
      recipientCountry: this.billingIssuerConfigService.getConfig().country,
      recipientIsInEu: true,
      hasUploadedDocument: false,
    });

    await this.persistLineItems(draft.id, totals.lines);

    if (document) {
      await this.storeUploadedDocument(draft.id, document, adminUserId);
    }

    await this.auditLog.log({
      process: 'supplier_invoice.create',
      level: 'info',
      message: 'Admin created supplier invoice draft',
      context: { supplierInvoiceId: draft.id, supplierId: dto.supplierId, adminUserId },
    });

    this.billingNotificationPublisher.publishSupplierInvoiceCreated({
      invoiceId: draft.id,
      supplierId: dto.supplierId,
    });

    return await this.getById(draft.id);
  }

  async updateDraft(
    id: string,
    dto: UpdateSupplierInvoiceDto,
    adminUserId: string,
    document?: UploadedSupplierDocument,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    const invoice = await this.supplierInvoicesRepository.findByIdOrThrow(id);

    assertSupplierInvoiceDraftEditable(invoice);

    const supplier = await this.supplierProfilesRepository.findByIdOrThrow(invoice.supplierId);
    const contractId =
      dto.contractNumber === undefined
        ? invoice.contractId
        : dto.contractNumber
          ? (await this.supplierContractsService.getOrCreateByNumber(invoice.supplierId, dto.contractNumber)).id
          : null;
    const totals = this.computeTotals(dto.lineItems, supplier.country);
    const invoiceNumber =
      dto.invoiceNumber === undefined
        ? invoice.invoiceNumber
        : await this.resolveManualInvoiceNumber(dto.invoiceNumber, id);

    await this.supplierInvoiceLineItemsRepository.deleteByInvoiceId(id);
    await this.persistLineItems(id, totals.lines);

    await this.supplierInvoicesRepository.update(id, {
      contractId,
      invoiceNumber,
      issueDate: dto.issueDate === undefined ? invoice.issueDate : dto.issueDate,
      dueDate: dto.dueDate === undefined ? invoice.dueDate : dto.dueDate,
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
      balanceDue: totals.totalGross,
      taxMode: totals.taxMode,
      taxCountryCode: totals.taxCountryCode,
      resolvedTaxRate: totals.resolvedTaxRate,
    });

    if (document) {
      await this.storeUploadedDocument(id, document, adminUserId);
    }

    await this.auditLog.log({
      process: 'supplier_invoice.update',
      level: 'info',
      message: 'Admin updated supplier invoice draft',
      context: { supplierInvoiceId: id, adminUserId },
    });

    return await this.getById(id);
  }

  async deleteDraft(id: string, adminUserId: string): Promise<void> {
    const invoice = await this.supplierInvoicesRepository.findByIdOrThrow(id);

    assertSupplierInvoiceDraftEditable(invoice);

    await this.supplierInvoiceLineItemsRepository.deleteByInvoiceId(id);
    await this.supplierInvoicesRepository.delete(id);

    await this.auditLog.log({
      process: 'supplier_invoice.delete',
      level: 'info',
      message: 'Admin deleted supplier invoice draft',
      context: { supplierInvoiceId: id, adminUserId },
    });
  }

  async issue(
    id: string,
    adminUserId: string,
    dto?: IssueSupplierInvoiceDto,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    const invoice = await this.supplierInvoicesRepository.findByIdOrThrow(id);

    assertSupplierInvoiceDraftEditable(invoice);

    const lineItems = invoice.lineItems ?? [];
    const issueDate = dto?.issueDate ?? invoice.issueDate;
    const dueDate = dto?.dueDate ?? invoice.dueDate;

    if (!issueDate || !dueDate || lineItems.length === 0) {
      throw new BadRequestException('Issue date, due date, and line items are required to issue');
    }

    const supplier = await this.supplierProfilesRepository.findByIdOrThrow(invoice.supplierId);
    const invoiceNumber = await this.resolveIssueInvoiceNumber(invoice, dto, issueDate);
    const issuedAt = new Date();

    let documentStorageKey = invoice.documentStorageKey;
    let documentSource = invoice.documentSource;
    let hasUploadedDocument = invoice.hasUploadedDocument;

    if (!hasUploadedDocument || !documentStorageKey) {
      this.billingIssuerConfigService.assertConfigured();
      documentStorageKey = await this.supplierInvoicePdfService.generateAndStore(
        { ...invoice, invoiceNumber, issueDate, dueDate, issuedAt },
        lineItems,
        supplier,
        this.billingIssuerConfigService.getConfig(),
      );
      documentSource = SupplierDocumentSource.GENERATED;
      hasUploadedDocument = false;
    }

    const updated = await this.supplierInvoicesRepository.update(id, {
      invoiceNumber,
      status: InvoiceStatus.ISSUED,
      issueDate,
      dueDate,
      issuedAt,
      balanceDue: Number(invoice.totalGross),
      documentStorageKey,
      documentSource,
      hasUploadedDocument,
    });

    await this.auditLog.log({
      process: 'supplier_invoice.issue',
      level: 'info',
      message: 'Admin issued supplier invoice',
      context: { supplierInvoiceId: id, invoiceNumber, adminUserId },
    });

    this.billingNotificationPublisher.publishSupplierInvoiceIssued({
      invoiceId: updated.id,
      supplierId: updated.supplierId,
      invoiceNumber,
    });

    return await this.mapDetail(updated);
  }

  async void(id: string, adminUserId: string): Promise<SupplierInvoiceDetailResponseDto> {
    const invoice = await this.supplierInvoicesRepository.findByIdOrThrow(id);

    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException('Supplier invoice is already void');
    }

    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException('Draft supplier invoices cannot be voided; delete instead');
    }

    const voidedAt = new Date();
    const updated = await this.supplierInvoicesRepository.update(id, {
      status: InvoiceStatus.VOID,
      voidedAt,
      balanceDue: 0,
    });

    await this.auditLog.log({
      process: 'supplier_invoice.void',
      level: 'info',
      message: 'Admin voided supplier invoice',
      context: { supplierInvoiceId: id, adminUserId },
    });

    this.billingNotificationPublisher.publishSupplierInvoiceVoided({
      invoiceId: updated.id,
      supplierId: updated.supplierId,
      invoiceNumber: updated.invoiceNumber,
    });

    return await this.mapDetail(updated);
  }

  async markPaid(
    id: string,
    adminUserId: string,
    dto?: MarkSupplierInvoicePaymentStatusDto,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    const invoice = await this.supplierInvoicesRepository.findByIdOrThrow(id);

    if (!MARK_PAID_ALLOWED.includes(invoice.status)) {
      throw new BadRequestException(`Cannot mark supplier invoice as paid from status ${invoice.status}`);
    }

    const paidAt = resolvePaymentReceivedAt(dto?.paidAt);
    const updated = await this.supplierInvoicesRepository.update(id, {
      status: InvoiceStatus.PAID,
      balanceDue: 0,
      paidAt,
    });

    await this.auditLog.log({
      process: 'supplier_invoice.mark_paid',
      level: 'info',
      message: 'Admin marked supplier invoice as paid',
      context: { supplierInvoiceId: id, reason: dto?.reason, paidAt: paidAt.toISOString(), adminUserId },
    });

    this.billingNotificationPublisher.publishSupplierInvoicePaid({
      invoiceId: updated.id,
      supplierId: updated.supplierId,
    });

    return await this.mapDetail(updated);
  }

  async markUnpaid(
    id: string,
    adminUserId: string,
    dto?: MarkSupplierInvoicePaymentStatusDto,
  ): Promise<SupplierInvoiceDetailResponseDto> {
    const invoice = await this.supplierInvoicesRepository.findByIdOrThrow(id);

    if (invoice.status !== InvoiceStatus.PAID) {
      throw new BadRequestException('Can only mark unpaid from paid status');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;

    if (dueDate) {
      dueDate.setHours(0, 0, 0, 0);
    }

    const newStatus = dueDate && dueDate < today ? InvoiceStatus.OVERDUE : InvoiceStatus.ISSUED;
    const updated = await this.supplierInvoicesRepository.update(id, {
      status: newStatus,
      balanceDue: Number(invoice.totalGross),
      paidAt: null,
    });

    await this.auditLog.log({
      process: 'supplier_invoice.mark_unpaid',
      level: 'info',
      message: 'Admin marked supplier invoice as unpaid',
      context: { supplierInvoiceId: id, reason: dto?.reason, adminUserId },
    });

    this.billingNotificationPublisher.publishSupplierInvoiceUnpaid({
      invoiceId: updated.id,
      supplierId: updated.supplierId,
    });

    return await this.mapDetail(updated);
  }

  async downloadDocument(id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const invoice = await this.supplierInvoicesRepository.findByIdOrThrow(id);

    if (!invoice.documentStorageKey) {
      throw new NotFoundException('Supplier invoice document not found');
    }

    // Regenerated PDFs previously used lifecycle issuedAt as the printed issue date.
    // Rebuild generated documents on download so the calendar issueDate is shown.
    if (invoice.documentSource === SupplierDocumentSource.GENERATED && invoice.status !== InvoiceStatus.DRAFT) {
      const supplier = await this.supplierProfilesRepository.findByIdOrThrow(invoice.supplierId);

      this.billingIssuerConfigService.assertConfigured();
      await this.supplierInvoicePdfService.generateAndStore(
        invoice,
        invoice.lineItems ?? [],
        supplier,
        this.billingIssuerConfigService.getConfig(),
      );
    }

    const buffer = await this.supplierInvoicePdfService.readPdf(invoice.documentStorageKey);
    const fileName = buildSupplierInvoicePdfStorageKey(invoice, '.pdf');

    return { buffer, fileName };
  }

  private async storeUploadedDocument(
    invoiceId: string,
    document: UploadedSupplierDocument,
    adminUserId: string,
  ): Promise<void> {
    this.assertValidUploadedDocument(document);
    const storageKey = `${randomUUID()}${this.extensionForMime(document.mimetype)}`;

    await this.fileStorage.writeSupplierInvoiceFile(storageKey, document.buffer);
    await this.storedFileRegistry.registerFromBuffer({
      tenantId: getTenantIdOrDefault(),
      scope: FileStorageScope.supplierInvoices,
      storageKey,
      content: document.buffer,
    });

    await this.supplierInvoicesRepository.update(invoiceId, {
      documentStorageKey: storageKey,
      documentSource: SupplierDocumentSource.UPLOADED,
      hasUploadedDocument: true,
    });

    await this.auditLog.log({
      process: 'supplier_invoice.document_upload',
      level: 'info',
      message: 'Admin uploaded supplier invoice document',
      context: { supplierInvoiceId: invoiceId, adminUserId, mimeType: document.mimetype },
    });

    this.billingNotificationPublisher.publishSupplierInvoiceDocumentUploaded({
      invoiceId,
    });
  }

  private assertValidUploadedDocument(document: UploadedSupplierDocument): void {
    const size = document.size ?? document.buffer?.length ?? 0;

    if (!document.buffer?.length || size <= 0) {
      throw new BadRequestException('Document file is required');
    }

    if (size > MAX_SUPPLIER_DOCUMENT_BYTES) {
      throw new BadRequestException('Document exceeds maximum allowed size');
    }

    const mime = (document.mimetype ?? '').toLowerCase();

    if (!ALLOWED_SUPPLIER_DOCUMENT_MIME_TYPES.has(mime) && !mime.includes('pdf') && !mime.includes('xml')) {
      throw new BadRequestException('Unsupported document type');
    }
  }

  private extensionForMime(mimeType: string): string {
    if (mimeType.includes('pdf')) {
      return '.pdf';
    }

    if (mimeType.includes('xml')) {
      return '.xml';
    }

    return '.bin';
  }

  private async resolveManualInvoiceNumber(
    value: string | null | undefined,
    excludeId?: string,
  ): Promise<string | null> {
    if (value == null) {
      return null;
    }

    const invoiceNumber = value.trim();

    if (!invoiceNumber) {
      return null;
    }

    if (invoiceNumber.length > 64) {
      throw new BadRequestException('Invoice number must be at most 64 characters');
    }

    await this.assertInvoiceNumberAvailable(invoiceNumber, excludeId);

    return invoiceNumber;
  }

  private async resolveIssueInvoiceNumber(
    invoice: SupplierInvoiceEntity,
    dto: IssueSupplierInvoiceDto | undefined,
    issueDate: string,
  ): Promise<string> {
    const candidate = dto?.invoiceNumber !== undefined ? dto.invoiceNumber : invoice.invoiceNumber;
    const manual = await this.resolveManualInvoiceNumber(candidate ?? null, invoice.id);

    if (manual) {
      return manual;
    }

    const year = new Date(issueDate).getUTCFullYear();

    return await this.supplierInvoiceNumberSequencesRepository.nextInvoiceNumber(year);
  }

  private async assertInvoiceNumberAvailable(invoiceNumber: string, excludeId?: string): Promise<void> {
    const existingId = await this.supplierInvoicesRepository.findIdByInvoiceNumber(invoiceNumber, excludeId);

    if (existingId) {
      throw new BadRequestException('Invoice number is already in use');
    }
  }

  private async resolveContractId(supplierId: string, contractNumber?: string): Promise<string | null> {
    if (!contractNumber?.trim()) {
      return null;
    }

    const contract = await this.supplierContractsService.getOrCreateByNumber(supplierId, contractNumber);

    return contract.id;
  }

  private computeTotals(
    lineItems: CreateSupplierInvoiceDto['lineItems'],
    supplierCountry?: string,
  ): {
    subtotalNet: number;
    taxTotal: number;
    totalGross: number;
    balanceDue: number;
    taxMode: TaxMode;
    taxCountryCode: string | null;
    resolvedTaxRate?: number;
    lines: ReturnType<TaxCalculationService['computeLines']>['lines'];
  } {
    for (const line of lineItems) {
      if (line.taxCategory === TaxCategory.CUSTOM && (line.taxRate == null || !Number.isFinite(line.taxRate))) {
        throw new BadRequestException('Custom VAT lines require an explicit tax rate');
      }
    }

    const totals = this.taxCalculationService.computeLines(mapSupplierInvoiceLineItemsToInputs(lineItems), {
      taxTreatment: {
        taxMode: TaxMode.DOMESTIC_VAT,
        taxCountryCode: supplierCountry ?? 'DE',
        chargeVat: true,
        issuerIsInEu: true,
        invoiceNoteKey: 'domestic_vat',
        invoiceNote: '',
        einvoiceTaxCategoryCode: EinvoiceTaxCategoryCode.STANDARD,
      },
    });

    return {
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
      balanceDue: totals.totalGross,
      taxMode: totals.taxTreatment?.taxMode ?? TaxMode.DOMESTIC_VAT,
      taxCountryCode: totals.taxTreatment?.taxCountryCode ?? supplierCountry ?? null,
      resolvedTaxRate: totals.resolvedTaxRate,
      lines: totals.lines,
    };
  }

  private async persistLineItems(
    invoiceId: string,
    lines: ReturnType<TaxCalculationService['computeLines']>['lines'],
  ): Promise<void> {
    await this.supplierInvoiceLineItemsRepository.createMany(
      lines.map((line, index) => ({
        invoiceId,
        position: index,
        description: line.description,
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet,
        taxCategory: line.taxCategory,
        taxRate: line.taxRate,
        lineNet: line.lineNet,
        lineTax: line.lineTax,
        lineGross: line.lineGross,
      })),
    );
  }

  private async mapDetail(invoice: SupplierInvoiceEntity): Promise<SupplierInvoiceDetailResponseDto> {
    const full =
      invoice.lineItems && invoice.supplier
        ? invoice
        : await this.supplierInvoicesRepository.findByIdOrThrow(invoice.id);
    const supplier = full.supplier;
    const supplierName =
      supplier?.company?.trim() ||
      [supplier?.firstName, supplier?.lastName].filter(Boolean).join(' ').trim() ||
      undefined;

    return {
      id: full.id,
      supplierId: full.supplierId,
      supplierNumber: supplier?.supplierNumber,
      supplierName,
      contractId: full.contractId ?? null,
      contractNumber: full.contract?.contractNumber ?? null,
      invoiceNumber: full.invoiceNumber,
      status: full.status,
      currency: full.currency,
      subtotalNet: Number(full.subtotalNet),
      taxTotal: Number(full.taxTotal),
      totalGross: Number(full.totalGross),
      balanceDue: Number(full.balanceDue),
      taxMode: full.taxMode ?? null,
      taxCountryCode: full.taxCountryCode ?? null,
      taxNote: full.taxNote ?? null,
      issueDate: full.issueDate ?? null,
      dueDate: full.dueDate ?? null,
      issuedAt: full.issuedAt ?? null,
      voidedAt: full.voidedAt ?? null,
      paidAt: full.paidAt ?? null,
      documentSource: full.documentSource ?? null,
      hasUploadedDocument: full.hasUploadedDocument,
      canDownload: this.canDownloadDocument(full),
      canPreview: full.status !== InvoiceStatus.DRAFT,
      lineItems: (full.lineItems ?? []).map((line) => this.mapLineItem(line)),
      createdAt: full.createdAt,
    };
  }

  private canDownloadDocument(invoice: SupplierInvoiceEntity): boolean {
    if (!invoice.documentStorageKey) {
      return false;
    }

    if (invoice.hasUploadedDocument) {
      return true;
    }

    return invoice.status !== InvoiceStatus.DRAFT;
  }

  private mapLineItem(line: SupplierInvoiceLineItemEntity) {
    return {
      id: line.id,
      position: line.position,
      description: line.description,
      quantity: Number(line.quantity),
      unitPriceNet: Number(line.unitPriceNet),
      taxCategory: line.taxCategory,
      taxRate: Number(line.taxRate),
      lineNet: Number(line.lineNet),
      lineTax: Number(line.lineTax),
      lineGross: Number(line.lineGross),
    };
  }
}
