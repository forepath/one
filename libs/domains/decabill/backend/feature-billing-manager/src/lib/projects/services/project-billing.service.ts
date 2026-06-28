import { BadRequestException, Injectable } from '@nestjs/common';

import { TaxCategory } from '../../constants/tax-category.constants';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { CustomerProfilesService } from '../../services/customer-profiles.service';
import { InvoiceIssuanceService } from '../../services/invoice-issuance.service';
import { InvoiceService } from '../../services/invoice.service';
import type { BillProjectTimeResponseDto, ProjectUnbilledTimeBoundsDto } from '../dto/project.dto';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectTimeEntriesRepository } from '../repositories/project-time-entries.repository';
import { resolveProjectBillTimeRange } from '../utils/project-bill-time-range.utils';
import { ProjectBoardSummaryService } from './project-board-summary.service';

const MIN_BILLABLE_AMOUNT = 0.01;

export interface BillProjectTimeRange {
  from: Date;
  to: Date;
}

@Injectable()
export class ProjectBillingService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly timeEntriesRepository: ProjectTimeEntriesRepository,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly invoiceService: InvoiceService,
    private readonly invoiceIssuanceService: InvoiceIssuanceService,
    private readonly auditLog: BillingAuditLogService,
    private readonly projectBoardSummary: ProjectBoardSummaryService,
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
    range: BillProjectTimeRange,
  ): Promise<BillProjectTimeResponseDto> {
    const { from, to } = resolveProjectBillTimeRange(range.from, range.to);
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const profile = await this.customerProfilesService.getByUserId(project.userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException('Assigned customer profile is incomplete');
    }

    const entries = await this.timeEntriesRepository.findUnbilledByProjectInRange(projectId, from, to);

    if (entries.length === 0) {
      throw new BadRequestException('No unbilled time entries in range');
    }

    const billedMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
    const hours = billedMinutes / 60;
    const rate = Number(project.hourlyRateNet);
    const amountNet = hours * rate;

    if (amountNet < MIN_BILLABLE_AMOUNT) {
      throw new BadRequestException('Billable amount below minimum');
    }

    const description = `Project ${project.name} — ${hours.toFixed(2)}h @ ${rate.toFixed(2)}/${project.currency}/h (${from.toISOString()} – ${to.toISOString()})`;

    const draft = await this.invoiceService.createDraft({
      userId: project.userId,
      projectId: project.id,
      currency: project.currency,
      lineInputs: [
        {
          description,
          quantity: 1,
          unitPriceNet: amountNet,
          taxCategory: TaxCategory.STANDARD,
        },
      ],
    });

    const issued = await this.invoiceIssuanceService.issueDraft(draft.id);
    const billedAt = new Date();

    await this.timeEntriesRepository.markBilled(
      entries.map((e) => e.id),
      issued.id,
      billedAt,
    );

    await this.auditLog.log({
      process: 'project.bill_time',
      level: 'info',
      message: 'Admin billed project time',
      invoiceId: issued.id,
      userId: project.userId,
      context: { adminUserId, projectId, billedMinutes, amountNet, from: from.toISOString(), to: to.toISOString() },
    });

    await this.projectBoardSummary.emitSummaryChanged(project);

    return {
      invoiceId: issued.id,
      invoiceNumber: issued.invoiceNumber,
      billedMinutes,
      amountNet,
    };
  }
}
