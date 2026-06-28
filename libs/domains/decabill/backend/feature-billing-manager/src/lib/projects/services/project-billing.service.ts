import { BadRequestException, Injectable } from '@nestjs/common';

import { TaxCategory } from '../../constants/tax-category.constants';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { CustomerProfilesService } from '../../services/customer-profiles.service';
import { InvoiceIssuanceService } from '../../services/invoice-issuance.service';
import { InvoiceService } from '../../services/invoice.service';
import type { BillProjectTimeResponseDto } from '../dto/project.dto';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectTimeEntriesRepository } from '../repositories/project-time-entries.repository';
import { ProjectBoardRealtimeService } from './project-board-realtime.service';
import { PROJECTS_BOARD_EVENTS } from './project-board-realtime.constants';
import { ProjectsService } from './projects.service';

const MIN_BILLABLE_AMOUNT = 0.01;

@Injectable()
export class ProjectBillingService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly timeEntriesRepository: ProjectTimeEntriesRepository,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly invoiceService: InvoiceService,
    private readonly invoiceIssuanceService: InvoiceIssuanceService,
    private readonly auditLog: BillingAuditLogService,
    private readonly projectsService: ProjectsService,
    private readonly projectBoardRealtime: ProjectBoardRealtimeService,
  ) {}

  async billUnbilledTime(projectId: string, adminUserId: string): Promise<BillProjectTimeResponseDto> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);
    const profile = await this.customerProfilesService.getByUserId(project.userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException('Assigned customer profile is incomplete');
    }

    const entries = await this.timeEntriesRepository.findUnbilledByProject(projectId);

    if (entries.length === 0) {
      throw new BadRequestException('No unbilled time entries');
    }

    const billedMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
    const hours = billedMinutes / 60;
    const rate = Number(project.hourlyRateNet);
    const amountNet = hours * rate;

    if (amountNet < MIN_BILLABLE_AMOUNT) {
      throw new BadRequestException('Billable amount below minimum');
    }

    const description = `Project ${project.name} — ${hours.toFixed(2)}h @ ${rate.toFixed(2)}/${project.currency}/h`;

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
      context: { adminUserId, projectId, billedMinutes, amountNet },
    });

    const summary = await this.projectsService.buildSummary(project);

    this.projectBoardRealtime.emitToProject(projectId, PROJECTS_BOARD_EVENTS.projectSummaryChanged, summary);

    return {
      invoiceId: issued.id,
      invoiceNumber: issued.invoiceNumber,
      billedMinutes,
      amountNet,
    };
  }
}
