import type { CloudInitConfigResponse } from '../../types/billing.types';

import {
  clearSelectedCloudInitConfig,
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
  cloudInitConfigsReducer,
  initialCloudInitConfigsState,
  type CloudInitConfigsState,
} from './cloud-init-configs.reducer';

describe('cloudInitConfigsReducer', () => {
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
  const mockConfig2: CloudInitConfigResponse = {
    ...mockConfig,
    id: 'cfg-2',
    key: 'other-app',
    name: 'Other App',
  };

  describe('initial state', () => {
    it('returns the initial state', () => {
      const action = { type: 'UNKNOWN' };

      expect(cloudInitConfigsReducer(undefined, action as never)).toEqual(initialCloudInitConfigsState);
    });
  });

  describe('loadCloudInitConfigs', () => {
    it('sets loading to true, clears entities and error', () => {
      const state: CloudInitConfigsState = {
        ...initialCloudInitConfigsState,
        entities: [mockConfig],
        error: 'Previous error',
      };
      const newState = cloudInitConfigsReducer(state, loadCloudInitConfigs({ params: {} }));

      expect(newState.loading).toBe(true);
      expect(newState.entities).toEqual([]);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadCloudInitConfigsBatch', () => {
    it('sets accumulated configs and keeps loading true', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, loading: true };
      const newState = cloudInitConfigsReducer(
        state,
        loadCloudInitConfigsBatch({ offset: 10, accumulatedCloudInitConfigs: [mockConfig, mockConfig2] }),
      );

      expect(newState.entities).toEqual([mockConfig, mockConfig2]);
      expect(newState.loading).toBe(true);
    });
  });

  describe('loadCloudInitConfigsSuccess', () => {
    it('sets configs and loading to false', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, loading: true };
      const newState = cloudInitConfigsReducer(
        state,
        loadCloudInitConfigsSuccess({ cloudInitConfigs: [mockConfig, mockConfig2] }),
      );

      expect(newState.entities).toEqual([mockConfig, mockConfig2]);
      expect(newState.loading).toBe(false);
    });
  });

  describe('loadCloudInitConfigsFailure', () => {
    it('sets error and loading to false', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, loading: true };
      const newState = cloudInitConfigsReducer(state, loadCloudInitConfigsFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('loadCloudInitConfig', () => {
    it('sets loadingCloudInitConfig to true and clears error', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, error: 'Previous error' };
      const newState = cloudInitConfigsReducer(state, loadCloudInitConfig({ id: 'cfg-1' }));

      expect(newState.loadingCloudInitConfig).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadCloudInitConfigSuccess', () => {
    it('updates existing config in list and sets selectedCloudInitConfig', () => {
      const state: CloudInitConfigsState = {
        ...initialCloudInitConfigsState,
        entities: [mockConfig],
        loadingCloudInitConfig: true,
      };
      const updated = { ...mockConfig, name: 'Updated Name' };
      const newState = cloudInitConfigsReducer(state, loadCloudInitConfigSuccess({ cloudInitConfig: updated }));

      expect(newState.entities[0]).toEqual(updated);
      expect(newState.selectedCloudInitConfig).toEqual(updated);
      expect(newState.loadingCloudInitConfig).toBe(false);
    });

    it('appends config when not in list', () => {
      const state: CloudInitConfigsState = {
        ...initialCloudInitConfigsState,
        entities: [mockConfig],
        loadingCloudInitConfig: true,
      };
      const newState = cloudInitConfigsReducer(state, loadCloudInitConfigSuccess({ cloudInitConfig: mockConfig2 }));

      expect(newState.entities).toEqual([mockConfig, mockConfig2]);
      expect(newState.selectedCloudInitConfig).toEqual(mockConfig2);
    });
  });

  describe('loadCloudInitConfigFailure', () => {
    it('sets error and loadingCloudInitConfig to false', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, loadingCloudInitConfig: true };
      const newState = cloudInitConfigsReducer(state, loadCloudInitConfigFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loadingCloudInitConfig).toBe(false);
    });
  });

  describe('createCloudInitConfig', () => {
    it('sets creating to true and clears error', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, error: 'Previous error' };
      const newState = cloudInitConfigsReducer(state, createCloudInitConfig({ cloudInitConfig: {} as never }));

      expect(newState.creating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('createCloudInitConfigSuccess', () => {
    it('adds config and sets selectedCloudInitConfig', () => {
      const state: CloudInitConfigsState = {
        ...initialCloudInitConfigsState,
        entities: [mockConfig],
        creating: true,
      };
      const newState = cloudInitConfigsReducer(state, createCloudInitConfigSuccess({ cloudInitConfig: mockConfig2 }));

      expect(newState.entities).toContainEqual(mockConfig2);
      expect(newState.selectedCloudInitConfig).toEqual(mockConfig2);
      expect(newState.creating).toBe(false);
    });
  });

  describe('createCloudInitConfigFailure', () => {
    it('sets error and creating to false', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, creating: true };
      const newState = cloudInitConfigsReducer(state, createCloudInitConfigFailure({ error: 'Create failed' }));

      expect(newState.error).toBe('Create failed');
      expect(newState.creating).toBe(false);
    });
  });

  describe('updateCloudInitConfig', () => {
    it('sets updating to true and clears error', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, error: 'Previous error' };
      const newState = cloudInitConfigsReducer(state, updateCloudInitConfig({ id: 'cfg-1', cloudInitConfig: {} }));

      expect(newState.updating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('updateCloudInitConfigSuccess', () => {
    it('updates config in list and selectedCloudInitConfig', () => {
      const state: CloudInitConfigsState = {
        ...initialCloudInitConfigsState,
        entities: [mockConfig],
        selectedCloudInitConfig: mockConfig,
        updating: true,
      };
      const updated = { ...mockConfig, name: 'Updated Name' };
      const newState = cloudInitConfigsReducer(state, updateCloudInitConfigSuccess({ cloudInitConfig: updated }));

      expect(newState.entities[0]).toEqual(updated);
      expect(newState.selectedCloudInitConfig).toEqual(updated);
      expect(newState.updating).toBe(false);
    });

    it('keeps selectedCloudInitConfig when updating a different config', () => {
      const state: CloudInitConfigsState = {
        ...initialCloudInitConfigsState,
        entities: [mockConfig, mockConfig2],
        selectedCloudInitConfig: mockConfig,
        updating: true,
      };
      const updated = { ...mockConfig2, name: 'Updated Other' };
      const newState = cloudInitConfigsReducer(state, updateCloudInitConfigSuccess({ cloudInitConfig: updated }));

      expect(newState.entities[1]).toEqual(updated);
      expect(newState.selectedCloudInitConfig).toEqual(mockConfig);
    });
  });

  describe('updateCloudInitConfigFailure', () => {
    it('sets error and updating to false', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, updating: true };
      const newState = cloudInitConfigsReducer(state, updateCloudInitConfigFailure({ error: 'Update failed' }));

      expect(newState.error).toBe('Update failed');
      expect(newState.updating).toBe(false);
    });
  });

  describe('deleteCloudInitConfig', () => {
    it('sets deleting to true and clears error', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, error: 'Previous error' };
      const newState = cloudInitConfigsReducer(state, deleteCloudInitConfig({ id: 'cfg-1' }));

      expect(newState.deleting).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('deleteCloudInitConfigSuccess', () => {
    it('removes config and clears selected when matching', () => {
      const state: CloudInitConfigsState = {
        ...initialCloudInitConfigsState,
        entities: [mockConfig, mockConfig2],
        selectedCloudInitConfig: mockConfig,
        deleting: true,
      };
      const newState = cloudInitConfigsReducer(state, deleteCloudInitConfigSuccess({ id: 'cfg-1' }));

      expect(newState.entities).not.toContainEqual(mockConfig);
      expect(newState.selectedCloudInitConfig).toBeNull();
      expect(newState.deleting).toBe(false);
    });

    it('keeps selectedCloudInitConfig when deleting a different config', () => {
      const state: CloudInitConfigsState = {
        ...initialCloudInitConfigsState,
        entities: [mockConfig, mockConfig2],
        selectedCloudInitConfig: mockConfig,
        deleting: true,
      };
      const newState = cloudInitConfigsReducer(state, deleteCloudInitConfigSuccess({ id: 'cfg-2' }));

      expect(newState.entities).toEqual([mockConfig]);
      expect(newState.selectedCloudInitConfig).toEqual(mockConfig);
    });
  });

  describe('deleteCloudInitConfigFailure', () => {
    it('sets error and deleting to false', () => {
      const state: CloudInitConfigsState = { ...initialCloudInitConfigsState, deleting: true };
      const newState = cloudInitConfigsReducer(state, deleteCloudInitConfigFailure({ error: 'Delete failed' }));

      expect(newState.error).toBe('Delete failed');
      expect(newState.deleting).toBe(false);
    });
  });

  describe('clearSelectedCloudInitConfig', () => {
    it('clears selectedCloudInitConfig', () => {
      const state: CloudInitConfigsState = {
        ...initialCloudInitConfigsState,
        entities: [mockConfig],
        selectedCloudInitConfig: mockConfig,
      };
      const newState = cloudInitConfigsReducer(state, clearSelectedCloudInitConfig());

      expect(newState.selectedCloudInitConfig).toBeNull();
    });
  });
});
