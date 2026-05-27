export const WORKSPACE_CONFIGURATION_SETTINGS = [
  { settingKey: 'gitRepositorySetupMode', envVarName: 'GIT_REPOSITORY_SETUP_MODE' },
  { settingKey: 'gitRepositoryUrl', envVarName: 'GIT_REPOSITORY_URL' },
  { settingKey: 'gitUsername', envVarName: 'GIT_USERNAME' },
  { settingKey: 'gitToken', envVarName: 'GIT_TOKEN' },
  { settingKey: 'gitPassword', envVarName: 'GIT_PASSWORD' },
  { settingKey: 'gitPrivateKey', envVarName: 'GIT_PRIVATE_KEY' },
  { settingKey: 'cursorApiKey', envVarName: 'CURSOR_API_KEY' },
  { settingKey: 'agentDefaultImage', envVarName: 'AGENT_DEFAULT_IMAGE' },
  { settingKey: 'autoEnrichEnabledGlobal', envVarName: 'AUTO_ENRICH_ENABLED_GLOBAL' },
  {
    settingKey: 'autoEnrichVectorMaxCosineDistance',
    envVarName: 'AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE',
  },
] as const;

export type WorkspaceConfigurationSetting = (typeof WORKSPACE_CONFIGURATION_SETTINGS)[number];
export type WorkspaceConfigurationSettingKey = WorkspaceConfigurationSetting['settingKey'];

export const WORKSPACE_CONFIGURATION_ENV_BY_SETTING: Readonly<Record<WorkspaceConfigurationSettingKey, string>> =
  Object.freeze(
    WORKSPACE_CONFIGURATION_SETTINGS.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.settingKey] = entry.envVarName;

      return acc;
    }, {}) as Record<WorkspaceConfigurationSettingKey, string>,
  );

export function isWorkspaceConfigurationSettingKey(value: string): value is WorkspaceConfigurationSettingKey {
  return value in WORKSPACE_CONFIGURATION_ENV_BY_SETTING;
}
