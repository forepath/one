import { WorkspaceConfigurationSettingKey } from '../constants/workspace-configuration-settings';

export type WorkspaceConfigurationValueSource = 'override' | 'default_env' | 'unset';

export class WorkspaceConfigurationSettingResponseDto {
  settingKey!: WorkspaceConfigurationSettingKey;
  envVarName!: string;
  value?: string;
  source!: WorkspaceConfigurationValueSource;
  hasOverride!: boolean;
}
