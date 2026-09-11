import { BadRequestException, Injectable } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import { OfferLineType } from '../constants/offer-line-type.constants';
import type { AdminOfferDetailResponseDto } from '../dto/offer.dto';
import { OfferLineItemsRepository } from '../repositories/offer-line-items.repository';
import { OfferNumberSequencesRepository } from '../repositories/offer-number-sequences.repository';
import { OffersRepository } from '../repositories/offers.repository';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { BillingIssuerConfigService } from '../../services/billing-issuer-config.service';
import { CustomerProfilesService } from '../../services/customer-profiles.service';
import { InvoiceTaxContextService } from '../../services/invoice-tax-context.service';
import { TaxCalculationService } from '../../services/tax-calculation.service';
import { BillingEmailPublisher } from '../../email/billing-email.publisher';
import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { mapOfferToSearchDocument } from '../../search/billing-search-document.mapper';
import { BillingSearchIndexService } from '../../search/billing-search-index.service';
import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { assertOfferDraftEditable } from '../utils/offer-mutability.util';
import { mapOfferLineItemToResponse } from '../utils/map-offer-line-items.util';

import { OfferPdfService } from './offer-pdf.service';
import { SubscriptionOrderPreparationService } from './subscription-order-preparation.service';
import { UsersRepository } from '@forepath/identity/backend';

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
  ) {}

  async archive(id: string, adminUserId?: string): Promise<AdminOfferDetailResponseDto> {
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
      context: { adminUserId, offerNumber: allocated.number, totalGross: archived.totalGross },
    });

    await this.billingEmailPublisher.publishOfferArchived(archived, pdfStorageKey);
    this.billingNotificationPublisher.publishOffer('offer.archived', archived);
    this.billingSearchIndexService.scheduleUpsert('offers', mapOfferToSearchDocument(archived, getRequiredTenantId()));

    return await this.mapDetail(id);
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
      subtotalNet: Number(offer.subtotalNet),
      taxTotal: Number(offer.taxTotal),
      billToOpenPositions: offer.billToOpenPositions,
      lineItems: lines.map((line) => mapOfferLineItemToResponse(line)),
      taxMode: offer.taxMode ?? null,
      taxNote: offer.taxNote ?? null,
    };
  }
}
