import { runWithTenantId } from '@forepath/shared/backend/util-http-context';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { SpoolJobEntity } from './entities/spool-job.entity';
import { SpoolPermanentError, type SpoolKindHandler } from './spool-kind-handler.interface';
import { SpoolJobKind, SpoolJobStatus, SpoolOutputTarget } from './spooler.constants';
import { SpoolerService } from './spooler.service';

describe('SpoolerService', () => {
  const env = process.env;
  const job = (patch: Partial<SpoolJobEntity> = {}): SpoolJobEntity =>
    ({
      id: 'job-1',
      tenantId: 'tenant-a',
      kind: SpoolJobKind.INVENTORY_LABELS,
      status: SpoolJobStatus.PROCESSING,
      outputTarget: SpoolOutputTarget.DOWNLOAD,
      title: 'Labels',
      payload: { labels: {} },
      attempts: 1,
      createdAt: new Date('2026-11-25T10:00:00Z'),
      ...patch,
    }) as SpoolJobEntity;
  const repository = {
    create: jest.fn(async (dto: Partial<SpoolJobEntity>) => job({ ...dto, status: SpoolJobStatus.QUEUED })),
    findById: jest.fn(),
    findByIdOrThrow: jest.fn(),
    startProcessing: jest.fn(),
    complete: jest.fn(),
    recordFailure: jest.fn(async () => true),
    cancelQueued: jest.fn(),
    requeueFailed: jest.fn(),
    readOutput: jest.fn(),
    findStale: jest.fn(),
    touch: jest.fn(),
    purgeFinishedBefore: jest.fn(),
    list: jest.fn(),
    countByStatus: jest.fn(),
  };
  const auditLog = { log: jest.fn() };
  const enqueue = { enqueueUnit: jest.fn() };
  const handler: jest.Mocked<SpoolKindHandler> = {
    kind: SpoolJobKind.INVENTORY_LABELS,
    run: jest.fn(),
    onAbandoned: jest.fn(),
    prepareRetry: jest.fn(),
  };
  let service: SpoolerService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env };
    service = new SpoolerService(repository as never, auditLog as never, enqueue as never);
    service.registerHandler(handler);
  });

  afterAll(() => {
    process.env = env;
  });

  const inTenant = <T>(run: () => Promise<T>) => runWithTenantId('tenant-a', run);

  it('creates queued jobs and hands them to the queue; refuses unknown kinds', async () => {
    const created = await inTenant(() =>
      service.create({
        kind: SpoolJobKind.INVENTORY_LABELS,
        outputTarget: SpoolOutputTarget.DOWNLOAD,
        title: 'x'.repeat(300),
        payload: { labels: { kinds: ['property'] } },
        createdByUserId: 'admin-1',
      }),
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued', attempts: 0, createdByUserId: 'admin-1' }),
    );
    expect((repository.create.mock.calls[0][0] as SpoolJobEntity).title).toHaveLength(255);
    expect(enqueue.enqueueUnit).toHaveBeenCalledWith({ spoolJobId: created.id, tenantId: 'tenant-a' });

    await expect(
      inTenant(() =>
        service.create({
          kind: SpoolJobKind.PROJECT_TIME_REPORT,
          outputTarget: SpoolOutputTarget.DOWNLOAD,
          title: 'x',
          payload: {},
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the job queued when the queue is unavailable (the coordinator enqueues it again)', async () => {
    enqueue.enqueueUnit.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      inTenant(() =>
        service.create({
          kind: SpoolJobKind.INVENTORY_LABELS,
          outputTarget: SpoolOutputTarget.DOWNLOAD,
          title: 'x',
          payload: {},
        }),
      ),
    ).resolves.toEqual(expect.objectContaining({ status: 'queued' }));
  });

  describe('process', () => {
    it('skips jobs of another tenant and jobs that are no longer pending', async () => {
      repository.findById.mockResolvedValueOnce(job({ tenantId: 'tenant-b' }));
      await inTenant(() => service.process('job-1', { attemptsMade: 0, maxAttempts: 3 }));
      expect(repository.startProcessing).not.toHaveBeenCalled();

      repository.findById.mockResolvedValueOnce(job());
      repository.startProcessing.mockResolvedValueOnce(null);
      await inTenant(() => service.process('job-1', { attemptsMade: 0, maxAttempts: 3 }));
      expect(handler.run).not.toHaveBeenCalled();
    });

    it('stores the output and completes the job', async () => {
      const output = { content: Buffer.from('%PDF'), fileName: 'labels.pdf', contentType: 'application/pdf' };

      repository.findById.mockResolvedValue(job());
      repository.startProcessing.mockResolvedValue(job());
      handler.run.mockResolvedValue({ output, payload: { count: 3 } });

      await inTenant(() => service.process('job-1', { attemptsMade: 0, maxAttempts: 3 }));

      expect(repository.complete).toHaveBeenCalledWith('job-1', output, { payload: { labels: {}, count: 3 } });
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'spool_job.complete' }));
    });

    it('requeues transient failures for the next attempt and fails for good on the last one', async () => {
      repository.findById.mockResolvedValue(job());
      repository.startProcessing.mockResolvedValue(job());
      handler.run.mockRejectedValue(new Error('chromium crashed'));

      await expect(inTenant(() => service.process('job-1', { attemptsMade: 0, maxAttempts: 3 }))).rejects.toThrow(
        'chromium crashed',
      );
      expect(repository.recordFailure).toHaveBeenLastCalledWith('job-1', 'chromium crashed', false);
      expect(handler.onAbandoned).not.toHaveBeenCalled();

      await expect(
        inTenant(() => service.process('job-1', { attemptsMade: 2, maxAttempts: 3 })),
      ).resolves.toBeUndefined();
      expect(repository.recordFailure).toHaveBeenLastCalledWith('job-1', 'chromium crashed', true);
      expect(handler.onAbandoned).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }), 'failed');
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ process: 'spool_job.fail', level: 'error' }));
    });

    it('fails permanent errors (and 4xx) right away', async () => {
      repository.findById.mockResolvedValue(job());
      repository.startProcessing.mockResolvedValue(job());
      handler.run.mockRejectedValueOnce(new SpoolPermanentError('no email'));
      await inTenant(() => service.process('job-1', { attemptsMade: 0, maxAttempts: 3 }));
      expect(repository.recordFailure).toHaveBeenLastCalledWith('job-1', 'no email', true);

      handler.run.mockRejectedValueOnce(new BadRequestException('Customer has no postal address'));
      await inTenant(() => service.process('job-1', { attemptsMade: 0, maxAttempts: 3 }));
      expect(repository.recordFailure).toHaveBeenLastCalledWith('job-1', 'Customer has no postal address', true);
    });

    it('refuses oversized outputs', async () => {
      repository.findById.mockResolvedValue(job());
      repository.startProcessing.mockResolvedValue(job());
      handler.run.mockResolvedValue({
        output: { content: Buffer.alloc(51 * 1024 * 1024), fileName: 'big.pdf', contentType: 'application/pdf' },
      });

      await inTenant(() => service.process('job-1', { attemptsMade: 0, maxAttempts: 3 }));

      expect(repository.complete).not.toHaveBeenCalled();
      expect(repository.recordFailure).toHaveBeenCalledWith('job-1', expect.stringMatching(/too large/), true);
    });
  });

  describe('cancel / retry / output', () => {
    it('cancels only queued jobs and lets the handler clean up', async () => {
      repository.findByIdOrThrow.mockResolvedValue(job({ status: SpoolJobStatus.QUEUED }));
      repository.cancelQueued.mockResolvedValueOnce(true);

      await inTenant(() => service.cancel('job-1', 'admin-1'));
      expect(handler.onAbandoned).toHaveBeenCalledWith(expect.anything(), 'cancelled');

      repository.cancelQueued.mockResolvedValueOnce(false);
      await expect(inTenant(() => service.cancel('job-1'))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('retries only failed jobs with the payload prepared by the handler', async () => {
      repository.findByIdOrThrow.mockResolvedValueOnce(job({ status: SpoolJobStatus.COMPLETED }));
      await expect(inTenant(() => service.retry('job-1'))).rejects.toBeInstanceOf(BadRequestException);

      repository.findByIdOrThrow.mockResolvedValue(job({ status: SpoolJobStatus.FAILED }));
      handler.prepareRetry?.mockResolvedValue({ fresh: true });
      repository.requeueFailed.mockResolvedValue(true);

      await inTenant(() => service.retry('job-1', 'admin-1'));

      expect(repository.requeueFailed).toHaveBeenCalledWith('job-1', { fresh: true });
      expect(enqueue.enqueueUnit).toHaveBeenCalled();
    });

    it('serves the file of completed jobs only', async () => {
      repository.findByIdOrThrow.mockResolvedValueOnce(job({ status: SpoolJobStatus.FAILED }));
      await expect(inTenant(() => service.getOutput('job-1'))).rejects.toBeInstanceOf(NotFoundException);

      repository.findByIdOrThrow.mockResolvedValue(
        job({ status: SpoolJobStatus.COMPLETED, fileName: 'labels.pdf', contentType: 'application/pdf' }),
      );
      repository.readOutput.mockResolvedValueOnce(null);
      await expect(inTenant(() => service.getOutput('job-1'))).rejects.toThrow(/no longer available/);

      repository.readOutput.mockResolvedValueOnce(Buffer.from('%PDF'));
      await expect(inTenant(() => service.getOutput('job-1'))).resolves.toEqual({
        content: Buffer.from('%PDF'),
        fileName: 'labels.pdf',
        contentType: 'application/pdf',
      });
    });
  });

  it('coordinates: re-enqueues stale jobs and purges finished jobs past retention', async () => {
    const now = new Date('2026-11-25T12:00:00Z');

    process.env.BILLING_SPOOLER_RETENTION_DAYS = '3';
    repository.findStale.mockResolvedValue([job({ status: SpoolJobStatus.QUEUED, tenantId: 'tenant-b' })]);
    repository.purgeFinishedBefore.mockResolvedValue(4);

    await expect(service.coordinate(now)).resolves.toEqual({ requeued: 1, purged: 4 });

    expect(repository.touch).toHaveBeenCalledWith('job-1');
    expect(enqueue.enqueueUnit).toHaveBeenCalledWith({ spoolJobId: 'job-1', tenantId: 'tenant-b' });
    expect(repository.purgeFinishedBefore).toHaveBeenCalledWith(new Date('2026-11-22T12:00:00Z'), [
      'completed',
      'failed',
      'cancelled',
    ]);
  });
});
