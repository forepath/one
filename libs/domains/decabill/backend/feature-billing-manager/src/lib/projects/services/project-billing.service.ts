import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { getMinCheckoutPaymentAmount } from '../../constants/payment-amount.constants';
import { TaxCategory } from '../../constants/tax-category.constants';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { CustomerProfilesService } from '../../services/customer-profiles.service';
import { BillingEmailPublisher } from '../../email/billing-email.publisher';
import { InvoiceIssuanceService } from '../../services/invoice-issuance.service';
import { InvoiceService } from '../../services/invoice.service';
import { InvoiceTaxContextService } from '../../services/invoice-tax-context.service';
import { SubscriptionsRepository } from '../../repositories/subscriptions.repository';
import { InvoicesRepository } from '../../repositories/invoices.repository';
import { TaxCalculationService } from '../../services/tax-calculation.service';
import { mapManualInvoiceLineItemsToInputs } from '../../utils/map-manual-invoice-line-items.util';
import type { BillProjectTimeDto, BillProjectTimeResponseDto, ProjectUnbilledTimeBoundsDto } from '../dto/project.dto';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectTimeEntriesRepository } from '../repositories/project-time-entries.repository';
import { resolveProjectBillTimeRange } from '../utils/project-bill-time-range.utils';
import { withProjectBillTimeLock } from '../utils/project-bill-time-lock.util';
import { formatProjectTimeReportRange } from '../utils/project-time-report-format.util';
import { ProjectBoardSummaryService } from './project-board-summary.service';
import { ProjectTimeReportService } from './project-time-report.service';

const MIN_BILLABLE_AMOUNT = 0.01;

@Injectable()
export class ProjectBillingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projectsRepository: ProjectsRepository,
    private readonly timeEntriesRepository: ProjectTimeEntriesRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly invoiceService: InvoiceService,
    private readonly invoiceIssuanceService: InvoiceIssuanceService,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly taxCalculationService: TaxCalculationService,
    private readonly invoiceTaxContextService: InvoiceTaxContextService,
    private readonly auditLog: BillingAuditLogService,
    private readonly projectBoardSummary: ProjectBoardSummaryService,
    private readonly projectTimeReportService: ProjectTimeReportService,
  ) {}

  async getUnbilledTimeBounds(projectId: string): Promise<ProjectUnbilledTimeBoundsDto> {
    await this.projectsRepository.findByIdOrThrow(projectId);

    const bounds = await this.timeEntriesRepository.findUnbilledTimeBounds(projectId);

    return {
      from: bounds.from,
      to: bounds.to,
      entryCount: bounds.entryCount,
    };
  }

  async billUnbilledTime(
    projectId: string,
    adminUserId: string,
    dto: BillProjectTimeDto,
  ): Promise<BillProjectTimeResponseDto> {
    const { from, to } = resolveProjectBillTimeRange(new Date(dto.from), new Date(dto.to));
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const profile = await this.customerProfilesService.getByUserId(project.userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException('Assigned customer profile is incomplete');
    }

    if (dto.subscriptionId) {
      const subscription = await this.subscriptionsRepository.findByIdOrThrow(dto.subscriptionId);

      if (subscription.userId !== project.userId) {
        throw new BadRequestException('Subscription does not belong to user');
      }
    }

    return await withProjectBillTimeLock(this.dataSource, projectId, async () =>
      this.billUnbilledTimeWithinLock(projectId, adminUserId, dto, project, from, to),
    );
  }

  private async billUnbilledTimeWithinLock(
    projectId: string,
    adminUserId: string,
    dto: BillProjectTimeDto,
    project: Awaited<ReturnType<ProjectsRepository['findByIdOrThrow']>>,
    from: Date,
    to: Date,
  ): Promise<BillProjectTimeResponseDto> {
    const entries = await this.dataSource.transaction((manager) =>
      this.timeEntriesRepository.findUnbilledByProjectInRangeForUpdate(projectId, from, to, manager),
    );

    if (entries.length === 0) {
      throw new BadRequestException('No unbilled time entries in range');
    }

    const billedMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
    const billedHours = billedMinutes / 60;
    const hourlyRateNet = Number(project.hourlyRateNet);
    const customLineInputs = mapManualInvoiceLineItemsToInputs(dto.lineItems ?? []);
    const lineInputs = [
      {
        description: `${project.name} (${formatProjectTimeReportRange(from, to)})`,
        quantity: billedHours,
        unitPriceNet: hourlyRateNet,
        taxCategory: TaxCategory.STANDARD,
      },
      ...customLineInputs,
    ];
    const taxContext = await this.invoiceTaxContextService.resolveForUser(project.userId);
    const totals = this.taxCalculationService.computeLines(lineInputs, {
      taxTreatment: taxContext.treatment,
      forceChargeNonEuIssuerEuB2b: taxContext.forceChargeNonEuIssuerEuB2b,
    });
    const minCheckoutPaymentAmount = getMinCheckoutPaymentAmount();

    if (totals.subtotalNet < MIN_BILLABLE_AMOUNT) {
      throw new BadRequestException('Billable amount below minimum');
    }

    if (totals.totalGross > 0 && totals.totalGross < minCheckoutPaymentAmount) {
      throw new BadRequestException(
        `Billable amount is below the minimum payment amount of ${minCheckoutPaymentAmount.toFixed(2)}`,
      );
    }

    const draft = await this.invoiceService.createDraft({
      userId: project.userId,
      projectId: project.id,
      subscriptionId: dto.subscriptionId,
      currency: project.currency,
      lineInputs,
    });

    const issued = await this.invoiceIssuanceService.issueDraft(draft.id, 14, { skipNotification: true });
    const billedAt = new Date();
    const markedCount = await this.timeEntriesRepository.markBilled(
      projectId,
      entries.map((e) => e.id),
      issued.id,
      billedAt,
    );

    if (markedCount !== entries.length) {
      await this.invoiceService.voidInvoice(
        issued.id,
        issued.subscriptionId,
        adminUserId,
        { process: 'project.bill_time', reason: 'concurrent_bill_abort' },
        { skipNotification: true },
      );

      throw new ConflictException(
        'Time entries were billed concurrently; the duplicate invoice was voided automatically',
      );
    }

    const timeReportStorageKey = await this.projectTimeReportService.generateAndStoreForBilling(
      issued,
      project,
      entries,
      from,
      to,
    );

    const issuedWithTimeReport = await this.invoicesRepository.update(issued.id, { timeReportStorageKey });

    if (!issuedWithTimeReport.pdfStorageKey) {
      throw new BadRequestException('Issued invoice is missing PDF storage key');
    }

    await this.billingEmailPublisher.publishInvoiceIssued(issuedWithTimeReport, issuedWithTimeReport.pdfStorageKey);

    await this.auditLog.log({
      process: 'project.bill_time',
      level: 'info',
      message: 'Admin billed project time',
      invoiceId: issued.id,
      userId: project.userId,
      context: {
        adminUserId,
        projectId,
        billedMinutes,
        amountNet: totals.subtotalNet,
        from: from.toISOString(),
        to: to.toISOString(),
        subscriptionId: dto.subscriptionId,
        customLineItemCount: customLineInputs.length,
      },
    });

    await this.projectBoardSummary.emitSummaryChanged(project);

    return {
      invoiceId: issued.id,
      invoiceNumber: issued.invoiceNumber,
      billedMinutes,
      amountNet: totals.subtotalNet,
    };
  }
}
