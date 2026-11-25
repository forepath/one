import { Injectable } from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';

import type { PrintInventoryLabelsDto } from '../inventory/dto/inventory.dto';
import { InventoryMovementsRepository } from '../inventory/repositories/inventory-movements.repository';
import type { ProjectTimeReportRequestDto } from '../projects/dto/project.dto';
import { ProjectsRepository } from '../projects/repositories/projects.repository';

import type { SpoolJobEntity } from './entities/spool-job.entity';
import { SpoolJobKind, SpoolOutputTarget } from './spooler.constants';
import { SpoolerService } from './spooler.service';

/**
 * Request side of spooled printouts: the console asks for a PDF, gets a spool job back right away and downloads the
 * file once the job completed. Referenced records are checked in the current tenant before the job is created.
 */
@Injectable()
export class SpoolPrintoutService {
  constructor(
    private readonly spooler: SpoolerService,
    private readonly movementsRepository: InventoryMovementsRepository,
    private readonly projectsRepository: ProjectsRepository,
  ) {}

  async spoolInventoryLabels(dto: PrintInventoryLabelsDto, adminUserId?: string): Promise<SpoolJobEntity> {
    const count = (dto.articleIds?.length ?? 0) + (dto.serialUnitIds?.length ?? 0);

    return await this.spooler.create({
      kind: SpoolJobKind.INVENTORY_LABELS,
      outputTarget: SpoolOutputTarget.DOWNLOAD,
      title: `Labels (${dto.kinds.join(', ')}, ${count} item${count === 1 ? '' : 's'})`,
      payload: { labels: instanceToPlain(dto) },
      createdByUserId: adminUserId ?? null,
    });
  }

  async spoolInventoryMovement(movementId: string, adminUserId?: string): Promise<SpoolJobEntity> {
    const movement = await this.movementsRepository.findByIdOrThrow(movementId);

    return await this.spooler.create({
      kind: SpoolJobKind.INVENTORY_MOVEMENT,
      outputTarget: SpoolOutputTarget.DOWNLOAD,
      title: `Inventory document ${movement.documentNumber}`,
      payload: { movementId },
      createdByUserId: adminUserId ?? null,
    });
  }

  async spoolProjectTimeReport(
    projectId: string,
    dto: ProjectTimeReportRequestDto,
    adminUserId?: string,
  ): Promise<SpoolJobEntity> {
    const project = await this.projectsRepository.findByIdOrThrow(projectId);

    return await this.spooler.create({
      kind: SpoolJobKind.PROJECT_TIME_REPORT,
      outputTarget: SpoolOutputTarget.DOWNLOAD,
      title: `Time report ${project.name} (${dto.from.slice(0, 10)} to ${dto.to.slice(0, 10)})`,
      payload: { projectId, request: instanceToPlain(dto) },
      createdByUserId: adminUserId ?? null,
    });
  }
}
