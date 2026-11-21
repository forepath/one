import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { shouldNotify } from '../dto/document-delivery.dto';
import type { CreateManualInvoiceDto, IssueManualInvoiceDto, UpdateManualInvoiceDto } from '../dto/manual-invoice.dto';
import type { ManualInvoiceDetailResponseDto } from '../dto/manual-invoice.dto';
import { InventoryArticlesRepository } from '../inventory/repositories/inventory-articles.repository';
import { assertInventoryArticlesExist } from '../inventory/utils/inventory-article-references.util';
import { InvoiceLineItemsRepository } from '../repositories/invoice-line-items.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { normalizeDocumentNote } from '../utils/document-note.utils';
import { normalizeDeliveryTermsInput, normalizePaymentDueDaysInput } from '../utils/document-terms.utils';
import { invoiceDeliveryFields } from '../utils/invoice-delivery.util';
import { assertDraftEditable } from '../utils/invoice-mutability.util';
import { mapManualInvoiceLineItemsToInputs } from '../utils/map-manual-invoice-line-items.util';

import { BillingAuditLogService } from './billing-audit-log.service';
import { CustomerProfilesService } from './customer-profiles.service';
import { InvoiceIssuanceService } from './invoice-issuance.service';
import { InvoiceTaxContextService } from './invoice-tax-context.service';
import { InvoiceService, type CreateInvoiceDraftParams } from './invoice.service';
import { TaxCalculationService } from './tax-calculation.service';

@Injectable()
export class ManualInvoiceService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly invoiceLineItemsRepository: InvoiceLineItemsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly invoiceService: InvoiceService,
    private readonly invoiceIssuanceService: InvoiceIssuanceService,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly auditLog: BillingAuditLogService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly inventoryArticlesRepository: InventoryArticlesRepository,
  ) {}

  async createDraft(dto: CreateManualInvoiceDto, adminUserId: string): Promise<ManualInvoiceDetailResponseDto> {
    const user = await this.usersRepository.findByIdForTenant(dto.userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.subscriptionId) {
      const subscription = await this.subscriptionsRepository.findByIdOrThrow(dto.subscriptionId);

      if (subscription.userId !== dto.userId) {
        throw new BadRequestException('Subscription does not belong to user');
      }
    }

    const lineInputs = mapManualInvoiceLineItemsToInputs(dto.lineItems);
    const draftParams: CreateInvoiceDraftParams = {
      subscriptionId: dto.subscriptionId,
      userId: dto.userId,
      lineInputs,
      currency: dto.currency,
      note: dto.note,
    };
    const draft = await this.invoiceService.createDraft(draftParams);

    await this.auditLog.log({
      process: 'invoice.manual_create',
      level: 'info',
      message: 'Admin created manual invoice draft',
      invoiceId: draft.id,
      userId: dto.userId,
      context: { adminUserId, subscriptionId: dto.subscriptionId },
    });

    return await this.getDetail(draft.id);
  }

  async updateDraft(
    invoiceRefId: string,
    dto: UpdateManualInvoiceDto,
    adminUserId: string,
  ): Promise<ManualInvoiceDetailResponseDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    assertDraftEditable(invoice);

    const lineInputs = mapManualInvoiceLineItemsToInputs(dto.lineItems);

    await assertInventoryArticlesExist(
      this.inventoryArticlesRepository,
      lineInputs.map((line) => line.inventoryArticleId),
    );
    const taxContext = await this.invoiceTaxContextService.resolveForUser(invoice.userId);
    const totals = this.taxCalculationService.computeLines(lineInputs, {
      taxTreatment: taxContext.treatment,
      forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
    });

    await this.invoiceLineItemsRepository.deleteByInvoiceId(invoiceRefId);
    await this.invoiceLineItemsRepository.createMany(
      totals.lines.map((line, index) => ({
        invoiceId: invoiceRefId,
        position: index,
        description: line.description,
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet,
        taxCategory: line.taxCategory,
        taxRate: line.taxRate,
        lineNet: line.lineNet,
        lineTax: line.lineTax,
        lineGross: line.lineGross,
        inventoryArticleId: lineInputs[index]?.inventoryArticleId ?? null,
      })),
    );

    await this.invoicesRepository.update(invoiceRefId, {
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
      balanceDue: totals.totalGross,
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
      ...(dto.note !== undefined ? { note: normalizeDocumentNote(dto.note) } : {}),
    });

    await this.auditLog.log({
      process: 'invoice.manual_update',
      level: 'info',
      message: 'Admin updated manual invoice draft',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: { adminUserId, totalGross: totals.totalGross },
    });

    return await this.getDetail(invoiceRefId);
  }

  async issueDraft(
    invoiceRefId: string,
    adminUserId: string,
    dto?: IssueManualInvoiceDto,
  ): Promise<ManualInvoiceDetailResponseDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    assertDraftEditable(invoice);

    const profile = await this.customerProfilesService.getByUserId(invoice.userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException('Customer profile must be complete before issuing invoice');
    }

    const notifyCustomer = shouldNotify(dto?.notifyCustomer);
    const issued = await this.invoiceIssuanceService.issueDraft(invoiceRefId, {
      skipNotification: !notifyCustomer,
      terms: {
        paymentDueDays: normalizePaymentDueDaysInput(dto?.dueInDays),
        deliveryTerms: normalizeDeliveryTermsInput(dto ?? {}),
      },
    });

    await this.auditLog.log({
      process: 'invoice.manual_issue',
      level: 'info',
      message: 'Admin issued manual invoice draft',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: {
        adminUserId,
        dueInDays: issued.paymentDueDays ?? null,
        deliveryTermsCode: issued.deliveryTermsCode ?? null,
        notifyCustomer,
      },
    });

    return await this.getDetail(invoiceRefId);
  }

  async deleteDraft(invoiceRefId: string, adminUserId: string): Promise<void> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    assertDraftEditable(invoice);

    await this.invoiceLineItemsRepository.deleteByInvoiceId(invoiceRefId);
    await this.invoicesRepository.delete(invoiceRefId);

    await this.auditLog.log({
      process: 'invoice.manual_delete',
      level: 'info',
      message: 'Admin deleted manual invoice draft',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: { adminUserId },
    });
  }

  async getDetail(invoiceRefId: string): Promise<ManualInvoiceDetailResponseDto> {
    const detail = await this.invoiceService.getDetailById(invoiceRefId);
    const user = await this.usersRepository.findByIdForTenant(detail.userId ?? '');
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    return {
      ...detail,
      ...invoiceDeliveryFields(invoice),
      userId: detail.userId!,
      userEmail: user?.email,
    };
  }
}
