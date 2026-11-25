import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { ACCOUNTING_POSTING_PORT, type AccountingPostingPort } from '../accounting/ports/accounting-posting.port';
import { DeliverableDocumentType, DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { isEuMemberState } from '../constants/eu-member-states.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { TaxMode } from '../constants/tax-mode.constants';
import { BillingEmailPublisher } from '../email/billing-email.publisher';
import { InvoiceEntity } from '../entities/invoice.entity';
import { InventoryWithdrawalRequestsService } from '../inventory/services/inventory-withdrawal-requests.service';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoiceLineItemsRepository } from '../repositories/invoice-line-items.repository';
import { InvoiceNumberSequencesRepository } from '../repositories/invoice-number-sequences.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { mapInvoiceToSearchDocument } from '../search/billing-search-document.mapper';
import { BillingSearchIndexService } from '../search/billing-search-index.service';
import { PreferredLetterService } from '../spooler/preferred-letter.service';
import { CustomerTrustScoreService } from '../trust-score/customer-trust-score.service';
import {
  documentTermsLayerFromFields,
  type DocumentTermsLayer,
  toDocumentTermsColumns,
} from '../utils/document-terms.utils';
import { buildInvoicePaymentReference } from '../utils/payment-reference.util';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

import { AutoBillingService } from './auto-billing.service';
import { BillingAuditLogService } from './billing-audit-log.service';
import { BillingDocumentTermsConfigService } from './billing-document-terms-config.service';
import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { DocumentSettlementService } from './document-settlement.service';
import { EInvoiceFormatConfigService } from './e-invoice-format-config.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceTaxContextService } from './invoice-tax-context.service';
import { resolveInvoicingPeriod } from './invoicing-period.util';
import { OssThresholdService } from './oss-threshold.service';
import { resolvePurchaseOrderReference } from './purchase-order-reference.util';

export interface IssueDraftOptions {
  /** Issue without emailing the customer (`sentAt` stays null; the invoice can be sent later). */
  skipNotification?: boolean;
  /**
   * Document-level payment / delivery terms (manual issue dialog, accepted offer). Unset facets inherit from the
   * subscription's service plan, then the global default.
   */
  terms?: DocumentTermsLayer;
}

@Injectable()
export class InvoiceIssuanceService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly invoiceLineItemsRepository: InvoiceLineItemsRepository,
    private readonly invoiceNumberSequencesRepository: InvoiceNumberSequencesRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly auditLog: BillingAuditLogService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly autoBillingService: AutoBillingService,
    private readonly customerTrustScoreService: CustomerTrustScoreService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly ossThresholdService: OssThresholdService,
    private readonly billingSearchIndexService: BillingSearchIndexService,
    private readonly documentTermsConfig: BillingDocumentTermsConfigService,
    private readonly inventoryWithdrawalRequests: InventoryWithdrawalRequestsService,
    private readonly dataSource: DataSource,
    private readonly documentSettlementService: DocumentSettlementService,
    @Optional() @Inject(ACCOUNTING_POSTING_PORT) private readonly postingPort?: AccountingPostingPort,
    @Optional() private readonly einvoiceFormats?: EInvoiceFormatConfigService,
    @Optional() private readonly preferredLetter?: PreferredLetterService,
  ) {}

  async issueDraft(invoiceId: string, options?: IssueDraftOptions): Promise<InvoiceEntity> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceId);

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new Error(`Invoice ${invoiceId} is not a draft`);
    }

    this.billingIssuerConfig.assertConfigured();

    const lineItems = await this.invoiceLineItemsRepository.findByInvoiceId(invoiceId);
    const profile = await this.customerProfilesRepository.findByUserId(invoice.userId);

    if (!profile) {
      throw new Error('Customer profile required before issuing invoice');
    }

    const subscription = invoice.subscriptionId
      ? await this.subscriptionsRepository.findByIdOrThrow(invoice.subscriptionId)
      : null;
    const plan = subscription ? await this.servicePlansRepository.findByIdOrThrow(subscription.planId) : null;
    const terms = this.documentTermsConfig.resolve(
      options?.terms,
      documentTermsLayerFromFields(invoice),
      documentTermsLayerFromFields(plan),
    );
    const issuedAt = new Date();
    const year = issuedAt.getFullYear();
    const dueDate = new Date(issuedAt);

    dueDate.setDate(dueDate.getDate() + terms.paymentDueDays);

    const balanceDue = Math.max(0, Number(invoice.balanceDue));
    const isPromotionalZeroBalance = balanceDue === 0;
    // Number, status, booking and customer-credit settlement commit together: a failure neither burns an
    // invoice number nor leaves an issued invoice without its booking.
    const { updated, invoiceNumber, creditApplied } = await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(InvoiceEntity)
        .createQueryBuilder('inv')
        .where('inv.id = :id', { id: invoiceId })
        .setLock('pessimistic_write')
        .getOne();

      if (!locked || locked.status !== InvoiceStatus.DRAFT) {
        throw new Error(`Invoice ${invoiceId} is not a draft`);
      }

      const allocated = await this.invoiceNumberSequencesRepository.nextInvoiceNumber(year, manager);
      const paymentReference = await this.uniquePaymentReference(manager, allocated, invoiceId);

      await manager.getRepository(InvoiceEntity).update(invoiceId, {
        invoiceNumber: allocated,
        paymentReference,
        einvoiceFormat: this.einvoiceFormats?.resolveForBuyer(profile) ?? null,
        status: isPromotionalZeroBalance ? InvoiceStatus.PAID : InvoiceStatus.ISSUED,
        issuedAt,
        paidAt: isPromotionalZeroBalance ? issuedAt : undefined,
        dueDate: isPromotionalZeroBalance ? undefined : dueDate,
        // Frozen with the document; a promotional zero balance is paid on issue, so it carries no payment terms.
        ...toDocumentTermsColumns(terms),
        ...(isPromotionalZeroBalance ? { paymentDueDays: null } : {}),
        balanceDue,
        paymentProcessor: isPromotionalZeroBalance
          ? undefined
          : (process.env.BILLING_DEFAULT_PAYMENT_PROCESSOR ?? 'stripe'),
      });
      await this.postingPort?.onInvoiceIssued(manager, invoiceId);

      const applied = isPromotionalZeroBalance
        ? 0
        : await this.documentSettlementService.applyAvailableCustomerCredit(invoiceId, manager, issuedAt);
      const reloaded = await manager
        .getRepository(InvoiceEntity)
        .findOneOrFail({ where: { id: invoiceId }, relations: ['subscription'] });

      return { updated: reloaded, invoiceNumber: allocated, creditApplied: applied };
    });
    const pdfStorageKey = await this.invoicePdfService.generateAndStore(
      updated,
      lineItems,
      this.billingIssuerConfig.getConfig(),
      profile,
      resolvePurchaseOrderReference(subscription?.number, subscription?.id),
      resolveInvoicingPeriod(updated, subscription ?? undefined, plan ?? undefined),
    );
    let issued = await this.invoicesRepository.update(invoiceId, { pdfStorageKey });

    await this.auditLog.log({
      process: 'invoice.issue',
      level: 'info',
      message: `Issued invoice ${invoiceNumber}`,
      invoiceId,
      userId: invoice.userId,
      context: { invoiceNumber, totalGross: issued.totalGross, customerCreditApplied: creditApplied },
    });

    if (isPromotionalZeroBalance) {
      await this.auditLog.log({
        process: 'invoice.paid.promotional_zero_balance',
        level: 'info',
        message: `Invoice ${invoiceNumber} marked paid due to promotional zero balance`,
        invoiceId,
        userId: invoice.userId,
        context: { invoiceNumber },
      });
    }

    if (!options?.skipNotification && !isPromotionalZeroBalance) {
      if (await this.billingEmailPublisher.publishInvoiceIssued(issued, pdfStorageKey)) {
        issued = await this.invoicesRepository.update(invoiceId, {
          sentAt: new Date(),
          sentVia: DocumentDeliveryChannel.EMAIL,
        });
      }

      // Customers who prefer letters also get it posted (in addition to the email).
      await this.preferredLetter?.sendIfPreferred({
        documentType: DeliverableDocumentType.INVOICE,
        documentId: invoiceId,
        documentNumber: invoiceNumber,
        userId: invoice.userId,
      });
    }

    this.billingNotificationPublisher.publishInvoice('invoice.issued', issued);

    if (isPromotionalZeroBalance) {
      // Issued directly as paid (promotion covers the full amount).
      this.billingNotificationPublisher.publishInvoice('invoice.paid', issued);
    }

    this.billingSearchIndexService.scheduleUpsert(
      'invoices',
      mapInvoiceToSearchDocument(issued, getRequiredTenantId(), {
        subscriptionNumber: subscription?.number,
      }),
    );

    if (issued.taxMode && issued.taxMode !== TaxMode.DOMESTIC_VAT) {
      this.billingNotificationPublisher.publish(
        'invoice.tax_mode_applied',
        {
          invoiceId: issued.id,
          userId: issued.userId,
          taxMode: issued.taxMode,
          taxCountryCode: issued.taxCountryCode ?? null,
          buyerCountry: issued.buyerCountry ?? null,
        },
        issued.userId,
      );
    }

    const taxContext = await this.invoiceTaxContextService.resolveForUser(invoice.userId);

    if (taxContext.countsTowardOssLedger && isEuMemberState(issued.buyerCountry) && Number(issued.subtotalNet) > 0) {
      await this.ossThresholdService.recordCrossBorderB2cNet({
        netAmount: Number(issued.subtotalNet),
      });
    }

    if (!isPromotionalZeroBalance && Number(issued.balanceDue) > 0) {
      await this.autoBillingService.scheduleIfEligible(issued);
    }

    if (creditApplied > 0 && Number(issued.balanceDue) <= 0) {
      this.billingNotificationPublisher.publishInvoice('invoice.credited', issued);
    }

    this.customerTrustScoreService.triggerRecomputeForUser(invoice.userId);

    // Article positions request their withdrawal (accepted separately in the inventory; never moves stock here).
    await this.inventoryWithdrawalRequests.raiseForInvoiceLines(issued, lineItems);

    return issued;
  }

  /** RF reference not used by another invoice yet (the column is globally unique; a clash must not block issuing). */
  private async uniquePaymentReference(
    manager: EntityManager,
    invoiceNumber: string,
    invoiceId: string,
  ): Promise<string> {
    for (let variant = 0; variant < 4; variant += 1) {
      const candidate = buildInvoicePaymentReference(invoiceNumber, invoiceId, variant);
      const taken = await manager
        .getRepository(InvoiceEntity)
        .createQueryBuilder('inv')
        .where('inv.paymentReference = :candidate', { candidate })
        .andWhere('inv.id <> :invoiceId', { invoiceId })
        .getCount();

      if (taken === 0) {
        return candidate;
      }
    }

    throw new Error(`No free payment reference for invoice ${invoiceId}`);
  }
}
