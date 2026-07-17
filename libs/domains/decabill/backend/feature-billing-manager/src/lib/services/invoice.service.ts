import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { InvoiceStatus, OPEN_OVERDUE_INVOICE_STATUSES } from '../constants/invoice-status.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import type { InvoiceDetailResponseDto } from '../dto/invoice-detail-response.dto';
import type { InvoiceResponseDto } from '../dto/invoice-response.dto';
import type { InvoiceEntity } from '../entities/invoice.entity';
import type { InvoicePromotionApplicationDraft } from '../dto/promotion.dto';
import { InvoicePromotionApplicationsRepository } from '../repositories/invoice-promotion-applications.repository';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoiceLineItemsRepository } from '../repositories/invoice-line-items.repository';
import { InvoiceVoidDocumentsRepository } from '../repositories/invoice-void-documents.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { ProjectTimeReportService } from '../projects/services/project-time-report.service';

import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { buildCreditNoteNumber } from './e-invoice-document-options';
import { InvoiceEmailService } from './invoice-email.service';
import { InvoiceIssuanceService } from './invoice-issuance.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { PromotionApplicationService } from './promotion-application.service';
import { resolveInvoicingPeriod } from './invoicing-period.util';
import { resolvePurchaseOrderReference } from './purchase-order-reference.util';
import type { LineItemInput } from './tax-calculation.service';
import { TaxCalculationService } from './tax-calculation.service';

export interface CreateInvoiceDraftParams {
  subscriptionId?: string;
  projectId?: string;
  userId: string;
  lineInputs: LineItemInput[];
  currency?: string;
  promotionApplications?: InvoicePromotionApplicationDraft[];
}

@Injectable()
export class InvoiceService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly invoiceLineItemsRepository: InvoiceLineItemsRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceIssuanceService: InvoiceIssuanceService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly invoiceVoidDocumentsRepository: InvoiceVoidDocumentsRepository,
    private readonly invoiceEmailService: InvoiceEmailService,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
    private readonly auditLog: BillingAuditLogService,
    private readonly projectTimeReportService: ProjectTimeReportService,
    private readonly invoicePromotionApplicationsRepository: InvoicePromotionApplicationsRepository,
    private readonly promotionApplicationService: PromotionApplicationService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
  ) {}

  async createAndIssue(params: CreateInvoiceDraftParams): Promise<{ invoiceRefId: string; invoiceNumber?: string }> {
    const draft = await this.createDraft(params);
    const issued = await this.invoiceIssuanceService.issueDraft(draft.id);

    return { invoiceRefId: issued.id, invoiceNumber: issued.invoiceNumber };
  }

  async createDraft(params: CreateInvoiceDraftParams): Promise<InvoiceEntity> {
    const totals = this.taxCalculationService.computeLines(params.lineInputs);
    const balanceDue = Math.max(0, totals.totalGross);
    const invoice = await this.invoicesRepository.create({
      subscriptionId: params.subscriptionId,
      projectId: params.projectId,
      userId: params.userId,
      status: InvoiceStatus.DRAFT,
      currency: params.currency ?? 'EUR',
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
      balanceDue,
    });

    await this.invoiceLineItemsRepository.createMany(
      totals.lines.map((line, index) => ({
        invoiceId: invoice.id,
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

    if (params.promotionApplications && params.promotionApplications.length > 0) {
      await this.invoicePromotionApplicationsRepository.createMany(
        params.promotionApplications
          .filter((application) => application.amountAppliedNet > 0 || application.periodsConsumed > 0)
          .map((application) => ({
            invoiceId: invoice.id,
            redemptionId: application.redemptionId,
            amountAppliedNet: application.amountAppliedNet,
            periodsConsumed: application.periodsConsumed,
          })),
      );
    }

    await this.auditLog.log({
      process: 'invoice.create',
      level: 'info',
      message: 'Created invoice draft',
      invoiceId: invoice.id,
      userId: params.userId,
      context: { subscriptionId: params.subscriptionId, totalGross: totals.totalGross },
    });

    this.billingNotificationPublisher.publishInvoice('invoice.created', invoice);

    return invoice;
  }

  async voidInvoice(
    invoiceId: string,
    subscriptionId: string | null | undefined,
    adminUserId?: string,
    auditContext?: Record<string, unknown>,
    options?: { skipNotification?: boolean },
  ): Promise<InvoiceEntity> {
    const invoice =
      subscriptionId != null && subscriptionId !== ''
        ? await this.invoicesRepository.findByIdAndSubscriptionId(invoiceId, subscriptionId)
        : await this.invoicesRepository.findById(invoiceId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status === InvoiceStatus.VOID) {
      return invoice;
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Cannot void a paid invoice');
    }

    if (invoice.status === InvoiceStatus.DRAFT || !invoice.invoiceNumber) {
      throw new BadRequestException('Only issued invoices with an invoice number can be voided');
    }

    const voidedAt = new Date();
    const existingVoidDocument = await this.invoiceVoidDocumentsRepository.findByInvoiceId(invoiceId);

    if (!options?.skipNotification && !existingVoidDocument) {
      const voidDocumentStorageKey = await this.ensureVoidDocumentStored(invoice, voidedAt);

      await this.invoiceEmailService.notifyVoidDocument(
        invoice,
        voidDocumentStorageKey,
        buildCreditNoteNumber(invoice.invoiceNumber),
      );
    }

    const voided = await this.invoicesRepository.update(invoiceId, {
      status: InvoiceStatus.VOID,
      voidedAt,
      balanceDue: 0,
    });

    await this.promotionApplicationService.revertPromotionApplicationsForInvoice(invoiceId);

    await this.auditLog.log({
      process: 'invoice.void',
      level: 'info',
      message: 'Voided invoice',
      invoiceId,
      userId: adminUserId ?? invoice.userId,
      context: {
        ...(auditContext ?? {}),
        ...(adminUserId ? { adminUserId } : {}),
      },
    });

    this.billingNotificationPublisher.publishInvoice('invoice.voided', voided);

    return voided;
  }

  async getDetail(invoiceId: string, subscriptionId: string): Promise<InvoiceDetailResponseDto> {
    const invoice = await this.invoicesRepository.findByIdAndSubscriptionId(invoiceId, subscriptionId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return this.buildDetailResponse(invoice);
  }

  async getDetailForUser(invoiceId: string, userId: string): Promise<InvoiceDetailResponseDto> {
    const invoice = await this.invoicesRepository.findByIdForUser(invoiceId, userId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return this.buildDetailResponse(invoice);
  }

  async getDetailById(invoiceId: string): Promise<InvoiceDetailResponseDto & { userId: string }> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceId);

    return {
      ...(await this.buildDetailResponse(invoice)),
      userId: invoice.userId,
    };
  }

  private async buildDetailResponse(invoice: InvoiceEntity): Promise<InvoiceDetailResponseDto> {
    const lineItems = await this.invoiceLineItemsRepository.findByInvoiceId(invoice.id);
    const totals = this.taxCalculationService.computeLines(
      lineItems.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceNet: Number(line.unitPriceNet),
        taxCategory: line.taxCategory as TaxCategory,
      })),
    );

    return {
      id: invoice.id,
      subscriptionId: invoice.subscriptionId,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      currency: invoice.currency,
      subtotalNet: Number(invoice.subtotalNet),
      taxTotal: Number(invoice.taxTotal),
      totalGross: Number(invoice.totalGross),
      balanceDue: Number(invoice.balanceDue),
      lineItems: lineItems.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceNet: Number(line.unitPriceNet),
        taxCategory: line.taxCategory as TaxCategory,
        taxRate: Number(line.taxRate),
        lineNet: Number(line.lineNet),
        lineTax: Number(line.lineTax),
        lineGross: Number(line.lineGross),
      })),
      taxBreakdown: totals.taxBreakdown,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      createdAt: invoice.createdAt,
      ...this.capabilityFlags(invoice),
    };
  }

  async getVoidPdfBuffer(invoiceId: string, subscriptionId?: string | null): Promise<Buffer> {
    const invoice = await this.findInvoiceForAccess(invoiceId, subscriptionId);

    if (invoice.status !== InvoiceStatus.VOID) {
      throw new BadRequestException('Void document is only available for voided invoices');
    }

    const voidDocument = await this.invoiceVoidDocumentsRepository.findByInvoiceId(invoiceId);

    if (voidDocument?.pdfStorageKey && !this.shouldSkipFileCache()) {
      try {
        return await this.invoicePdfService.readPdf(voidDocument.pdfStorageKey);
      } catch {
        // Stored file missing or unreadable — regenerate below.
      }
    }

    const storageKey = await this.ensureVoidDocumentStored(invoice, invoice.voidedAt ?? new Date());

    return await this.invoicePdfService.readPdf(storageKey);
  }

  async getPdfBuffer(invoiceId: string, subscriptionId?: string | null): Promise<Buffer> {
    const invoice = await this.findInvoiceForAccess(invoiceId, subscriptionId);

    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException('Draft invoices have no PDF');
    }

    if (invoice.pdfStorageKey && !this.shouldSkipFileCache()) {
      try {
        return await this.invoicePdfService.readPdf(invoice.pdfStorageKey);
      } catch {
        // Stored file missing or unreadable — regenerate below.
      }
    }

    const storageKey = await this.ensurePdfStored(invoice);

    return await this.invoicePdfService.readPdf(storageKey);
  }

  async getTimeReportPdfBufferForUser(invoiceId: string, userId: string): Promise<Buffer> {
    const invoice = await this.invoicesRepository.findByIdForUser(invoiceId, userId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return await this.getTimeReportPdfBuffer(invoiceId, invoice.subscriptionId);
  }

  async getTimeReportPdfBuffer(invoiceId: string, subscriptionId?: string | null): Promise<Buffer> {
    const invoice = await this.findInvoiceForAccess(invoiceId, subscriptionId);

    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException('Draft invoices have no time report');
    }

    if (!invoice.timeReportStorageKey && !invoice.projectId) {
      throw new BadRequestException('Time report is not available for this invoice');
    }

    return await this.projectTimeReportService.getPdfBufferForInvoice(invoice);
  }

  async getPdfBufferForUser(invoiceId: string, userId: string): Promise<Buffer> {
    const invoice = await this.invoicesRepository.findByIdForUser(invoiceId, userId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return await this.getPdfBuffer(invoiceId, invoice.subscriptionId);
  }

  async getVoidPdfBufferForUser(invoiceId: string, userId: string): Promise<Buffer> {
    const invoice = await this.invoicesRepository.findByIdForUser(invoiceId, userId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return await this.getVoidPdfBuffer(invoiceId, invoice.subscriptionId);
  }

  private async findInvoiceForAccess(invoiceId: string, subscriptionId?: string | null): Promise<InvoiceEntity> {
    if (subscriptionId) {
      const invoice = await this.invoicesRepository.findByIdAndSubscriptionId(invoiceId, subscriptionId);

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      return invoice;
    }

    return await this.invoicesRepository.findByIdOrThrow(invoiceId);
  }

  private async ensurePdfStored(invoice: InvoiceEntity): Promise<string> {
    const lineItems = await this.invoiceLineItemsRepository.findByInvoiceId(invoice.id);
    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);

    if (!profile) {
      throw new NotFoundException('Customer profile required for invoice PDF');
    }

    this.billingIssuerConfig.assertConfigured();
    const subscription = invoice.subscriptionId
      ? await this.subscriptionsRepository.findById(invoice.subscriptionId)
      : null;
    const plan = subscription ? await this.servicePlansRepository.findById(subscription.planId) : null;
    const storageKey = await this.invoicePdfService.generateAndStore(
      invoice,
      lineItems,
      this.billingIssuerConfig.getConfig(),
      profile,
      resolvePurchaseOrderReference(subscription?.number, invoice.subscriptionId),
      resolveInvoicingPeriod(invoice, subscription ?? undefined, plan ?? undefined),
    );

    await this.invoicesRepository.update(invoice.id, { pdfStorageKey: storageKey });

    return storageKey;
  }

  private async ensureVoidDocumentStored(invoice: InvoiceEntity, voidedAt: Date): Promise<string> {
    const existing = await this.invoiceVoidDocumentsRepository.findByInvoiceId(invoice.id);

    if (existing?.pdfStorageKey && !this.shouldSkipFileCache()) {
      try {
        await this.invoicePdfService.readPdf(existing.pdfStorageKey);

        return existing.pdfStorageKey;
      } catch {
        // Stored file missing — regenerate below.
      }
    }

    const invoiceNumber = invoice.invoiceNumber;

    if (!invoiceNumber) {
      throw new BadRequestException('Invoice number required for void document');
    }

    const lineItems = await this.invoiceLineItemsRepository.findByInvoiceId(invoice.id);
    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);

    if (!profile) {
      throw new NotFoundException('Customer profile required for void document PDF');
    }

    this.billingIssuerConfig.assertConfigured();
    const subscription = invoice.subscriptionId
      ? await this.subscriptionsRepository.findById(invoice.subscriptionId)
      : null;
    const plan = subscription ? await this.servicePlansRepository.findById(subscription.planId) : null;
    const generated = await this.invoicePdfService.generateVoidDocumentAndStore(
      invoice,
      voidedAt,
      lineItems,
      this.billingIssuerConfig.getConfig(),
      profile,
      resolvePurchaseOrderReference(subscription?.number, invoice.subscriptionId),
      resolveInvoicingPeriod(invoice, subscription ?? undefined, plan ?? undefined),
    );

    if (!existing) {
      await this.invoiceVoidDocumentsRepository.create({
        invoiceId: invoice.id,
        documentNumber: generated.documentNumber,
        pdfStorageKey: generated.storageKey,
      });
    }

    return generated.storageKey;
  }

  mapToResponse(invoice: InvoiceEntity, subscriptionNumber?: string): InvoiceResponseDto {
    return {
      id: invoice.id,
      subscriptionId: invoice.subscriptionId,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      balance: Number(invoice.balanceDue),
      subscriptionNumber,
      createdAt: invoice.createdAt,
      dueDate: invoice.dueDate,
      ...this.capabilityFlags(invoice),
    };
  }

  private shouldSkipFileCache(): boolean {
    return process.env.BILLING_SKIP_FILE_CACHE === 'true';
  }

  private capabilityFlags(
    invoice: InvoiceEntity,
  ): Pick<
    InvoiceResponseDto,
    'canPay' | 'canDownload' | 'canPreview' | 'canDownloadVoidDocument' | 'canDownloadTimeReport' | 'voidDocumentNumber'
  > {
    const payable = OPEN_OVERDUE_INVOICE_STATUSES.includes(invoice.status) && Number(invoice.balanceDue) > 0;
    const previewable = invoice.status !== InvoiceStatus.DRAFT;
    const voided = invoice.status === InvoiceStatus.VOID;

    return {
      canPay: payable,
      canDownload: previewable,
      canPreview: previewable,
      canDownloadVoidDocument: voided && Boolean(invoice.invoiceNumber),
      canDownloadTimeReport: previewable && Boolean(invoice.projectId),
      voidDocumentNumber: voided && invoice.invoiceNumber ? buildCreditNoteNumber(invoice.invoiceNumber) : undefined,
    };
  }
}
