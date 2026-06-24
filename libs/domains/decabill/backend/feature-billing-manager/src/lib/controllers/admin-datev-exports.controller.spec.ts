import { StreamableFile } from '@nestjs/common';
import 'reflect-metadata';

import { KEYCLOAK_ROLES_KEY, USERS_ROLES_KEY, UserRole } from '@forepath/identity/backend';

import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';

import { AdminDatevExportsController } from './admin-datev-exports.controller';

describe('AdminDatevExportsController', () => {
  const adminService = {
    listExports: jest.fn(),
    getExport: jest.fn(),
    downloadExport: jest.fn(),
    triggerExport: jest.fn(),
  };
  const controller = new AdminDatevExportsController(adminService as never);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('has admin role guards on controller', () => {
    expect(Reflect.getMetadata(KEYCLOAK_ROLES_KEY, AdminDatevExportsController)).toContain(UserRole.ADMIN);
    expect(Reflect.getMetadata(USERS_ROLES_KEY, AdminDatevExportsController)).toContain(UserRole.ADMIN);
  });

  it('lists exports', async () => {
    adminService.listExports.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });

    const result = await controller.listExports();

    expect(result.total).toBe(0);
    expect(adminService.listExports).toHaveBeenCalledWith(DatevExportScope.TENANT, 20, 0, undefined);
  });

  it('returns streamable file on download', async () => {
    adminService.downloadExport.mockResolvedValue({ buffer: Buffer.from('zip'), fileName: 'export.zip' });

    const result = await controller.downloadExport('00000000-0000-4000-8000-000000000001');

    expect(result).toBeInstanceOf(StreamableFile);
    expect(adminService.downloadExport).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
  });

  it('triggers export', async () => {
    adminService.triggerExport.mockResolvedValue({
      queued: true,
      scope: DatevExportScope.TENANT,
      year: 2026,
      month: 1,
    });

    const result = await controller.triggerExport({ year: 2026, month: 1 }, { user: { id: 'admin-1' } } as never);

    expect(result.queued).toBe(true);
    expect(adminService.triggerExport).toHaveBeenCalledWith('admin-1', { year: 2026, month: 1 });
  });

  it('returns export metadata', async () => {
    adminService.getExport.mockResolvedValue({
      id: 'exp-1',
      status: DatevExportStatus.COMPLETED,
    });

    const result = await controller.getExport('00000000-0000-4000-8000-000000000001');

    expect(result.status).toBe(DatevExportStatus.COMPLETED);
  });
});
