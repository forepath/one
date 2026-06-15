import {
  loadWorkspaceConfigurationOverrides,
  loadWorkspaceConfigurationOverridesSuccess,
  upsertWorkspaceConfigurationOverrideSuccess,
} from './workspace-config.actions';
import { initialWorkspaceConfigState, workspaceConfigReducer } from './workspace-config.reducer';

describe('workspaceConfigReducer', () => {
  it('sets loading on load action', () => {
    const state = workspaceConfigReducer(
      initialWorkspaceConfigState,
      loadWorkspaceConfigurationOverrides({ clientId: 'c1' }),
    );

    expect(state.loading['c1']).toBe(true);
  });

  it('stores loaded settings', () => {
    const state = workspaceConfigReducer(
      initialWorkspaceConfigState,
      loadWorkspaceConfigurationOverridesSuccess({
        clientId: 'c1',
        settings: [{ settingKey: 'gitToken', envVarName: 'GIT_TOKEN', source: 'unset', hasOverride: false }],
      }),
    );

    expect(state.settingsByClient['c1']).toHaveLength(1);
  });

  it('upserts returned setting', () => {
    const state = workspaceConfigReducer(
      {
        ...initialWorkspaceConfigState,
        settingsByClient: {
          c1: [{ settingKey: 'gitToken', envVarName: 'GIT_TOKEN', source: 'unset', hasOverride: false }],
        },
      },
      upsertWorkspaceConfigurationOverrideSuccess({
        clientId: 'c1',
        setting: {
          settingKey: 'gitToken',
          envVarName: 'GIT_TOKEN',
          source: 'override',
          hasOverride: true,
          value: 'abc',
        },
      }),
    );

    expect(state.settingsByClient['c1'][0].source).toBe('override');
  });
});
