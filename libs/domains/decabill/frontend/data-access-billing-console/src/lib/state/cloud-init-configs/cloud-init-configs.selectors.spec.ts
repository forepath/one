import { selectActiveCloudInitConfigs, selectCloudInitConfigsEntities } from './cloud-init-configs.selectors';
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
    },
  };

  it('selects all entities', () => {
    expect(selectCloudInitConfigsEntities(state)).toHaveLength(2);
  });

  it('selects active configs only', () => {
    expect(selectActiveCloudInitConfigs(state)).toHaveLength(1);
  });
});
