import { UserRole, USERS_ROLES_KEY } from '@forepath/identity/backend';

import { AdminSpoolerController } from './admin-spooler.controller';
import type { SpoolJobEntity } from './entities/spool-job.entity';

describe('AdminSpoolerController', () => {
  const job = {
    id: 'job-1',
    kind: 'print.inventory_labels',
    status: 'completed',
    outputTarget: 'download',
    title: 'Labels',
    payload: {},
    attempts: 1,
    fileName: 'labels.pdf',
    fileSize: 4,
    createdAt: new Date('2026-11-25T10:00:00Z'),
    finishedAt: new Date('2026-11-25T10:00:05Z'),
  } as unknown as SpoolJobEntity;
  const spooler = {
    list: jest.fn(async () => ({ items: [job], total: 1 })),
    countByStatus: jest.fn(async () => ({ completed: 1 })),
    get: jest.fn(async () => job),
    getOutput: jest.fn(async () => ({
      content: Buffer.from('%PDF'),
      fileName: 'labels "1".pdf',
      contentType: 'application/pdf',
    })),
    retry: jest.fn(async () => job),
    cancel: jest.fn(async () => job),
  };
  const controller = new AdminSpoolerController(spooler as never);

  it('is restricted to admins and managers', () => {
    expect(Reflect.getMetadata(USERS_ROLES_KEY, AdminSpoolerController)).toEqual([UserRole.ADMIN, UserRole.MANAGER]);
  });

  it('lists jobs with counts and default paging', async () => {
    const result = await controller.list({});

    expect(spooler.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 0 }));
    expect(result).toEqual(
      expect.objectContaining({
        total: 1,
        counts: { completed: 1 },
        items: [expect.objectContaining({ id: 'job-1', hasFile: true, canRetry: false, canCancel: false })],
      }),
    );
  });

  it('serves files as safe, non-cacheable attachments', async () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (key: string, value: string) => (headers[key] = value) };

    await controller.file('job-1', res as never);

    expect(headers['Content-Disposition']).toBe('attachment; filename="labels__1_.pdf"');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  describe('token scopes of the job domain', () => {
    const letterJob = {
      ...job,
      kind: 'document.send',
      status: 'failed',
      documentType: 'invoice',
      payload: { channel: 'letter' },
    } as unknown as SpoolJobEntity;
    const pat = (scopes: string[]) => ({ user: { id: 'u-1', roles: ['admin'], amr: ['pat'], scopes } }) as never;

    it('refuses retry / cancel / file to tokens without the domain scopes of the job', async () => {
      spooler.get.mockResolvedValue(letterJob);

      await expect(controller.retry('job-1', pat(['spooler:admin']))).rejects.toThrow(
        'Missing: invoices:admin, letters:admin',
      );
      await expect(controller.cancel('job-1', pat(['spooler:admin', 'invoices:admin']))).rejects.toThrow(
        'Missing: letters:admin',
      );
      spooler.get.mockResolvedValue(job);
      await expect(controller.file('job-1', { setHeader: jest.fn() } as never, pat(['spooler:admin']))).rejects.toThrow(
        'Missing: inventory:admin',
      );
      expect(spooler.retry).not.toHaveBeenCalled();
      expect(spooler.cancel).not.toHaveBeenCalled();
    });

    it('lets tokens with the job scopes and console sessions act', async () => {
      spooler.get.mockResolvedValue(letterJob);

      await controller.retry('job-1', pat(['spooler:admin', 'invoices:admin', 'letters:admin']));
      await controller.cancel('job-1', { user: { id: 'u-1', roles: ['manager'], amr: ['pwd'] } } as never);

      expect(spooler.retry).toHaveBeenCalledTimes(1);
      expect(spooler.cancel).toHaveBeenCalledTimes(1);
    });
  });
});
