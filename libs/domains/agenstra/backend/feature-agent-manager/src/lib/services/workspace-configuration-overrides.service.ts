import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';

import {
  isWorkspaceConfigurationSettingKey,
  WORKSPACE_CONFIGURATION_ENV_BY_SETTING,
  WORKSPACE_CONFIGURATION_SETTINGS,
  WorkspaceConfigurationSettingKey,
} from '../constants/workspace-configuration-settings';
import {
  WorkspaceConfigurationSettingResponseDto,
  WorkspaceConfigurationValueSource,
} from '../dto/workspace-configuration-setting-response.dto';
import { WorkspaceConfigurationOverridesRepository } from '../repositories/workspace-configuration-overrides.repository';

import { AgentEnvironmentVariablesService } from './agent-environment-variables.service';

@Injectable()
export class WorkspaceConfigurationOverridesService implements OnModuleInit {
  constructor(
    private readonly repository: WorkspaceConfigurationOverridesRepository,
    private readonly agentEnvironmentVariablesService: AgentEnvironmentVariablesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.applyOverridesToProcessEnv();
  }

  async getEffectiveSettings(): Promise<WorkspaceConfigurationSettingResponseDto[]> {
    const overrides = await this.repository.findAll();
    const overrideByKey = new Map(overrides.map((entry) => [entry.settingKey, entry.value]));

    return WORKSPACE_CONFIGURATION_SETTINGS.map((setting) => {
      const overrideValue = overrideByKey.get(setting.settingKey);
      const defaultValue = process.env[setting.envVarName];
      const value = overrideValue ?? defaultValue;
      let source: WorkspaceConfigurationValueSource = 'unset';

      if (overrideValue !== undefined) {
        source = 'override';
      } else if (defaultValue !== undefined) {
        source = 'default_env';
      }

      return {
        settingKey: setting.settingKey,
        envVarName: setting.envVarName,
        value,
        source,
        hasOverride: overrideValue !== undefined,
      };
    });
  }

  async upsertOverride(settingKeyRaw: string, value: string): Promise<WorkspaceConfigurationSettingResponseDto> {
    const settingKey = this.validateSettingKey(settingKeyRaw);
    const envVarName = WORKSPACE_CONFIGURATION_ENV_BY_SETTING[settingKey];
    let storedValue = value;

    if (settingKey === 'autoEnrichEnabledGlobal') {
      const normalized = value.trim().toLowerCase();

      if (normalized !== 'true' && normalized !== 'false') {
        throw new BadRequestException('autoEnrichEnabledGlobal must be "true" or "false"');
      }

      storedValue = normalized;
    }

    if (settingKey === 'autoEnrichVectorMaxCosineDistance') {
      const trimmed = value.trim();
      const parsed = Number.parseFloat(trimmed);

      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
        throw new BadRequestException('autoEnrichVectorMaxCosineDistance must be a number between 0 and 2');
      }

      storedValue = trimmed;
    }

    await this.repository.upsert(settingKey, storedValue);
    process.env[envVarName] = storedValue;
    await this.agentEnvironmentVariablesService.reconcileWorkspaceConfigurationOverrides({
      [envVarName]: storedValue,
    });

    return {
      settingKey,
      envVarName,
      value: storedValue,
      source: 'override',
      hasOverride: true,
    };
  }

  async deleteOverride(settingKeyRaw: string): Promise<void> {
    const settingKey = this.validateSettingKey(settingKeyRaw);
    const envVarName = WORKSPACE_CONFIGURATION_ENV_BY_SETTING[settingKey];

    await this.repository.deleteBySettingKey(settingKey);
    delete process.env[envVarName];
    await this.agentEnvironmentVariablesService.reconcileWorkspaceConfigurationOverrides({ [envVarName]: undefined });
  }

  private validateSettingKey(settingKeyRaw: string): WorkspaceConfigurationSettingKey {
    if (!isWorkspaceConfigurationSettingKey(settingKeyRaw)) {
      throw new BadRequestException(`Unsupported setting key: ${settingKeyRaw}`);
    }

    return settingKeyRaw;
  }

  private async applyOverridesToProcessEnv(): Promise<void> {
    const overrides = await this.repository.findAll();

    for (const override of overrides) {
      if (!isWorkspaceConfigurationSettingKey(override.settingKey)) {
        continue;
      }

      const envVarName = WORKSPACE_CONFIGURATION_ENV_BY_SETTING[override.settingKey];

      process.env[envVarName] = override.value;
    }
  }
}
