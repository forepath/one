import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';

import { DeliverableDocumentType, DocumentDeliveryChannel } from '../../constants/document-delivery.constants';
import { parseMarkSentAt, shouldNotify, type MarkDocumentSentDto } from '../../dto/document-delivery.dto';
import { BillingEmailPublisher } from '../../email/billing-email.publisher';
import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { mapOfferToSearchDocument } from '../../search/billing-search-document.mapper';
import { BillingSearchIndexService } from '../../search/billing-search-index.service';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { BillingDocumentTermsConfigService } from '../../services/billing-document-terms-config.service';
import { BillingIssuerConfigService } from '../../services/billing-issuer-config.service';
import { CustomerProfilesService } from '../../services/customer-profiles.service';
import { InvoiceTaxContextService } from '../../services/invoice-tax-context.service';
import { TaxCalculationService } from '../../services/tax-calculation.service';
import { PreferredLetterService } from '../../spooler/preferred-letter.service';
import { documentTermsLayerFromFields, toDocumentTermsColumns } from '../../utils/document-terms.utils';
import { resolveManualSentAt } from '../../utils/manual-delivery.util';
import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { OfferLineType } from '../constants/offer-line-type.constants';
import { OfferStatus } from '../constants/offer-status.constants';
import type { AdminOfferDetailResponseDto } from '../dto/offer.dto';
import type { OfferEntity } from '../entities/offer.entity';
import { OfferLineItemsRepository } from '../repositories/offer-line-items.repository';
import { OfferNumberSequencesRepository } from '../repositories/offer-number-sequences.repository';
import { OffersRepository } from '../repositories/offers.repository';
import { mapOfferLineItemToResponse } from '../utils/map-offer-line-items.util';
import {
  assertOfferHasPdf,
  isOfferPastExpiry,
  offerCapabilityFlags,
  offerDeliveryFields,
  offerResponseFlags,
} from '../utils/offer-capabilities.util';
import { mapAdminOfferDocumentTerms } from '../utils/offer-document-terms.util';
import { assertOfferDraftEditable } from '../utils/offer-mutability.util';

import { OfferPdfService } from './offer-pdf.service';
import { SubscriptionOrderPreparationService } from './subscription-order-preparation.service';

@Injectable()
export class OfferArchiveService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly offerLineItemsRepository: OfferLineItemsRepository,
    private readonly offerNumberSequencesRepository: OfferNumberSequencesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly subscriptionOrderPreparationService: SubscriptionOrderPreparationService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
    private readonly offerPdfService: OfferPdfService,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingSearchIndexService: BillingSearchIndexService,
    private readonly auditLog: BillingAuditLogService,
    private readonly documentTermsConfig: BillingDocumentTermsConfigService,
    @Optional() private readonly preferredLetter?: PreferredLetterService,
  ) {}

  /**
   * Finalizes a draft: number, totals, frozen terms and PDF; the customer sees it in their account either way. With
   * `notifyCustomer` (default) the offer is also emailed right away; otherwise it can be emailed later via `send`.
   */
  async archive(
    id: string,
    adminUserId?: string,
    options: { notifyCustomer?: boolean; notifyOnExpiry?: boolean } = {},
  ): Promise<AdminOfferDetailResponseDto> {
    const notifyCustomer = shouldNotify(options.notifyCustomer);
    const offer = await this.offersRepository.findByIdOrThrow(id, true);

    assertOfferDraftEditable(offer);

    const profile = await this.customerProfilesService.getByUserId(offer.userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException('Customer profile must be complete before archiving offer');
    }

    this.billingIssuerConfig.assertConfigured();

    const lines = offer.lineItems ?? (await this.offerLineItemsRepository.findByOfferId(id));

    await this.repreparePlanLines(offer.userId, lines, adminUserId, id);

    const taxContext = await this.invoiceTaxContextService.resolveForUser(offer.userId);
    const totals = this.taxCalculationService.computeLines(
      lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceNet: Number(line.unitPriceNet),
        taxCategory: line.taxCategory,
      })),
      {
        taxTreatment: taxContext.treatment,
        forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
      },
    );

    await Promise.all(
      lines.map((line, index) => {
        const computed = totals.lines[index]!;

        return this.offerLineItemsRepository.update(line.id, {
          description: computed.description,
          quantity: computed.quantity,
          unitPriceNet: computed.unitPriceNet,
          taxCategory: computed.taxCategory,
          taxRate: computed.taxRate,
          lineNet: computed.lineNet,
          lineTax: computed.lineTax,
          lineGross: computed.lineGross,
        });
      }),
    );

    const year = new Date().getFullYear();
    const allocated = await this.offerNumberSequencesRepository.nextOfferNumber(year);
    const archivedAt = new Date();
    const updated = await this.offersRepository.update(id, {
      offerNumber: allocated.number,
      numberScope: allocated.numberScope,
      status: OfferStatus.ARCHIVED,
      archivedAt,
      // Like invoices: always visible to the customer once archived; `sentAt` only records the email.
      sentAt: notifyCustomer ? archivedAt : null,
      sentVia: notifyCustomer ? DocumentDeliveryChannel.EMAIL : null,
      notifyOnExpiry: shouldNotify(options.notifyOnExpiry),
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
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
      // Freeze the terms the customer is offered (draft override, else global default); they carry over to the invoice.
      ...toDocumentTermsColumns(this.documentTermsConfig.resolve(documentTermsLayerFromFields(offer))),
    });
    const refreshedLines = await this.offerLineItemsRepository.findByOfferId(id);
    const pdfStorageKey = await this.offerPdfService.generateAndStore(
      updated,
      refreshedLines,
      this.billingIssuerConfig.getConfig(),
      profile,
    );
    const archived = await this.offersRepository.update(id, { pdfStorageKey });

    await this.auditLog.log({
      process: 'offer.archive',
      level: 'info',
      message: `Archived offer ${allocated.number}`,
      offerId: id,
      userId: offer.userId,
      context: {
        adminUserId,
        offerNumber: allocated.number,
        totalGross: archived.totalGross,
        notifyCustomer,
        notifyOnExpiry: archived.notifyOnExpiry,
      },
    });

    if (notifyCustomer) {
      await this.billingEmailPublisher.publishOfferArchived(archived, pdfStorageKey);
      // Customers who prefer letters also get it posted (in addition to the email).
      await this.preferredLetter?.sendIfPreferred({
        documentType: DeliverableDocumentType.OFFER,
        documentId: id,
        documentNumber: allocated.number,
        userId: archived.userId,
        adminUserId,
      });
    }

    this.billingNotificationPublisher.publishOffer('offer.archived', archived);
    this.billingSearchIndexService.scheduleUpsert('offers', mapOfferToSearchDocument(archived, getRequiredTenantId()));

    return await this.mapDetail(id);
  }

  /** Records that an archived, unsent offer was sent outside Decabill (`sent_via = manual`); nothing is sent. */
  async markSent(id: string, adminUserId?: string, dto?: MarkDocumentSentDto): Promise<AdminOfferDetailResponseDto> {
    const offer = await this.offersRepository.findByIdOrThrow(id);

    if (offer.status !== OfferStatus.ARCHIVED) {
      throw new BadRequestException('Only archived offers can be sent');
    }

    if (offer.sentAt) {
      throw new BadRequestException('Offer has already been sent');
    }

    const sentAt = resolveManualSentAt(parseMarkSentAt(dto), offer.archivedAt);

    if (!(await this.offersRepository.claimSent(id, sentAt, DocumentDeliveryChannel.MANUAL))) {
      throw new BadRequestException('Offer has already been sent or is no longer pending');
    }

    await this.auditLog.log({
      process: 'offer.mark_sent',
      level: 'info',
      message: `Marked offer ${offer.offerNumber ?? id} as sent`,
      offerId: id,
      userId: offer.userId,
      context: { adminUserId, offerNumber: offer.offerNumber, sentAt: sentAt.toISOString() },
    });

    return await this.afterDelivery(id);
  }

  /** Archived, not sent yet and not past its expiry (send / send as letter). */
  assertOfferSendable(offer: OfferEntity): void {
    if (offer.status !== OfferStatus.ARCHIVED) {
      throw new BadRequestException('Only archived offers can be sent');
    }

    if (offer.sentAt) {
      throw new BadRequestException('Offer has already been sent');
    }

    if (isOfferPastExpiry(offer)) {
      throw new BadRequestException('Offer has expired');
    }
  }

  /** Re-indexes a delivered offer and returns its admin detail. */
  async afterDelivery(id: string): Promise<AdminOfferDetailResponseDto> {
    const sent = await this.offersRepository.findByIdOrThrow(id);

    this.billingSearchIndexService.scheduleUpsert('offers', mapOfferToSearchDocument(sent, getRequiredTenantId()));

    return await this.mapDetail(id);
  }

  /** Stored PDF of a non-draft offer, rendered and stored first when missing or unreadable. */
  async getStoredPdfKey(offer: OfferEntity): Promise<string> {
    if (offer.pdfStorageKey && process.env.BILLING_SKIP_FILE_CACHE !== 'true') {
      try {
        await this.offerPdfService.readPdf(offer.pdfStorageKey);

        return offer.pdfStorageKey;
      } catch {
        // Stored file missing or unreadable — regenerate below.
      }
    }

    return await this.ensurePdfStored(offer);
  }

  private async repreparePlanLines(
    userId: string,
    lines: Awaited<ReturnType<OfferLineItemsRepository['findByOfferId']>>,
    adminUserId: string | undefined,
    offerId: string,
  ): Promise<void> {
    for (const line of lines) {
      if (line.lineType !== OfferLineType.PLAN_TEMPLATE || !line.planId) {
        continue;
      }

      const prepared = await this.subscriptionOrderPreparationService.prepareForUser(
        userId,
        {
          planId: line.planId,
          requestedConfig: line.effectiveConfigSnapshot ?? undefined,
          addonIds: line.addonIds ?? undefined,
          addonConfigs: line.addonConfigsSnapshot ?? undefined,
          preferredAlternatives: (line.preferredAlternatives as Record<string, unknown> | undefined) ?? undefined,
          autoBackorder: line.autoBackorder,
          promotionCode: line.promotionCode ?? undefined,
        },
        { throwOnUnavailable: true, lineDescription: line.description },
      );

      await this.offerLineItemsRepository.update(line.id, {
        unitPriceNet: prepared.periodUnitPriceNet,
        pricingSnapshot: prepared.pricingSnapshot,
        planNameSnapshot: prepared.planName,
        availabilityCheckedAt: prepared.availabilityCheckedAt,
        effectiveConfigSnapshot: prepared.effectiveConfig,
        addonConfigsSnapshot: prepared.addonConfigs ?? null,
        addonIds: prepared.addonIds,
      });

      await this.auditLog.log({
        process: 'offer.line.plan_prepared',
        level: 'info',
        message: 'Plan template line re-prepared for offer archive',
        offerId,
        userId,
        context: {
          adminUserId,
          offerId,
          lineId: line.id,
          planId: prepared.plan.id,
          planName: prepared.planName,
          periodTotalPrice: prepared.periodTotalPrice,
        },
      });
    }
  }

  /**
   * PDF of a sent offer. Like invoices (`getPdfBuffer` / `ensurePdfStored`), a missing or unreadable stored
   * file is rendered again from the offer and stored, so every sent offer can be downloaded.
   */
  async getPdfBuffer(offer: OfferEntity): Promise<Buffer> {
    assertOfferHasPdf(offer);

    if (offer.pdfStorageKey && process.env.BILLING_SKIP_FILE_CACHE !== 'true') {
      try {
        return await this.offerPdfService.readPdf(offer.pdfStorageKey);
      } catch {
        // Stored file missing or unreadable — regenerate below.
      }
    }

    const storageKey = await this.ensurePdfStored(offer);

    return await this.offerPdfService.readPdf(storageKey);
  }

  private async ensurePdfStored(offer: OfferEntity): Promise<string> {
    const profile = await this.customerProfilesService.getByUserId(offer.userId);

    if (!profile) {
      throw new NotFoundException('Customer profile required for offer PDF');
    }

    this.billingIssuerConfig.assertConfigured();
    const lines = await this.offerLineItemsRepository.findByOfferId(offer.id);
    const storageKey = await this.offerPdfService.generateAndStore(
      offer,
      lines,
      this.billingIssuerConfig.getConfig(),
      profile,
    );

    await this.offersRepository.update(offer.id, { pdfStorageKey: storageKey });

    return storageKey;
  }

  private async mapDetail(id: string): Promise<AdminOfferDetailResponseDto> {
    const offer = await this.offersRepository.findByIdOrThrow(id, true);
    const user = await this.usersRepository.findByIdForTenant(offer.userId);
    const lines = offer.lineItems ?? (await this.offerLineItemsRepository.findByOfferId(id));

    return {
      id: offer.id,
      userId: offer.userId,
      userEmail: user?.email,
      offerNumber: offer.offerNumber ?? null,
      status: offer.status,
      currency: offer.currency,
      totalGross: Number(offer.totalGross),
      expiresAt: offer.expiresAt?.toISOString() ?? null,
      createdAt: offer.createdAt.toISOString(),
      updatedAt: offer.updatedAt.toISOString(),
      ...offerCapabilityFlags(offer),
      ...offerDeliveryFields(offer),
      ...offerResponseFlags(offer),
      subtotalNet: Number(offer.subtotalNet),
      taxTotal: Number(offer.taxTotal),
      billToOpenPositions: offer.billToOpenPositions,
      lineItems: lines.map((line) => mapOfferLineItemToResponse(line, { includeInternal: true })),
      taxMode: offer.taxMode ?? null,
      taxNote: offer.taxNote ?? null,
      ...mapAdminOfferDocumentTerms(offer, this.documentTermsConfig),
      note: offer.note ?? null,
    };
  }
}
