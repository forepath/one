import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ACCOUNTING_POSTING_PORT, type AccountingPostingPort } from '../accounting/ports/accounting-posting.port';
import { isAutoPaymentBlocking } from '../constants/auto-payment-status.constants';
import { DeliverableDocumentType, DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { InvoiceStatus, OPEN_OVERDUE_INVOICE_STATUSES } from '../constants/invoice-status.constants';
import { getMinCheckoutPaymentAmount } from '../constants/payment-amount.constants';
import { SettlementDocumentType, SettlementSource, SettlementType } from '../constants/settlement.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import { mapDocumentTermsToResponse } from '../dto/document-terms.dto';
import type { InvoiceDetailResponseDto } from '../dto/invoice-detail-response.dto';
import type { InvoiceResponseDto } from '../dto/invoice-response.dto';
import type { InvoicePromotionApplicationDraft } from '../dto/promotion.dto';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import { InvoiceCreditDocumentEntity } from '../entities/invoice-credit-document.entity';
import { InvoiceEntity } from '../entities/invoice.entity';
import { InventoryArticlesRepository } from '../inventory/repositories/inventory-articles.repository';
import { assertInventoryArticlesExist } from '../inventory/utils/inventory-article-references.util';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { ProjectTimeReportService } from '../projects/services/project-time-report.service';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoiceLineItemsRepository } from '../repositories/invoice-line-items.repository';
import { InvoicePromotionApplicationsRepository } from '../repositories/invoice-promotion-applications.repository';
import { InvoiceVoidDocumentsRepository } from '../repositories/invoice-void-documents.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { mapInvoiceToSearchDocument } from '../search/billing-search-document.mapper';
import { BillingSearchIndexService } from '../search/billing-search-index.service';
import { PreferredLetterService } from '../spooler/preferred-letter.service';
import { CustomerTrustScoreService } from '../trust-score/customer-trust-score.service';
import { normalizeDocumentNote } from '../utils/document-note.utils';
import { resolveManualSentAt } from '../utils/manual-delivery.util';
import { invoiceCountsTowardOssLedger } from '../utils/oss-ledger.util';
import { roundMoney } from '../utils/settlement-state.util';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { DocumentSettlementService } from './document-settlement.service';
import { buildCreditNoteNumber } from './e-invoice-document-options';
import { InvoiceIssuanceService } from './invoice-issuance.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceTaxContextService } from './invoice-tax-context.service';
import { resolveInvoicingPeriod } from './invoicing-period.util';
import { OssThresholdService } from './oss-threshold.service';
import { PromotionApplicationService } from './promotion-application.service';
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
  offerId?: string;
  /** Optional free-text document note (manual invoices, project bill-time); normalized before it is stored. */
  note?: string | null;
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
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
    private readonly auditLog: BillingAuditLogService,
    private readonly projectTimeReportService: ProjectTimeReportService,
    private readonly invoicePromotionApplicationsRepository: InvoicePromotionApplicationsRepository,
    private readonly promotionApplicationService: PromotionApplicationService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly customerTrustScoreService: CustomerTrustScoreService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly ossThresholdService: OssThresholdService,
    private readonly billingSearchIndexService: BillingSearchIndexService,
    private readonly inventoryArticlesRepository: InventoryArticlesRepository,
    private readonly dataSource: DataSource,
    private readonly documentSettlementService: DocumentSettlementService,
    @Optional() @Inject(ACCOUNTING_POSTING_PORT) private readonly postingPort?: AccountingPostingPort,
    @Optional() private readonly preferredLetter?: PreferredLetterService,
  ) {}

  async createAndIssue(params: CreateInvoiceDraftParams): Promise<{ invoiceRefId: string; invoiceNumber?: string }> {
    const draft = await this.createDraft(params);
    const issued = await this.invoiceIssuanceService.issueDraft(draft.id);

    return { invoiceRefId: issued.id, invoiceNumber: issued.invoiceNumber };
  }

  async createDraft(params: CreateInvoiceDraftParams): Promise<InvoiceEntity> {
    await assertInventoryArticlesExist(
      this.inventoryArticlesRepository,
      params.lineInputs.map((line) => line.inventoryArticleId),
    );

    const taxContext = await this.invoiceTaxContextService.resolveForUser(params.userId);
    const totals = this.taxCalculationService.computeLines(params.lineInputs, {
      taxTreatment: taxContext.treatment,
      forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
    });
    const balanceDue = Math.max(0, totals.totalGross);
    const invoice = await this.invoicesRepository.create({
      subscriptionId: params.subscriptionId,
      projectId: params.projectId,
      userId: params.userId,
      offerId: params.offerId,
      status: InvoiceStatus.DRAFT,
      currency: params.currency ?? 'EUR',
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
      balanceDue,
      taxMode: taxContext.treatment.taxMode,
      taxCountryCode: taxContext.treatment.taxCountryCode,
      taxNote: taxContext.treatment.invoiceNote || null,
      einvoiceTaxCategoryCode: taxContext.treatment.einvoiceTaxCategoryCode,
      resolvedTaxRate: totals.resolvedTaxRate ?? null,
      buyerVatId: taxContext.buyerVatId,
      buyerCountry: taxContext.buyerCountry,
      buyerCustomerType: taxContext.buyerCustomerType,
      issuerCountry: taxContext.issuerCountry,
      issuerIsInEu: taxContext.treatment.issuerIsInEu,
      note: normalizeDocumentNote(params.note),
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
        inventoryArticleId: params.lineInputs[index]?.inventoryArticleId ?? null,
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
    this.billingSearchIndexService.scheduleUpsert(
      'invoices',
      mapInvoiceToSearchDocument(invoice, getRequiredTenantId()),
    );

    return invoice;
  }

  async voidInvoice(
    invoiceId: string,
    subscriptionId: string | null | undefined,
    adminUserId?: string,
    auditContext?: Record<string, unknown>,
    options?: { skipNotification?: boolean; note?: string | null },
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

    if (
      invoice.status === InvoiceStatus.PAID ||
      invoice.status === InvoiceStatus.CREDITED ||
      invoice.status === InvoiceStatus.WRITTEN_OFF
    ) {
      throw new BadRequestException(`Cannot void a ${invoice.status.replace('_', ' ')} invoice`);
    }

    if (invoice.status === InvoiceStatus.DRAFT || !invoice.invoiceNumber) {
      throw new BadRequestException('Only issued invoices with an invoice number can be voided');
    }

    const voidedAt = new Date();
    const note = normalizeDocumentNote(options?.note);

    await this.dataSource.transaction(async (manager) => {
      const creditDocuments = await manager.getRepository(InvoiceCreditDocumentEntity).count({ where: { invoiceId } });

      if (creditDocuments > 0) {
        // A full void document would reverse the already credited part a second time.
        throw new BadRequestException(
          'Invoice has partial credit notes; void is not possible. Write off or settle the remaining balance instead.',
        );
      }

      const settlements = await this.documentSettlementService.listForDocument(
        SettlementDocumentType.INVOICE,
        invoiceId,
        manager,
      );
      const sum = (types: SettlementType[]): number =>
        settlements.filter((s) => types.includes(s.type)).reduce((total, s) => total + Number(s.amount), 0);
      const cashNet = roundMoney(
        sum([SettlementType.PAYMENT]) - sum([SettlementType.PAYMENT_REVERSAL, SettlementType.REFUND]),
      );

      if (cashNet > 0.005 || sum([SettlementType.WRITE_OFF, SettlementType.DISCOUNT]) > 0.005) {
        throw new BadRequestException('Invoice has payments or write-offs; reverse them before voiding');
      }

      // Customer credit applied to this invoice goes back to the documents it came from.
      const transferredFrom = new Map<string, number>();

      for (const s of settlements) {
        if (!s.relatedDocumentId) {
          continue;
        }

        const signed =
          s.type === SettlementType.CREDIT_TRANSFER_IN
            ? Number(s.amount)
            : s.type === SettlementType.CREDIT_TRANSFER_OUT
              ? -Number(s.amount)
              : 0;

        transferredFrom.set(s.relatedDocumentId, (transferredFrom.get(s.relatedDocumentId) ?? 0) + signed);
      }

      for (const [sourceId, amount] of transferredFrom) {
        const rounded = roundMoney(amount);

        if (rounded <= 0.005) {
          continue;
        }

        const ref = `void-return:${invoiceId}:${sourceId}`;

        await this.documentSettlementService.apply(
          {
            documentType: SettlementDocumentType.INVOICE,
            documentId: invoiceId,
            type: SettlementType.CREDIT_TRANSFER_OUT,
            amount: rounded,
            occurredAt: voidedAt,
            source: SettlementSource.CUSTOMER_CREDIT,
            sourceRef: ref,
            relatedDocumentId: sourceId,
          },
          manager,
        );
        await this.documentSettlementService.apply(
          {
            documentType: SettlementDocumentType.INVOICE,
            documentId: sourceId,
            type: SettlementType.CREDIT_TRANSFER_IN,
            amount: rounded,
            occurredAt: voidedAt,
            source: SettlementSource.CUSTOMER_CREDIT,
            sourceRef: ref,
            relatedDocumentId: invoiceId,
          },
          manager,
        );
      }

      await manager.getRepository(InvoiceEntity).update(invoiceId, {
        status: InvoiceStatus.VOID,
        voidedAt,
        balanceDue: 0,
      });
      await this.postingPort?.onInvoiceVoided(manager, invoiceId);
    });

    // Credit note document and mail only after the void committed (the guards above may still reject it).
    const existingVoidDocument = await this.invoiceVoidDocumentsRepository.findByInvoiceId(invoiceId);

    if (note && !existingVoidDocument && options?.skipNotification) {
      // The note only lives on the credit note record: store it now instead of lazily on the first download.
      await this.ensureVoidDocumentStored(invoice, voidedAt, note);
    } else if (!options?.skipNotification && !existingVoidDocument) {
      const voidDocumentStorageKey = await this.ensureVoidDocumentStored(invoice, voidedAt, note);
      const emailed = await this.billingEmailPublisher.publishVoidDocument(
        invoice,
        voidDocumentStorageKey,
        buildCreditNoteNumber(invoice.invoiceNumber),
      );

      if (emailed) {
        await this.invoicesRepository.update(invoiceId, {
          voidDocumentSentAt: new Date(),
          voidDocumentSentVia: DocumentDeliveryChannel.EMAIL,
        });
      }

      // Customers who prefer letters also get the credit note posted (in addition to the email).
      await this.preferredLetter?.sendIfPreferred({
        documentType: DeliverableDocumentType.CREDIT_NOTE,
        documentId: invoiceId,
        documentNumber: buildCreditNoteNumber(invoice.invoiceNumber),
        userId: invoice.userId,
        adminUserId,
      });
    }

    const voided = await this.invoicesRepository.findByIdOrThrow(invoiceId);

    if (invoiceCountsTowardOssLedger(invoice) && Number(invoice.subtotalNet) > 0 && invoice.issuedAt) {
      await this.ossThresholdService.reverseCrossBorderB2cNet({
        netAmount: Number(invoice.subtotalNet),
        at: new Date(invoice.issuedAt),
      });
    }

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
        ...(note ? { hasCreditNoteNote: true } : {}),
      },
    });

    this.billingNotificationPublisher.publishInvoice('invoice.voided', voided);
    this.customerTrustScoreService.triggerRecomputeForUser(invoice.userId);

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
    const taxByKey = new Map<string, { taxCategory: TaxCategory; taxRate: number; taxAmount: number }>();

    for (const line of lineItems) {
      const taxCategory = line.taxCategory as TaxCategory;
      const taxRate = Number(line.taxRate);
      const key = `${taxCategory}:${taxRate}`;
      const existing = taxByKey.get(key);

      if (existing) {
        existing.taxAmount = Math.round((existing.taxAmount + Number(line.lineTax)) * 100) / 100;
      } else {
        taxByKey.set(key, {
          taxCategory,
          taxRate,
          taxAmount: Number(line.lineTax),
        });
      }
    }

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
      taxMode: invoice.taxMode ?? undefined,
      taxCountryCode: invoice.taxCountryCode ?? undefined,
      taxNote: invoice.taxNote ?? undefined,
      einvoiceTaxCategoryCode: invoice.einvoiceTaxCategoryCode ?? undefined,
      resolvedTaxRate: invoice.resolvedTaxRate != null ? Number(invoice.resolvedTaxRate) : undefined,
      buyerVatId: invoice.buyerVatId ?? undefined,
      paymentReference: invoice.paymentReference ?? undefined,
      einvoiceFormat: invoice.einvoiceFormat ?? undefined,
      lineItems: lineItems.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceNet: Number(line.unitPriceNet),
        taxCategory: line.taxCategory as TaxCategory,
        taxRate: Number(line.taxRate),
        lineNet: Number(line.lineNet),
        lineTax: Number(line.lineTax),
        lineGross: Number(line.lineGross),
        inventoryArticleId: line.inventoryArticleId ?? null,
      })),
      taxBreakdown: Array.from(taxByKey.values()),
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      ...mapDocumentTermsToResponse(invoice),
      note: invoice.note ?? null,
      paidAt: invoice.paidAt ?? null,
      createdAt: invoice.createdAt,
      autoPaymentStatus: invoice.autoPaymentStatus,
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

  /** Structured e-invoice XML (format snapshotted on the invoice) for customers. */
  async getStructuredEinvoiceForUser(
    invoiceId: string,
    userId: string,
  ): Promise<{ xml: string; format: string; fileName: string }> {
    const invoice = await this.invoicesRepository.findByIdForUser(invoiceId, userId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return await this.getStructuredEinvoice(invoiceId, invoice.subscriptionId);
  }

  async getStructuredEinvoice(
    invoiceId: string,
    subscriptionId?: string | null,
  ): Promise<{ xml: string; format: string; fileName: string }> {
    const invoice = await this.findInvoiceForAccess(invoiceId, subscriptionId);

    if (invoice.status === InvoiceStatus.DRAFT || !invoice.invoiceNumber) {
      throw new BadRequestException('Draft invoices have no e-invoice');
    }

    const lineItems = await this.invoiceLineItemsRepository.findByInvoiceId(invoice.id);
    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);

    if (!profile) {
      throw new NotFoundException('Customer profile required for the e-invoice');
    }

    this.billingIssuerConfig.assertConfigured();

    const subscription = invoice.subscriptionId
      ? await this.subscriptionsRepository.findById(invoice.subscriptionId)
      : null;
    const plan = subscription ? await this.servicePlansRepository.findById(subscription.planId) : null;

    try {
      return this.invoicePdfService.buildStructuredXml(
        invoice,
        lineItems,
        this.billingIssuerConfig.getConfig(),
        profile,
        resolvePurchaseOrderReference(subscription?.number, invoice.subscriptionId),
        resolveInvoicingPeriod(invoice, subscription ?? undefined, plan ?? undefined),
      );
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
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

  /**
   * Records that an issued invoice was sent outside Decabill (e.g. printed and posted by hand): `sent_via = manual`,
   * `sent_at` as given (default now). Nothing is sent to the customer.
   */
  async markInvoiceSent(invoice: InvoiceEntity, sentAt?: Date): Promise<InvoiceEntity> {
    this.assertInvoiceSendable(invoice);

    const at = resolveManualSentAt(sentAt, invoice.issuedAt);

    if (!(await this.invoicesRepository.claimDelivery(invoice.id, 'sentAt', at, DocumentDeliveryChannel.MANUAL))) {
      throw new BadRequestException('Invoice has already been sent');
    }

    return await this.invoicesRepository.findByIdOrThrow(invoice.id);
  }

  /** Records that the credit note of a voided invoice was sent outside Decabill (`sent_via = manual`). */
  async markVoidDocumentSent(invoice: InvoiceEntity, sentAt?: Date): Promise<InvoiceEntity> {
    this.assertCreditNoteSendable(invoice);

    const at = resolveManualSentAt(sentAt, invoice.voidedAt);

    if (
      !(await this.invoicesRepository.claimDelivery(
        invoice.id,
        'voidDocumentSentAt',
        at,
        DocumentDeliveryChannel.MANUAL,
      ))
    ) {
      throw new BadRequestException('Credit note has already been sent');
    }

    return await this.invoicesRepository.findByIdOrThrow(invoice.id);
  }

  /** Issued, numbered, not voided and not sent yet (send, send as letter, mark as sent). */
  assertInvoiceSendable(invoice: InvoiceEntity): void {
    if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.VOID || !invoice.invoiceNumber) {
      throw new BadRequestException('Only issued invoices that are not voided can be sent');
    }

    if (invoice.sentAt) {
      throw new BadRequestException('Invoice has already been sent');
    }
  }

  /** Voided, numbered and its credit note not sent yet. */
  assertCreditNoteSendable(invoice: InvoiceEntity): void {
    if (invoice.status !== InvoiceStatus.VOID || !invoice.invoiceNumber) {
      throw new BadRequestException('Only voided invoices have a credit note to send');
    }

    if (invoice.voidDocumentSentAt) {
      throw new BadRequestException('Credit note has already been sent');
    }
  }

  /** Storage key of the invoice PDF for emailing; rendered and stored first when missing or unreadable. */
  async getStoredPdfKey(invoice: InvoiceEntity): Promise<string> {
    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException('Draft invoices have no PDF');
    }

    if (invoice.pdfStorageKey && !this.shouldSkipFileCache()) {
      try {
        await this.invoicePdfService.readPdf(invoice.pdfStorageKey);

        return invoice.pdfStorageKey;
      } catch {
        // Stored file missing or unreadable — regenerate below.
      }
    }

    return await this.ensurePdfStored(invoice);
  }

  /** Storage key of the credit note of a voided invoice; stored first when it was never rendered (silent void). */
  async getStoredVoidDocumentKey(invoice: InvoiceEntity): Promise<string> {
    if (invoice.status !== InvoiceStatus.VOID) {
      throw new BadRequestException('Only voided invoices have a credit note');
    }

    return await this.ensureVoidDocumentStored(invoice, invoice.voidedAt ?? new Date());
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

  private async ensureVoidDocumentStored(
    invoice: InvoiceEntity,
    voidedAt: Date,
    note?: string | null,
  ): Promise<string> {
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
      // A regenerated credit note keeps the note it was issued with.
      existing ? (existing.note ?? null) : (note ?? null),
    );

    if (!existing) {
      await this.invoiceVoidDocumentsRepository.create({
        invoiceId: invoice.id,
        documentNumber: generated.documentNumber,
        pdfStorageKey: generated.storageKey,
        note: note ?? null,
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
      totalGross: Number(invoice.totalGross),
      subscriptionNumber,
      createdAt: invoice.createdAt,
      issuedAt: invoice.issuedAt ?? null,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt ?? null,
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
    | 'canPay'
    | 'canDownload'
    | 'canPreview'
    | 'canDownloadVoidDocument'
    | 'canDownloadTimeReport'
    | 'voidDocumentNumber'
    | 'autoPaymentStatus'
  > {
    const payable =
      OPEN_OVERDUE_INVOICE_STATUSES.includes(invoice.status) &&
      Number(invoice.balanceDue) >= getMinCheckoutPaymentAmount() &&
      !isAutoPaymentBlocking(invoice.autoPaymentStatus);
    const previewable = invoice.status !== InvoiceStatus.DRAFT;
    const voided = invoice.status === InvoiceStatus.VOID;

    return {
      canPay: payable,
      canDownload: previewable,
      canPreview: previewable,
      canDownloadVoidDocument: voided && Boolean(invoice.invoiceNumber),
      canDownloadTimeReport: previewable && Boolean(invoice.projectId),
      voidDocumentNumber: voided && invoice.invoiceNumber ? buildCreditNoteNumber(invoice.invoiceNumber) : undefined,
      autoPaymentStatus: invoice.autoPaymentStatus,
    };
  }
}
