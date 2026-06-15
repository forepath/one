import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { InvoiceStatus, OPEN_OVERDUE_INVOICE_STATUSES } from '../constants/invoice-status.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import type { InvoiceDetailResponseDto } from '../dto/invoice-detail-response.dto';
import type { InvoiceResponseDto } from '../dto/invoice-response.dto';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoiceLineItemsRepository } from '../repositories/invoice-line-items.repository';
import { InvoiceVoidDocumentsRepository } from '../repositories/invoice-void-documents.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';

import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { buildCreditNoteNumber } from './e-invoice-document-options';
import { InvoiceEmailService } from './invoice-email.service';
import { InvoiceIssuanceService } from './invoice-issuance.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { resolveInvoicingPeriod } from './invoicing-period.util';
import { resolvePurchaseOrderReference } from './purchase-order-reference.util';
import type { LineItemInput } from './tax-calculation.service';
import { TaxCalculationService } from './tax-calculation.service';

export interface CreateInvoiceDraftParams {
  subscriptionId: string;
  userId: string;
  lineInputs: LineItemInput[];
  currency?: string;
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
  ) {}

  async createAndIssue(params: CreateInvoiceDraftParams): Promise<{ invoiceRefId: string; invoiceNumber?: string }> {
    const draft = await this.createDraft(params);
    const issued = await this.invoiceIssuanceService.issueDraft(draft.id);

    return { invoiceRefId: issued.id, invoiceNumber: issued.invoiceNumber };
  }

  async createDraft(params: CreateInvoiceDraftParams): Promise<InvoiceEntity> {
    const totals = this.taxCalculationService.computeLines(params.lineInputs);
    const invoice = await this.invoicesRepository.create({
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      status: InvoiceStatus.DRAFT,
      currency: params.currency ?? 'EUR',
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
      balanceDue: totals.totalGross,
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

    await this.auditLog.log({
      process: 'invoice.create',
      level: 'info',
      message: 'Created invoice draft',
      invoiceId: invoice.id,
      userId: params.userId,
      context: { subscriptionId: params.subscriptionId, totalGross: totals.totalGross },
    });

    return invoice;
  }

  async voidInvoice(
    invoiceId: string,
    subscriptionId: string,
    adminUserId?: string,
    auditContext?: Record<string, unknown>,
  ): Promise<InvoiceEntity> {
    const invoice = await this.invoicesRepository.findByIdAndSubscriptionId(invoiceId, subscriptionId);

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

    if (!existingVoidDocument) {
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

    return voided;
  }

  async getDetail(invoiceId: string, subscriptionId: string): Promise<InvoiceDetailResponseDto> {
    const invoice = await this.invoicesRepository.findByIdAndSubscriptionId(invoiceId, subscriptionId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const lineItems = await this.invoiceLineItemsRepository.findByInvoiceId(invoiceId);
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

  async getVoidPdfBuffer(invoiceId: string, subscriptionId: string): Promise<Buffer> {
    const invoice = await this.invoicesRepository.findByIdAndSubscriptionId(invoiceId, subscriptionId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

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

  async getPdfBuffer(invoiceId: string, subscriptionId: string): Promise<Buffer> {
    const invoice = await this.invoicesRepository.findByIdAndSubscriptionId(invoiceId, subscriptionId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

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

  private async ensurePdfStored(invoice: InvoiceEntity): Promise<string> {
    const lineItems = await this.invoiceLineItemsRepository.findByInvoiceId(invoice.id);
    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);

    if (!profile) {
      throw new NotFoundException('Customer profile required for invoice PDF');
    }

    this.billingIssuerConfig.assertConfigured();
    const subscription = await this.subscriptionsRepository.findById(invoice.subscriptionId);
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
    const subscription = await this.subscriptionsRepository.findById(invoice.subscriptionId);
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
    'canPay' | 'canDownload' | 'canPreview' | 'canDownloadVoidDocument' | 'voidDocumentNumber'
  > {
    const payable = OPEN_OVERDUE_INVOICE_STATUSES.includes(invoice.status) && Number(invoice.balanceDue) > 0;
    const previewable = invoice.status !== InvoiceStatus.DRAFT;
    const voided = invoice.status === InvoiceStatus.VOID;

    return {
      canPay: payable,
      canDownload: previewable,
      canPreview: previewable,
      canDownloadVoidDocument: voided && Boolean(invoice.invoiceNumber),
      voidDocumentNumber: voided && invoice.invoiceNumber ? buildCreditNoteNumber(invoice.invoiceNumber) : undefined,
    };
  }
}
