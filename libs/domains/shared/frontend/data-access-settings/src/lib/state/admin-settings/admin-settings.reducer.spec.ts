import type { SettingStateView, SettingsOverviewResponse } from '../../types/settings.types';

import {
  loadAdminSettings,
  loadAdminSettingsSuccess,
  resetAdminSettingSuccess,
  saveAdminSetting,
  saveAdminSettingFailure,
  saveAdminSettingSuccess,
} from './admin-settings.actions';
import { adminSettingsReducer, initialAdminSettingsState } from './admin-settings.reducer';

const setting = (overrides: Partial<SettingStateView> = {}): SettingStateView => ({
  key: 'SMTP_HOST',
  category: 'email',
  type: 'string',
  scope: 'tenant',
  sensitive: false,
  restartRequired: false,
  value: null,
  hasOverride: false,
  inheritedValue: 'mailhog',
  hasInheritedValue: true,
  inheritedSource: 'environment',
  effectiveSource: 'environment',
  ...overrides,
});
const overview: SettingsOverviewResponse = {
  level: 'tenant',
  tenantId: 'acme',
  homeTenantId: 'default',
  canManageGlobal: true,
  viewableTenants: ['default', 'acme'],
  categories: ['email'],
  settings: [setting()],
};

describe('adminSettingsReducer', () => {
  it('stores the overview and its target', () => {
    const loading = adminSettingsReducer(initialAdminSettingsState, loadAdminSettings({ target: null }));

    expect(loading.loading).toBe(true);

    const state = adminSettingsReducer(loading, loadAdminSettingsSuccess({ overview }));

    expect(state.loading).toBe(false);
    expect(state.overview).toBe(overview);
    expect(state.target).toEqual({ level: 'tenant', tenantId: 'acme' });
  });

  it('tracks pending writes and replaces the saved setting', () => {
    const loaded = adminSettingsReducer(initialAdminSettingsState, loadAdminSettingsSuccess({ overview }));
    const pending = adminSettingsReducer(loaded, saveAdminSetting({ key: 'SMTP_HOST', value: 'smtp.acme.test' }));

    expect(pending.pendingKeys).toEqual(['SMTP_HOST']);

    const saved = adminSettingsReducer(
      pending,
      saveAdminSettingSuccess({
        setting: setting({ value: 'smtp.acme.test', hasOverride: true, effectiveSource: 'tenant' }),
      }),
    );

    expect(saved.pendingKeys).toEqual([]);
    expect(saved.overview?.settings[0]).toMatchObject({ value: 'smtp.acme.test', hasOverride: true });

    const reset = adminSettingsReducer(saved, resetAdminSettingSuccess({ setting: setting() }));

    expect(reset.overview?.settings[0]).toMatchObject({ value: null, hasOverride: false });
  });

  it('keeps write errors per setting', () => {
    const loaded = adminSettingsReducer(initialAdminSettingsState, loadAdminSettingsSuccess({ overview }));
    const failed = adminSettingsReducer(
      adminSettingsReducer(loaded, saveAdminSetting({ key: 'SMTP_HOST', value: 'x' })),
      saveAdminSettingFailure({ key: 'SMTP_HOST', error: 'invalid' }),
    );

    expect(failed.pendingKeys).toEqual([]);
    expect(failed.settingErrors).toEqual({ SMTP_HOST: 'invalid' });
  });
});
