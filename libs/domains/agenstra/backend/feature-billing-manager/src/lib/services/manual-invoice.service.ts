import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { TaxCategory } from '../constants/tax-category.constants';
import type { CreateManualInvoiceDto, IssueManualInvoiceDto, UpdateManualInvoiceDto } from '../dto/manual-invoice.dto';
import type { ManualInvoiceDetailResponseDto } from '../dto/manual-invoice.dto';
import { InvoiceLineItemsRepository } from '../repositories/invoice-line-items.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { assertDraftEditable } from '../utils/invoice-mutability.util';

import { BillingAuditLogService } from './billing-audit-log.service';
import { CustomerProfilesService } from './customer-profiles.service';
import { InvoiceIssuanceService } from './invoice-issuance.service';
import { InvoiceService, type CreateInvoiceDraftParams } from './invoice.service';
import type { LineItemInput } from './tax-calculation.service';
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
  ) {}

  async createDraft(dto: CreateManualInvoiceDto, adminUserId: string): Promise<ManualInvoiceDetailResponseDto> {
    const user = await this.usersRepository.findById(dto.userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.subscriptionId) {
      const subscription = await this.subscriptionsRepository.findByIdOrThrow(dto.subscriptionId);

      if (subscription.userId !== dto.userId) {
        throw new BadRequestException('Subscription does not belong to user');
      }
    }

    const lineInputs = this.toLineInputs(dto.lineItems);
    const draftParams: CreateInvoiceDraftParams = {
      subscriptionId: dto.subscriptionId,
      userId: dto.userId,
      lineInputs,
      currency: dto.currency,
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

    const lineInputs = this.toLineInputs(dto.lineItems);
    const totals = this.taxCalculationService.computeLines(lineInputs);

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
      })),
    );

    await this.invoicesRepository.update(invoiceRefId, {
      subtotalNet: totals.subtotalNet,
      taxTotal: totals.taxTotal,
      totalGross: totals.totalGross,
      balanceDue: totals.totalGross,
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

    await this.invoiceIssuanceService.issueDraft(invoiceRefId, dto?.dueInDays ?? 14);

    await this.auditLog.log({
      process: 'invoice.manual_issue',
      level: 'info',
      message: 'Admin issued manual invoice draft',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: { adminUserId, dueInDays: dto?.dueInDays ?? 14 },
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
    const user = await this.usersRepository.findById(detail.userId ?? '');

    return {
      ...detail,
      userId: detail.userId!,
      userEmail: user?.email,
    };
  }

  private toLineInputs(items: CreateManualInvoiceDto['lineItems']): LineItemInput[] {
    return items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceNet: item.unitPriceNet,
      taxCategory: item.taxCategory ?? TaxCategory.STANDARD,
    }));
  }
}
