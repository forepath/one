import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';

import { getRequiredTenantId } from '../utils/tenant-query.utils';

import { SpoolJobOutputEntity } from './entities/spool-job-output.entity';
import { SpoolJobEntity } from './entities/spool-job.entity';
import { SpoolJobKind, SpoolJobStatus } from './spooler.constants';

export interface SpoolJobListFilter {
  status?: SpoolJobStatus;
  kind?: SpoolJobKind;
  documentType?: string;
  documentId?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class SpoolJobsRepository {
  constructor(
    @InjectRepository(SpoolJobEntity)
    private readonly jobs: Repository<SpoolJobEntity>,
    @InjectRepository(SpoolJobOutputEntity)
    private readonly outputs: Repository<SpoolJobOutputEntity>,
  ) {}

  async create(dto: Partial<SpoolJobEntity>): Promise<SpoolJobEntity> {
    return await this.jobs.save(this.jobs.create({ ...dto, tenantId: getRequiredTenantId() }));
  }

  /** Job of the current tenant. */
  async findByIdOrThrow(id: string): Promise<SpoolJobEntity> {
    const job = await this.jobs.findOne({ where: { id, tenantId: getRequiredTenantId() } });

    if (!job) {
      throw new NotFoundException('Spool job not found');
    }

    return job;
  }

  /** Worker lookup: the job's tenant is checked by the caller against the job payload's tenant. */
  async findById(id: string): Promise<SpoolJobEntity | null> {
    return await this.jobs.findOne({ where: { id } });
  }

  async list(filter: SpoolJobListFilter): Promise<{ items: SpoolJobEntity[]; total: number }> {
    const where: Record<string, unknown> = { tenantId: getRequiredTenantId() };

    if (filter.status) where['status'] = filter.status;

    if (filter.kind) where['kind'] = filter.kind;

    if (filter.documentType) where['documentType'] = filter.documentType;

    if (filter.documentId) where['documentId'] = filter.documentId;

    const [items, total] = await this.jobs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: filter.limit,
      skip: filter.offset,
    });

    return { items, total };
  }

  /** Counts per status of the current tenant (Spooler page header, action center). */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.jobs
      .createQueryBuilder('job')
      .select('job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('job.tenant_id = :tenantId', { tenantId: getRequiredTenantId() })
      .groupBy('job.status')
      .getRawMany<{ status: string; count: string }>();

    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  /**
   * Moves a job into processing (first run, BullMQ retry or a crashed worker's job). Resolves the updated row, or
   * `null` when the job is finished / cancelled meanwhile.
   */
  async startProcessing(id: string): Promise<SpoolJobEntity | null> {
    const result = await this.jobs
      .createQueryBuilder()
      .update(SpoolJobEntity)
      .set({ status: SpoolJobStatus.PROCESSING, attempts: () => 'attempts + 1', startedAt: new Date(), error: null })
      .where('id = :id', { id })
      .andWhere('status IN (:...statuses)', { statuses: [SpoolJobStatus.QUEUED, SpoolJobStatus.PROCESSING] })
      .execute();

    return (result.affected ?? 0) === 1 ? await this.findById(id) : null;
  }

  async complete(
    id: string,
    output: { content: Buffer; fileName: string; contentType: string } | null,
    extra: Partial<Pick<SpoolJobEntity, 'payload'>> = {},
  ): Promise<void> {
    await this.jobs.manager.transaction(async (manager) => {
      if (output) {
        await manager.getRepository(SpoolJobOutputEntity).save({ jobId: id, content: output.content });
      }

      await manager.getRepository(SpoolJobEntity).update(
        { id, status: SpoolJobStatus.PROCESSING },
        {
          status: SpoolJobStatus.COMPLETED,
          finishedAt: new Date(),
          error: null,
          ...(output
            ? { fileName: output.fileName, contentType: output.contentType, fileSize: output.content.length }
            : {}),
          ...extra,
        },
      );
    });
  }

  /** Records a failed attempt; `final` ends the job, otherwise it waits for the next retry. */
  async recordFailure(id: string, error: string, final: boolean): Promise<boolean> {
    const result = await this.jobs.update(
      { id, status: SpoolJobStatus.PROCESSING },
      final
        ? { status: SpoolJobStatus.FAILED, error, finishedAt: new Date() }
        : { status: SpoolJobStatus.QUEUED, error },
    );

    return (result.affected ?? 0) === 1;
  }

  /** Cancels a job that has not started yet. */
  async cancelQueued(id: string): Promise<boolean> {
    const result = await this.jobs.update(
      { id, tenantId: getRequiredTenantId(), status: SpoolJobStatus.QUEUED },
      { status: SpoolJobStatus.CANCELLED, finishedAt: new Date() },
    );

    return (result.affected ?? 0) === 1;
  }

  /** Puts a failed job back into the queue (fresh attempt budget). */
  async requeueFailed(id: string, payload: Record<string, unknown>): Promise<boolean> {
    const result = await this.jobs.update(
      { id, tenantId: getRequiredTenantId(), status: SpoolJobStatus.FAILED },
      { status: SpoolJobStatus.QUEUED, attempts: 0, error: null, finishedAt: null, startedAt: null, payload },
    );

    return (result.affected ?? 0) === 1;
  }

  async readOutput(id: string): Promise<Buffer | null> {
    const output = await this.outputs.findOne({ where: { jobId: id } });

    return output?.content ?? null;
  }

  /** Jobs whose queue entry may be lost (coordinator), across tenants. */
  async findStale(queuedBefore: Date, processingBefore: Date, limit: number): Promise<SpoolJobEntity[]> {
    const queued = await this.jobs.find({
      where: { status: SpoolJobStatus.QUEUED, updatedAt: LessThan(queuedBefore) },
      order: { updatedAt: 'ASC' },
      take: limit,
    });
    const processing = await this.jobs.find({
      where: { status: SpoolJobStatus.PROCESSING, updatedAt: LessThan(processingBefore) },
      order: { updatedAt: 'ASC' },
      take: limit,
    });

    return [...queued, ...processing];
  }

  /** Touches a re-enqueued job so the coordinator does not pick it again right away. */
  async touch(id: string): Promise<void> {
    await this.jobs.update({ id }, { updatedAt: new Date() });
  }

  /** Removes finished jobs (and their files) older than the retention period, across tenants. */
  async purgeFinishedBefore(before: Date, statuses: readonly SpoolJobStatus[]): Promise<number> {
    const result = await this.jobs.delete({ status: In([...statuses]), updatedAt: LessThan(before) });

    return result.affected ?? 0;
  }
}
