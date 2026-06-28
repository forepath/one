import { cloudInitConfigsReducer, initialCloudInitConfigsState } from './cloud-init-configs.reducer';
import { createCloudInitConfigSuccess, loadCloudInitConfigsSuccess } from './cloud-init-configs.actions';

describe('cloudInitConfigsReducer', () => {
  it('stores loaded configs', () => {
    const state = cloudInitConfigsReducer(
      initialCloudInitConfigsState,
      loadCloudInitConfigsSuccess({
        cloudInitConfigs: [
          {
            id: 'cfg-1',
            key: 'app',
            name: 'App',
            dockerImage: 'nginx',
            containerPort: 8080,
            hostPort: 80,
            workDir: '/opt/custom-app',
            environmentVariables: [],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );

    expect(state.entities).toHaveLength(1);
    expect(state.loading).toBe(false);
  });

  it('appends created config', () => {
    const state = cloudInitConfigsReducer(
      initialCloudInitConfigsState,
      createCloudInitConfigSuccess({
        cloudInitConfig: {
          id: 'cfg-2',
          key: 'new',
          name: 'New',
          dockerImage: 'nginx',
          containerPort: 8080,
          hostPort: 80,
          workDir: '/opt/custom-app',
          environmentVariables: [],
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      }),
    );

    expect(state.entities).toHaveLength(1);
    expect(state.creating).toBe(false);
  });
});
