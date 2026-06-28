import {
  selectActiveCloudInitConfigs,
  selectCloudInitConfigById,
  selectCloudInitConfigLoading,
  selectCloudInitConfigsCreating,
  selectCloudInitConfigsDeleting,
  selectCloudInitConfigsEntities,
  selectCloudInitConfigsError,
  selectCloudInitConfigsLoading,
  selectCloudInitConfigsLoadingAny,
  selectCloudInitConfigsUpdating,
  selectSelectedCloudInitConfig,
} from './cloud-init-configs.selectors';
import { initialCloudInitConfigsState } from './cloud-init-configs.reducer';

describe('cloudInitConfigsSelectors', () => {
  const state = {
    cloudInitConfigs: {
      ...initialCloudInitConfigsState,
      entities: [
        {
          id: '1',
          key: 'a',
          name: 'Active',
          provisioningMode: 'simple' as const,
          dockerImage: 'img',
          containerPort: 8080,
          hostPort: 80,
          workDir: '/opt/custom-app',
          environmentVariables: [],
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '2',
          key: 'b',
          name: 'Inactive',
          provisioningMode: 'simple' as const,
          dockerImage: 'img',
          containerPort: 8080,
          hostPort: 80,
          workDir: '/opt/custom-app',
          environmentVariables: [],
          isActive: false,
          createdAt: '',
          updatedAt: '',
        },
      ],
      selectedCloudInitConfig: {
        id: '1',
        key: 'a',
        name: 'Active',
        provisioningMode: 'simple' as const,
        dockerImage: 'img',
        containerPort: 8080,
        hostPort: 80,
        workDir: '/opt/custom-app',
        environmentVariables: [],
        isActive: true,
        createdAt: '',
        updatedAt: '',
      },
      loading: true,
      loadingCloudInitConfig: false,
      creating: false,
      updating: false,
      deleting: false,
      error: 'Load failed',
    },
  };

  it('selects all entities', () => {
    expect(selectCloudInitConfigsEntities(state)).toHaveLength(2);
  });

  it('selects active configs only', () => {
    expect(selectActiveCloudInitConfigs(state)).toHaveLength(1);
  });

  it('selects selected config', () => {
    expect(selectSelectedCloudInitConfig(state)?.id).toBe('1');
  });

  it('selects loading flags', () => {
    expect(selectCloudInitConfigsLoading(state)).toBe(true);
    expect(selectCloudInitConfigLoading(state)).toBe(false);
    expect(selectCloudInitConfigsCreating(state)).toBe(false);
    expect(selectCloudInitConfigsUpdating(state)).toBe(false);
    expect(selectCloudInitConfigsDeleting(state)).toBe(false);
  });

  it('selects loading any', () => {
    expect(selectCloudInitConfigsLoadingAny(state)).toBe(true);
  });

  it('selects error', () => {
    expect(selectCloudInitConfigsError(state)).toBe('Load failed');
  });

  it('selects config by id', () => {
    expect(selectCloudInitConfigById('2')(state)?.name).toBe('Inactive');
  });
});
