import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { CloudInitConfigsService } from '../../services/cloud-init-configs.service';
import type { CloudInitConfigResponse } from '../../types/billing.types';

import {
  createCloudInitConfig,
  createCloudInitConfigFailure,
  createCloudInitConfigSuccess,
  deleteCloudInitConfig,
  deleteCloudInitConfigFailure,
  deleteCloudInitConfigSuccess,
  loadCloudInitConfig,
  loadCloudInitConfigFailure,
  loadCloudInitConfigs,
  loadCloudInitConfigsBatch,
  loadCloudInitConfigsFailure,
  loadCloudInitConfigsSuccess,
  loadCloudInitConfigSuccess,
  updateCloudInitConfig,
  updateCloudInitConfigFailure,
  updateCloudInitConfigSuccess,
} from './cloud-init-configs.actions';
import {
  createCloudInitConfig$,
  deleteCloudInitConfig$,
  loadCloudInitConfig$,
  loadCloudInitConfigs$,
  loadCloudInitConfigsBatch$,
  updateCloudInitConfig$,
} from './cloud-init-configs.effects';

describe('cloudInitConfigsEffects', () => {
  let actions$: Actions;
  let cloudInitConfigsService: jest.Mocked<CloudInitConfigsService>;
  const mockConfig: CloudInitConfigResponse = {
    id: 'cfg-1',
    key: 'my-app',
    name: 'My App',
    provisioningMode: 'simple',
    dockerImage: 'nginx:alpine',
    containerPort: 8080,
    hostPort: 80,
    workDir: '/opt/custom-app',
    environmentVariables: [],
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    cloudInitConfigsService = {
      listCloudInitConfigs: jest.fn(),
      getCloudInitConfig: jest.fn(),
      createCloudInitConfig: jest.fn(),
      updateCloudInitConfig: jest.fn(),
      deleteCloudInitConfig: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: CloudInitConfigsService, useValue: cloudInitConfigsService },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadCloudInitConfigs$', () => {
    it('returns loadCloudInitConfigsSuccess when batch is incomplete', (done) => {
      actions$ = of(loadCloudInitConfigs({ params: {} }));
      cloudInitConfigsService.listCloudInitConfigs.mockReturnValue(of([mockConfig]));

      loadCloudInitConfigs$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(loadCloudInitConfigsSuccess({ cloudInitConfigs: [mockConfig] }));
        done();
      });
    });

    it('returns loadCloudInitConfigsBatch when batch is full', (done) => {
      const fullBatch = Array.from({ length: 10 }, (_, index) => ({
        ...mockConfig,
        id: `cfg-${index}`,
      }));

      actions$ = of(loadCloudInitConfigs({ params: {} }));
      cloudInitConfigsService.listCloudInitConfigs.mockReturnValue(of(fullBatch));

      loadCloudInitConfigs$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(loadCloudInitConfigsBatch({ offset: 10, accumulatedCloudInitConfigs: fullBatch }));
        done();
      });
    });

    it('returns loadCloudInitConfigsFailure on error', (done) => {
      actions$ = of(loadCloudInitConfigs({ params: {} }));
      cloudInitConfigsService.listCloudInitConfigs.mockReturnValue(throwError(() => new Error('Load failed')));

      loadCloudInitConfigs$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(loadCloudInitConfigsFailure({ error: 'Load failed' }));
        done();
      });
    });

    it('normalizes non-Error failures', (done) => {
      actions$ = of(loadCloudInitConfigs({ params: {} }));
      cloudInitConfigsService.listCloudInitConfigs.mockReturnValue(throwError(() => 'string error'));

      loadCloudInitConfigs$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(loadCloudInitConfigsFailure({ error: 'string error' }));
        done();
      });
    });
  });

  describe('loadCloudInitConfigsBatch$', () => {
    it('returns loadCloudInitConfigsSuccess when batch is incomplete', (done) => {
      const accumulated = [mockConfig];

      actions$ = of(loadCloudInitConfigsBatch({ offset: 10, accumulatedCloudInitConfigs: accumulated }));
      cloudInitConfigsService.listCloudInitConfigs.mockReturnValue(of([]));

      loadCloudInitConfigsBatch$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(loadCloudInitConfigsSuccess({ cloudInitConfigs: accumulated }));
        done();
      });
    });

    it('returns next batch when batch is full', (done) => {
      const accumulated = [mockConfig];
      const nextBatch = Array.from({ length: 10 }, (_, index) => ({
        ...mockConfig,
        id: `cfg-next-${index}`,
      }));

      actions$ = of(loadCloudInitConfigsBatch({ offset: 10, accumulatedCloudInitConfigs: accumulated }));
      cloudInitConfigsService.listCloudInitConfigs.mockReturnValue(of(nextBatch));

      loadCloudInitConfigsBatch$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(
          loadCloudInitConfigsBatch({
            offset: 20,
            accumulatedCloudInitConfigs: [...accumulated, ...nextBatch],
          }),
        );
        done();
      });
    });

    it('returns loadCloudInitConfigsFailure on error', (done) => {
      actions$ = of(loadCloudInitConfigsBatch({ offset: 10, accumulatedCloudInitConfigs: [mockConfig] }));
      cloudInitConfigsService.listCloudInitConfigs.mockReturnValue(throwError(() => ({ message: 'Batch failed' })));

      loadCloudInitConfigsBatch$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(loadCloudInitConfigsFailure({ error: 'Batch failed' }));
        done();
      });
    });
  });

  describe('loadCloudInitConfig$', () => {
    it('returns loadCloudInitConfigSuccess on success', (done) => {
      actions$ = of(loadCloudInitConfig({ id: 'cfg-1' }));
      cloudInitConfigsService.getCloudInitConfig.mockReturnValue(of(mockConfig));

      loadCloudInitConfig$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(loadCloudInitConfigSuccess({ cloudInitConfig: mockConfig }));
        done();
      });
    });

    it('returns loadCloudInitConfigFailure on error', (done) => {
      actions$ = of(loadCloudInitConfig({ id: 'cfg-1' }));
      cloudInitConfigsService.getCloudInitConfig.mockReturnValue(throwError(() => new Error('Load failed')));

      loadCloudInitConfig$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(loadCloudInitConfigFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('createCloudInitConfig$', () => {
    it('returns createCloudInitConfigSuccess on success', (done) => {
      actions$ = of(createCloudInitConfig({ cloudInitConfig: {} as never }));
      cloudInitConfigsService.createCloudInitConfig.mockReturnValue(of(mockConfig));

      createCloudInitConfig$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(createCloudInitConfigSuccess({ cloudInitConfig: mockConfig }));
        done();
      });
    });

    it('returns createCloudInitConfigFailure on error', (done) => {
      actions$ = of(createCloudInitConfig({ cloudInitConfig: {} as never }));
      cloudInitConfigsService.createCloudInitConfig.mockReturnValue(throwError(() => new Error('Create failed')));

      createCloudInitConfig$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(createCloudInitConfigFailure({ error: 'Create failed' }));
        done();
      });
    });
  });

  describe('updateCloudInitConfig$', () => {
    it('returns updateCloudInitConfigSuccess on success', (done) => {
      const updated = { ...mockConfig, name: 'Updated' };

      actions$ = of(updateCloudInitConfig({ id: 'cfg-1', cloudInitConfig: { name: 'Updated' } }));
      cloudInitConfigsService.updateCloudInitConfig.mockReturnValue(of(updated));

      updateCloudInitConfig$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(updateCloudInitConfigSuccess({ cloudInitConfig: updated }));
        done();
      });
    });

    it('returns updateCloudInitConfigFailure on error', (done) => {
      actions$ = of(updateCloudInitConfig({ id: 'cfg-1', cloudInitConfig: {} }));
      cloudInitConfigsService.updateCloudInitConfig.mockReturnValue(throwError(() => new Error('Update failed')));

      updateCloudInitConfig$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(updateCloudInitConfigFailure({ error: 'Update failed' }));
        done();
      });
    });
  });

  describe('deleteCloudInitConfig$', () => {
    it('returns deleteCloudInitConfigSuccess on success', (done) => {
      actions$ = of(deleteCloudInitConfig({ id: 'cfg-1' }));
      cloudInitConfigsService.deleteCloudInitConfig.mockReturnValue(of(undefined));

      deleteCloudInitConfig$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(deleteCloudInitConfigSuccess({ id: 'cfg-1' }));
        done();
      });
    });

    it('returns deleteCloudInitConfigFailure on error', (done) => {
      actions$ = of(deleteCloudInitConfig({ id: 'cfg-1' }));
      cloudInitConfigsService.deleteCloudInitConfig.mockReturnValue(throwError(() => new Error('Delete failed')));

      deleteCloudInitConfig$(actions$, cloudInitConfigsService).subscribe((result) => {
        expect(result).toEqual(deleteCloudInitConfigFailure({ error: 'Delete failed' }));
        done();
      });
    });
  });
});
