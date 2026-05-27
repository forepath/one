export type WorkspaceConfigurationSettingKey =
  | 'gitRepositorySetupMode'
  | 'gitRepositoryUrl'
  | 'gitUsername'
  | 'gitToken'
  | 'gitPassword'
  | 'gitPrivateKey'
  | 'cursorApiKey'
  | 'agentDefaultImage'
  | 'autoEnrichEnabledGlobal'
  | 'autoEnrichVectorMaxCosineDistance';

export type WorkspaceConfigurationValueSource = 'override' | 'default_env' | 'unset';

export interface WorkspaceConfigurationSettingResponseDto {
  settingKey: WorkspaceConfigurationSettingKey;
  envVarName: string;
  value?: string;
  source: WorkspaceConfigurationValueSource;
  hasOverride: boolean;
}

export interface UpsertWorkspaceConfigurationOverrideDto {
  value: string;
}
