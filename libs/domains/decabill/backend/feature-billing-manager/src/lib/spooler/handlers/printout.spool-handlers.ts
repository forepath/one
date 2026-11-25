import { Injectable } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { isUUID, validate } from 'class-validator';

import { PrintInventoryLabelsDto } from '../../inventory/dto/inventory.dto';
import { InventoryLabelsService } from '../../inventory/services/inventory-labels.service';
import { InventoryMovementsService } from '../../inventory/services/inventory-movements.service';
import { ProjectTimeReportRequestDto } from '../../projects/dto/project.dto';
import { ProjectsAdminService } from '../../projects/services/projects-admin.service';
import type { SpoolJobEntity } from '../entities/spool-job.entity';
import { SpoolPermanentError, type SpoolKindHandler, type SpoolRunResult } from '../spool-kind-handler.interface';
import { SpoolJobKind } from '../spooler.constants';

const PDF = 'application/pdf';

/** Re-validates a stored payload with the DTO the console request was validated with (defense in depth). */
async function readValidated<T extends object>(cls: ClassConstructor<T>, value: unknown): Promise<T> {
  const instance = plainToInstance(cls, value ?? {});
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });

  if (errors.length > 0) {
    throw new SpoolPermanentError('Invalid printout job input');
  }

  return instance;
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) || 'document.pdf';
}

/** `print.inventory_labels`: the label sheet / sticker PDF (same renderer as the direct export). */
@Injectable()
export class InventoryLabelsSpoolHandler implements SpoolKindHandler {
  readonly kind = SpoolJobKind.INVENTORY_LABELS;

  constructor(private readonly labels: InventoryLabelsService) {}

  async run(job: SpoolJobEntity): Promise<SpoolRunResult> {
    const dto = await readValidated(PrintInventoryLabelsDto, job.payload['labels']);
    const { buffer, fileName, count } = await this.labels.render(dto);

    return {
      output: { content: buffer, fileName: safeFileName(fileName), contentType: PDF },
      payload: { count },
    };
  }
}

/** `print.inventory_movement`: the movement document (stored PDF, regenerated when missing). */
@Injectable()
export class InventoryMovementSpoolHandler implements SpoolKindHandler {
  readonly kind = SpoolJobKind.INVENTORY_MOVEMENT;

  constructor(private readonly movements: InventoryMovementsService) {}

  async run(job: SpoolJobEntity): Promise<SpoolRunResult> {
    const movementId = job.payload['movementId'];

    if (typeof movementId !== 'string' || !isUUID(movementId, '4')) {
      throw new SpoolPermanentError('Invalid printout job input');
    }

    const { buffer, fileName } = await this.movements.getPdf(movementId);

    return { output: { content: buffer, fileName: safeFileName(fileName), contentType: PDF } };
  }
}

/** `print.project_time_report`: time report of a project for a period. */
@Injectable()
export class ProjectTimeReportSpoolHandler implements SpoolKindHandler {
  readonly kind = SpoolJobKind.PROJECT_TIME_REPORT;

  constructor(private readonly projectsAdminService: ProjectsAdminService) {}

  async run(job: SpoolJobEntity): Promise<SpoolRunResult> {
    const projectId = job.payload['projectId'];

    if (typeof projectId !== 'string' || !isUUID(projectId, '4')) {
      throw new SpoolPermanentError('Invalid printout job input');
    }

    const dto = await readValidated(ProjectTimeReportRequestDto, job.payload['request']);
    const buffer = await this.projectsAdminService.generateTimeReport(projectId, dto);

    return {
      output: { content: Buffer.from(buffer), fileName: `time-report-${projectId}.pdf`, contentType: PDF },
    };
  }
}
