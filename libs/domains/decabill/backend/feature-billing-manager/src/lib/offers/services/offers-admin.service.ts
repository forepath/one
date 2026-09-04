import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { TaxCategory } from '../../constants/tax-category.constants';
import { OfferFulfillmentStatus } from '../constants/offer-fulfillment-status.constants';
import { OfferLineType } from '../constants/offer-line-type.constants';
import { OfferStatus } from '../constants/offer-status.constants';
import type {
  AdminOfferDetailResponseDto,
  AdminOfferListItemDto,
  CreateAdminOfferDto,
  OfferLineInputDto,
  OfferPlanTemplateLineDto,
  OfferProjectTemplateLineDto,
  OfferStandardLineDto,
  PaginatedAdminOffersResponseDto,
  UpdateAdminOfferDto,
} from '../dto/offer.dto';
import type { OfferEntity } from '../entities/offer.entity';
import type { OfferLineItemEntity } from '../entities/offer-line-item.entity';
import { OfferLineItemsRepository } from '../repositories/offer-line-items.repository';
import { OffersRepository } from '../repositories/offers.repository';
import type { PaginatedBillingAuditLogsResponseDto } from '../../dto/admin-billing.dto';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { mapOfferToSearchDocument } from '../../search/billing-search-document.mapper';
import { BillingSearchIndexService } from '../../search/billing-search-index.service';
import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { assertOfferRevocable } from '../utils/offer-mutability.util';

import { OfferArchiveService } from './offer-archive.service';
import { OfferPdfService } from './offer-pdf.service';
import { InvoiceTaxContextService } from '../../services/invoice-tax-context.service';
import { TaxCalculationService } from '../../services/tax-calculation.service';
import { resolvePlanTaxCategory } from '../../utils/plan-tax.utils';
import { assertOfferDeletable, assertOfferDraftEditable } from '../utils/offer-mutability.util';
import {
  buildOfferProjectTemplatePayload,
  mapOfferLineItemToResponse,
  mapOfferPlanTemplateLineToTaxInput,
  mapOfferProjectTemplateLineToTaxInput,
  mapOfferStandardLineToTaxInput,
} from '../utils/map-offer-line-items.util';

import {
  SubscriptionOrderPreparationService,
  type PreparedPlanOrderContext,
} from './subscription-order-preparation.service';

interface BuiltOfferLine {
  taxInput: ReturnType<typeof mapOfferStandardLineToTaxInput>;
  entity: Partial<OfferLineItemEntity>;
  prepared?: PreparedPlanOrderContext;
}

@Injectable()
export class OffersAdminService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly offerLineItemsRepository: OfferLineItemsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly auditLog: BillingAuditLogService,
    private readonly subscriptionOrderPreparationService: SubscriptionOrderPreparationService,
    private readonly offerArchiveService: OfferArchiveService,
    private readonly offerPdfService: OfferPdfService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingSearchIndexService: BillingSearchIndexService,
  ) {}

  async list(
    limit: number,
    offset: number,
    search?: string,
    userId?: string,
  ): Promise<PaginatedAdminOffersResponseDto> {
    const { items, total } = await this.offersRepository.findAllForAdmin({ limit, offset, search, userId });

    return {
      items: await Promise.all(items.map((item) => this.mapListItem(item))),
      total,
      limit,
      offset,
    };
  }

  async get(id: string): Promise<AdminOfferDetailResponseDto> {
    const offer = await this.offersRepository.findByIdOrThrow(id, true);

    return await this.mapDetail(offer);
  }

  async create(dto: CreateAdminOfferDto, adminUserId?: string): Promise<AdminOfferDetailResponseDto> {
    await this.assertUserExists(dto.userId);
    this.assertHasLines(dto.lineItems);

    const { offerData, lineEntities, preparedLines } = await this.buildDraftOffer(dto);
    const offer = await this.offersRepository.create(offerData);
    await this.offerLineItemsRepository.createMany(
      lineEntities.map((line) => ({
        ...line,
        offerId: offer.id,
      })),
    );

    await this.auditLog.log({
      process: 'offer.create',
      level: 'info',
      message: 'Admin created offer draft',
      offerId: offer.id,
      userId: dto.userId,
      context: { adminUserId, lineCount: lineEntities.length },
    });

    for (const prepared of preparedLines) {
      await this.auditLog.log({
        process: 'offer.line.plan_prepared',
        level: 'info',
        message: 'Plan template line prepared for offer draft',
        userId: dto.userId,
        context: {
          adminUserId,
          offerId: offer.id,
          planId: prepared.plan.id,
          planName: prepared.planName,
          periodTotalPrice: prepared.periodTotalPrice,
        },
      });
    }

    this.billingNotificationPublisher.publishOffer(
      'offer.created',
      await this.offersRepository.findByIdOrThrow(offer.id),
    );
    this.billingSearchIndexService.scheduleUpsert(
      'offers',
      mapOfferToSearchDocument(await this.offersRepository.findByIdOrThrow(offer.id), getRequiredTenantId()),
    );

    return await this.get(offer.id);
  }

  async archive(id: string, adminUserId?: string): Promise<AdminOfferDetailResponseDto> {
    return await this.offerArchiveService.archive(id, adminUserId);
  }

  async revoke(id: string, adminUserId?: string): Promise<AdminOfferDetailResponseDto> {
    const offer = await this.offersRepository.findByIdOrThrow(id);

    assertOfferRevocable(offer);

    const revoked = await this.offersRepository.update(id, {
      status: OfferStatus.REVOKED,
      revokedAt: new Date(),
    });

    await this.auditLog.log({
      process: 'offer.revoke',
      level: 'info',
      message: 'Admin revoked offer',
      offerId: id,
      userId: offer.userId,
      context: { adminUserId, offerNumber: revoked.offerNumber },
    });

    this.billingNotificationPublisher.publishOffer('offer.revoked', revoked);
    this.billingSearchIndexService.scheduleUpsert('offers', mapOfferToSearchDocument(revoked, getRequiredTenantId()));

    return await this.get(id);
  }

  async getAuditLogs(id: string, limit: number, offset: number): Promise<PaginatedBillingAuditLogsResponseDto> {
    await this.offersRepository.findByIdOrThrow(id);
    const result = await this.auditLog.listForOffer(id, limit, offset);

    return {
      items: result.items,
      total: result.total,
      limit,
      offset,
    };
  }

  async readPdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const offer = await this.offersRepository.findByIdOrThrow(id);

    if (!offer.pdfStorageKey) {
      throw new NotFoundException('Offer PDF is not available');
    }

    return {
      buffer: await this.offerPdfService.readPdf(offer.pdfStorageKey),
      filename: `${offer.offerNumber ?? offer.id}.pdf`,
    };
  }

  async expireOffer(id: string): Promise<void> {
    const offer = await this.offersRepository.findByIdOrThrow(id);

    if (offer.status !== OfferStatus.ARCHIVED) {
      return;
    }

    const expired = await this.offersRepository.update(id, {
      status: OfferStatus.EXPIRED,
      expiredAt: new Date(),
    });

    await this.auditLog.log({
      process: 'offer.expire',
      level: 'info',
      message: 'Offer expired',
      offerId: id,
      userId: offer.userId,
      context: { offerNumber: expired.offerNumber },
    });

    this.billingNotificationPublisher.publishOffer('offer.expired', expired);
    this.billingSearchIndexService.scheduleUpsert('offers', mapOfferToSearchDocument(expired, getRequiredTenantId()));
  }

  async update(id: string, dto: UpdateAdminOfferDto, adminUserId?: string): Promise<AdminOfferDetailResponseDto> {
    const existing = await this.offersRepository.findByIdOrThrow(id);

    assertOfferDraftEditable(existing);
    await this.assertUserExists(dto.userId);
    this.assertHasLines(dto.lineItems);

    const { offerData, lineEntities, preparedLines } = await this.buildDraftOffer({
      ...dto,
      currency: dto.currency ?? existing.currency,
    });
    await this.offerLineItemsRepository.deleteByOfferId(id);
    await this.offersRepository.update(id, offerData);
    await this.offerLineItemsRepository.createMany(
      lineEntities.map((line) => ({
        ...line,
        offerId: id,
      })),
    );

    await this.auditLog.log({
      process: 'offer.update',
      level: 'info',
      message: 'Admin updated offer draft',
      userId: dto.userId,
      context: { adminUserId, offerId: id, lineCount: lineEntities.length },
    });

    for (const prepared of preparedLines) {
      await this.auditLog.log({
        process: 'offer.line.plan_prepared',
        level: 'info',
        message: 'Plan template line prepared for offer draft',
        userId: dto.userId,
        context: {
          adminUserId,
          offerId: id,
          planId: prepared.plan.id,
          planName: prepared.planName,
          periodTotalPrice: prepared.periodTotalPrice,
        },
      });
    }

    return await this.get(id);
  }

  async delete(id: string, adminUserId?: string): Promise<void> {
    const offer = await this.offersRepository.findByIdOrThrow(id);

    assertOfferDeletable(offer);
    await this.offerLineItemsRepository.deleteByOfferId(id);
    await this.offersRepository.delete(id);

    await this.auditLog.log({
      process: 'offer.delete',
      level: 'info',
      message: 'Admin deleted offer draft',
      userId: offer.userId,
      context: { adminUserId, offerId: id },
    });
  }

  private async buildDraftOffer(dto: CreateAdminOfferDto): Promise<{
    offerData: Partial<OfferEntity>;
    lineEntities: Partial<OfferLineItemEntity>[];
    preparedLines: PreparedPlanOrderContext[];
  }> {
    const taxContext = await this.invoiceTaxContextService.resolveForUser(dto.userId);
    const builtLines = await Promise.all(dto.lineItems.map((line) => this.buildLine(dto.userId, line)));
    const totals = this.taxCalculationService.computeLines(
      builtLines.map((line) => line.taxInput),
      {
        taxTreatment: taxContext.treatment,
        forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
      },
    );

    const lineEntities = builtLines.map((built, index) => {
      const computed = totals.lines[index]!;

      return {
        ...built.entity,
        position: index,
        description: computed.description,
        quantity: computed.quantity,
        unitPriceNet: computed.unitPriceNet,
        taxCategory: computed.taxCategory,
        taxRate: computed.taxRate,
        lineNet: computed.lineNet,
        lineTax: computed.lineTax,
        lineGross: computed.lineGross,
      };
    });

    return {
      offerData: {
        userId: dto.userId,
        status: OfferStatus.DRAFT,
        currency: dto.currency ?? 'EUR',
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
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        billToOpenPositions: dto.billToOpenPositions ?? false,
      },
      lineEntities,
      preparedLines: builtLines.flatMap((line) => (line.prepared ? [line.prepared] : [])),
    };
  }

  private async buildLine(userId: string, line: OfferLineInputDto): Promise<BuiltOfferLine> {
    switch (line.lineType) {
      case OfferLineType.STANDARD:
        return this.buildStandardLine(line.payload as OfferStandardLineDto);
      case OfferLineType.PROJECT_TEMPLATE:
        return this.buildProjectTemplateLine(line.payload as OfferProjectTemplateLineDto);
      case OfferLineType.PLAN_TEMPLATE:
        return await this.buildPlanTemplateLine(userId, line.payload as OfferPlanTemplateLineDto);
      default:
        throw new BadRequestException(`Unsupported offer line type: ${line.lineType as string}`);
    }
  }

  private buildStandardLine(payload: OfferStandardLineDto): BuiltOfferLine {
    return {
      taxInput: mapOfferStandardLineToTaxInput(payload),
      entity: {
        lineType: OfferLineType.STANDARD,
        description: payload.description,
        quantity: payload.quantity,
        unitLabel: payload.unitLabel ?? null,
        unitPriceNet: payload.unitPriceNet,
        taxCategory: payload.taxCategory ?? TaxCategory.STANDARD,
        scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt) : null,
        fulfillmentStatus: OfferFulfillmentStatus.PENDING,
      },
    };
  }

  private buildProjectTemplateLine(payload: OfferProjectTemplateLineDto): BuiltOfferLine {
    const quantity = payload.targetHours != null && payload.targetHours > 0 ? payload.targetHours : 1;

    return {
      taxInput: mapOfferProjectTemplateLineToTaxInput(payload),
      entity: {
        lineType: OfferLineType.PROJECT_TEMPLATE,
        description: payload.description,
        quantity,
        unitLabel: 'hour',
        unitPriceNet: payload.hourlyRateNet,
        taxCategory: TaxCategory.STANDARD,
        scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt) : null,
        fulfillmentStatus: OfferFulfillmentStatus.PENDING,
        projectTemplatePayload: buildOfferProjectTemplatePayload(payload),
      },
    };
  }

  private async buildPlanTemplateLine(userId: string, payload: OfferPlanTemplateLineDto): Promise<BuiltOfferLine> {
    const prepared = await this.subscriptionOrderPreparationService.prepareForUser(
      userId,
      {
        planId: payload.planId,
        requestedConfig: payload.requestedConfig,
        addonIds: payload.addonIds,
        addonConfigs: payload.addonConfigs,
        preferredAlternatives: payload.preferredAlternatives,
        autoBackorder: payload.autoBackorder,
        promotionCode: payload.promotionCode,
        promotionBenefitStartsAt: payload.promotionBenefitStartsAt,
      },
      {
        throwOnUnavailable: true,
        lineDescription: payload.description,
      },
    );
    const taxCategory = resolvePlanTaxCategory(prepared.plan);

    return {
      taxInput: mapOfferPlanTemplateLineToTaxInput(payload.description, prepared.periodUnitPriceNet, taxCategory),
      prepared,
      entity: {
        lineType: OfferLineType.PLAN_TEMPLATE,
        description: payload.description,
        quantity: 1,
        unitLabel: prepared.unitLabel,
        unitPriceNet: prepared.periodUnitPriceNet,
        taxCategory,
        scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt) : null,
        fulfillmentStatus: OfferFulfillmentStatus.PENDING,
        planId: prepared.plan.id,
        effectiveConfigSnapshot: prepared.effectiveConfig,
        addonConfigsSnapshot: prepared.addonConfigs ?? null,
        addonIds: prepared.addonIds,
        preferredAlternatives: payload.preferredAlternatives ?? null,
        autoBackorder: payload.autoBackorder ?? false,
        promotionCode: payload.promotionCode?.trim() || null,
        pricingSnapshot: prepared.pricingSnapshot,
        planNameSnapshot: prepared.planName,
        availabilityCheckedAt: prepared.availabilityCheckedAt,
      },
    };
  }

  private async mapListItem(offer: OfferEntity): Promise<AdminOfferListItemDto> {
    const user = await this.usersRepository.findByIdForTenant(offer.userId);

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
    };
  }

  private async mapDetail(offer: OfferEntity): Promise<AdminOfferDetailResponseDto> {
    const user = await this.usersRepository.findByIdForTenant(offer.userId);
    const lines = offer.lineItems ?? (await this.offerLineItemsRepository.findByOfferId(offer.id));

    return {
      ...(await this.mapListItem(offer)),
      subtotalNet: Number(offer.subtotalNet),
      taxTotal: Number(offer.taxTotal),
      billToOpenPositions: offer.billToOpenPositions,
      lineItems: lines.map((line) => mapOfferLineItemToResponse(line)),
      taxMode: offer.taxMode ?? null,
      taxNote: offer.taxNote ?? null,
    };
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.usersRepository.findByIdForTenant(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }

  private assertHasLines(lineItems: OfferLineInputDto[]): void {
    if (!lineItems.length) {
      throw new BadRequestException('Offer must contain at least one line item');
    }
  }
}
