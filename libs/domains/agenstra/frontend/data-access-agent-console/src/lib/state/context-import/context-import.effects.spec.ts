import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { ContextImportAdminService } from '../../services/context-import-admin.service';

import {
  loadAtlassianContextImport,
  loadAtlassianContextImportBatch,
  loadAtlassianContextImportFailure,
  loadAtlassianContextImportSuccess,
} from './context-import.actions';
import { loadAtlassianContextImport$, loadAtlassianContextImportBatch$ } from './context-import.effects';

const sampleConfig = (id: string) => ({
  id,
  provider: 'atlassian' as const,
  importKind: 'jira' as const,
  atlassianConnectionId: '11111111-1111-1111-1111-111111111111',
  clientId: '33333333-3333-3333-3333-333333333333',
  enabled: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
});
const sampleConnection = (id: string) => ({
  id,
  baseUrl: 'https://x.atlassian.net',
  accountEmail: 'a@b.com',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
});

describe('context-import effects', () => {
  let actions$: Actions;
  let adminService: jest.Mocked<ContextImportAdminService>;

  beforeEach(() => {
    adminService = {
      listConnections: jest.fn(),
      listConfigs: jest.fn(),
    } as unknown as jest.Mocked<ContextImportAdminService>;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: ContextImportAdminService, useValue: adminService }],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loadAtlassianContextImport$ emits success', (done) => {
    const connections = [sampleConnection('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')];
    const configs = [sampleConfig('22222222-2222-4222-8222-222222222222')];

    actions$ = of(loadAtlassianContextImport());
    adminService.listConnections.mockReturnValue(of(connections));
    adminService.listConfigs.mockReturnValue(of(configs));

    loadAtlassianContextImport$(actions$, adminService).subscribe((action) => {
      expect(action).toEqual(loadAtlassianContextImportSuccess({ connections, configs }));
      expect(adminService.listConnections).toHaveBeenCalledWith({ limit: 10, offset: 0 });
      expect(adminService.listConfigs).toHaveBeenCalledWith({ limit: 10, offset: 0 });
      done();
    });
  });

  it('loadAtlassianContextImport$ dispatches batch when first connections page is full', (done) => {
    const configs = [sampleConfig('22222222-2222-4222-8222-222222222222')];
    const connections = Array.from({ length: 10 }, (_, i) =>
      sampleConnection(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    );

    actions$ = of(loadAtlassianContextImport());
    adminService.listConnections.mockReturnValue(of(connections));
    adminService.listConfigs.mockReturnValue(of(configs));

    loadAtlassianContextImport$(actions$, adminService).subscribe((action) => {
      expect(action).toEqual(
        loadAtlassianContextImportBatch({
          accumulatedConnections: connections,
          accumulatedConfigs: configs,
          nextConnectionOffset: 10,
          nextConfigOffset: null,
        }),
      );
      done();
    });
  });

  it('loadAtlassianContextImport$ dispatches batch when first configs page is full', (done) => {
    const connections = [sampleConnection('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')];
    const configs = Array.from({ length: 10 }, (_, i) =>
      sampleConfig(`11111111-1111-4111-8111-${String(i).padStart(12, '0')}`),
    );

    actions$ = of(loadAtlassianContextImport());
    adminService.listConnections.mockReturnValue(of(connections));
    adminService.listConfigs.mockReturnValue(of(configs));

    loadAtlassianContextImport$(actions$, adminService).subscribe((action) => {
      expect(action).toEqual(
        loadAtlassianContextImportBatch({
          accumulatedConnections: connections,
          accumulatedConfigs: configs,
          nextConnectionOffset: null,
          nextConfigOffset: 10,
        }),
      );
      done();
    });
  });

  it('loadAtlassianContextImportBatch$ merges connection pages and completes when short page', (done) => {
    const configs = [sampleConfig('22222222-2222-4222-8222-222222222222')];
    const first = [sampleConnection('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')];
    const second = [sampleConnection('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')];

    actions$ = of(
      loadAtlassianContextImportBatch({
        accumulatedConnections: first,
        accumulatedConfigs: configs,
        nextConnectionOffset: 10,
        nextConfigOffset: null,
      }),
    );
    adminService.listConnections.mockReturnValue(of(second));

    loadAtlassianContextImportBatch$(actions$, adminService).subscribe((action) => {
      expect(action).toEqual(loadAtlassianContextImportSuccess({ connections: [...first, ...second], configs }));
      expect(adminService.listConnections).toHaveBeenCalledWith({ limit: 10, offset: 10 });
      expect(adminService.listConfigs).not.toHaveBeenCalled();
      done();
    });
  });

  it('loadAtlassianContextImportBatch$ merges config pages and completes when short page', (done) => {
    const connections = [sampleConnection('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')];
    const firstCfg = [sampleConfig('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')];
    const secondCfg = [sampleConfig('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')];

    actions$ = of(
      loadAtlassianContextImportBatch({
        accumulatedConnections: connections,
        accumulatedConfigs: firstCfg,
        nextConnectionOffset: null,
        nextConfigOffset: 10,
      }),
    );
    adminService.listConfigs.mockReturnValue(of(secondCfg));

    loadAtlassianContextImportBatch$(actions$, adminService).subscribe((action) => {
      expect(action).toEqual(loadAtlassianContextImportSuccess({ connections, configs: [...firstCfg, ...secondCfg] }));
      expect(adminService.listConfigs).toHaveBeenCalledWith({ limit: 10, offset: 10 });
      expect(adminService.listConnections).not.toHaveBeenCalled();
      done();
    });
  });

  it('loadAtlassianContextImport$ emits failure on error', (done) => {
    actions$ = of(loadAtlassianContextImport());
    adminService.listConfigs.mockReturnValue(of([]));
    adminService.listConnections.mockReturnValue(throwError(() => new Error('network')));

    loadAtlassianContextImport$(actions$, adminService).subscribe((action) => {
      expect(action).toEqual(loadAtlassianContextImportFailure({ error: 'network' }));
      done();
    });
  });
});
