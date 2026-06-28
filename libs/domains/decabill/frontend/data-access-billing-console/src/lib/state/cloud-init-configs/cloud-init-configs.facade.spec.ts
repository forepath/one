import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import type {
  CloudInitConfigResponse,
  CreateCloudInitConfigDto,
  ListParams,
  UpdateCloudInitConfigDto,
} from '../../types/billing.types';

import {
  clearSelectedCloudInitConfig,
  createCloudInitConfig,
  deleteCloudInitConfig,
  loadCloudInitConfig,
  loadCloudInitConfigs,
  updateCloudInitConfig,
} from './cloud-init-configs.actions';
import { CloudInitConfigsFacade } from './cloud-init-configs.facade';

describe('CloudInitConfigsFacade', () => {
  let facade: CloudInitConfigsFacade;
  let store: jest.Mocked<Store>;
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
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [CloudInitConfigsFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(CloudInitConfigsFacade);
  });

  describe('State Observables', () => {
    it('returns cloud init configs observable', (done) => {
      store.select.mockReturnValue(of([mockConfig]));
      facade.getCloudInitConfigs$().subscribe((result) => {
        expect(result).toEqual([mockConfig]);
        done();
      });
    });

    it('returns active cloud init configs observable', (done) => {
      store.select.mockReturnValue(of([mockConfig]));
      facade.getActiveCloudInitConfigs$().subscribe((result) => {
        expect(result).toEqual([mockConfig]);
        done();
      });
    });

    it('returns selected cloud init config observable', (done) => {
      store.select.mockReturnValue(of(mockConfig));
      facade.getSelectedCloudInitConfig$().subscribe((result) => {
        expect(result).toEqual(mockConfig);
        done();
      });
    });

    it('returns loading observables', (done) => {
      store.select.mockReturnValue(of(true));
      facade.getCloudInitConfigsLoading$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('returns config loading observable', (done) => {
      store.select.mockReturnValue(of(true));
      facade.getCloudInitConfigLoading$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('returns creating observable', (done) => {
      store.select.mockReturnValue(of(true));
      facade.getCloudInitConfigsCreating$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('returns updating observable', (done) => {
      store.select.mockReturnValue(of(true));
      facade.getCloudInitConfigsUpdating$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('returns deleting observable', (done) => {
      store.select.mockReturnValue(of(true));
      facade.getCloudInitConfigsDeleting$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('returns loading any observable', (done) => {
      store.select.mockReturnValue(of(true));
      facade.getCloudInitConfigsLoadingAny$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('returns error observable', (done) => {
      store.select.mockReturnValue(of('Load failed'));
      facade.getCloudInitConfigsError$().subscribe((result) => {
        expect(result).toBe('Load failed');
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('dispatches loadCloudInitConfigs', () => {
      const params: ListParams = { limit: 10 };

      facade.loadCloudInitConfigs(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadCloudInitConfigs({ params }));
    });

    it('dispatches loadCloudInitConfig', () => {
      facade.loadCloudInitConfig('cfg-1');
      expect(store.dispatch).toHaveBeenCalledWith(loadCloudInitConfig({ id: 'cfg-1' }));
    });

    it('dispatches createCloudInitConfig', () => {
      const dto: CreateCloudInitConfigDto = {
        key: 'new-app',
        name: 'New App',
      };

      facade.createCloudInitConfig(dto);
      expect(store.dispatch).toHaveBeenCalledWith(createCloudInitConfig({ cloudInitConfig: dto }));
    });

    it('dispatches updateCloudInitConfig', () => {
      const dto: UpdateCloudInitConfigDto = { name: 'Updated' };

      facade.updateCloudInitConfig('cfg-1', dto);
      expect(store.dispatch).toHaveBeenCalledWith(updateCloudInitConfig({ id: 'cfg-1', cloudInitConfig: dto }));
    });

    it('dispatches deleteCloudInitConfig', () => {
      facade.deleteCloudInitConfig('cfg-1');
      expect(store.dispatch).toHaveBeenCalledWith(deleteCloudInitConfig({ id: 'cfg-1' }));
    });

    it('dispatches clearSelectedCloudInitConfig', () => {
      facade.clearSelectedCloudInitConfig();
      expect(store.dispatch).toHaveBeenCalledWith(clearSelectedCloudInitConfig());
    });
  });
});
