import { BadRequestException } from '@nestjs/common';

import type { CloudInitConfigOrderFieldDto } from '../dto/cloud-init-config-response.dto';
import type { CloudInitConfigEnvVariableDefinition } from '../entities/cloud-init-config.entity';
import { CloudInitTemplateContext, interpolateCloudInitTemplate } from './cloud-init/template-interpolation.utils';
import { generateSecureRandomString, normalizeRandomDefaultLength } from './generate-secure-random.utils';

const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export type AddonConfigFieldDefinition = Omit<CloudInitConfigEnvVariableDefinition, 'hasDefault'> & {
  hasDefault?: boolean;
  /**
   * Admin-only secret of a module addon (e.g. an API token the module uses from the catalog defaults): never copied
   * into a subscription addon's `configSnapshot` and never settable by customers. Module `configFields` only.
   */
  adminOnly?: boolean;
};

export interface AddonConfigSchema {
  environmentVariables: CloudInitConfigEnvVariableDefinition[];
}

export interface SanitizedAddonConfigResult {
  configSchema: AddonConfigSchema;
  configDefaultValues: Record<string, string>;
}

export function parseAddonConfigFields(
  schema: Record<string, unknown> | null | undefined,
): AddonConfigFieldDefinition[] {
  const raw = schema?.['environmentVariables'];

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is AddonConfigFieldDefinition => Boolean(item) && typeof item === 'object');
}

export function sanitizeAddonConfigFields(
  defs: AddonConfigFieldDefinition[] | undefined,
  defaultValues: Record<string, string> | undefined,
): SanitizedAddonConfigResult {
  const sanitizedDefaults: Record<string, string> = {};
  const seenKeys = new Set<string>();
  const environmentVariables: CloudInitConfigEnvVariableDefinition[] = [];

  for (const raw of defs ?? []) {
    const key = raw.key?.trim() ?? '';
    const label = raw.label?.trim() ?? '';

    if (!key || !label) {
      continue;
    }

    if (!ENV_KEY_PATTERN.test(key)) {
      throw new BadRequestException(`Invalid addon config key "${key}": must match ${ENV_KEY_PATTERN.source}`);
    }

    if (seenKeys.has(key)) {
      throw new BadRequestException(`Duplicate addon config key: ${key}`);
    }

    seenKeys.add(key);

    const useRandomDefault = raw.useRandomDefault === true;
    const defaultValue = useRandomDefault ? undefined : defaultValues?.[key]?.trim();

    environmentVariables.push({
      key,
      label,
      description: raw.description?.trim() || undefined,
      showInOrderForm: raw.showInOrderForm === true,
      hasDefault: Boolean(defaultValue) || useRandomDefault,
      ...(useRandomDefault
        ? {
            useRandomDefault: true,
            randomDefaultLength: normalizeRandomDefaultLength(raw.randomDefaultLength),
            randomDefaultSpecialChars: raw.randomDefaultSpecialChars === true,
          }
        : {}),
    });

    if (defaultValue) {
      sanitizedDefaults[key] = defaultValue;
    }
  }

  for (const [key, value] of Object.entries(defaultValues ?? {})) {
    if (!seenKeys.has(key) && value?.trim()) {
      throw new BadRequestException(`Default value provided for unknown addon config key: ${key}`);
    }
  }

  return {
    configSchema: { environmentVariables },
    configDefaultValues: sanitizedDefaults,
  };
}

/**
 * Merge order: admin defaults → customer overrides (allowlisted) → random fill → require all keys.
 */
export function resolveAddonConfigValues(
  fields: CloudInitConfigEnvVariableDefinition[],
  adminDefaults: Record<string, string> | undefined,
  requestedConfig: Record<string, unknown> | undefined,
): Record<string, string> {
  const declaredKeys = new Set(fields.map((def) => def.key));
  const resolved: Record<string, string> = {};

  for (const def of fields) {
    const defaultValue = adminDefaults?.[def.key]?.trim();

    if (defaultValue) {
      resolved[def.key] = defaultValue;
    }
  }

  for (const [key, value] of Object.entries(requestedConfig ?? {})) {
    if (!declaredKeys.has(key)) {
      throw new BadRequestException(`Unknown addon config key: ${key}`);
    }

    if (value === undefined || value === null) {
      continue;
    }

    const strValue = String(value).trim();

    if (strValue.length > 0) {
      resolved[key] = strValue;
    }
  }

  for (const def of fields) {
    const currentValue = resolved[def.key];

    if ((!currentValue || currentValue.trim().length === 0) && def.useRandomDefault) {
      resolved[def.key] = generateSecureRandomString(
        normalizeRandomDefaultLength(def.randomDefaultLength),
        def.randomDefaultSpecialChars === true,
      );
    }
  }

  const missing: string[] = [];

  for (const def of fields) {
    const value = resolved[def.key];

    if (!value || value.trim().length === 0) {
      missing.push(def.key);
    }
  }

  if (missing.length > 0) {
    throw new BadRequestException(`Missing required addon config values: ${missing.join(', ')}`);
  }

  return resolved;
}

export function getAddonOrderFields(fields: CloudInitConfigEnvVariableDefinition[]): CloudInitConfigOrderFieldDto[] {
  return fields
    .filter((def) => def.showInOrderForm)
    .map((def) => ({
      key: def.key,
      label: def.label,
      description: def.description ?? null,
      required: !def.hasDefault,
      hasDefault: def.hasDefault === true,
    }));
}

export function mergeAddonDefaultValues(
  existing: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
  allowedKeys: Set<string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...(existing ?? {}) };

  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (!allowedKeys.has(key)) {
      if (value?.trim()) {
        throw new BadRequestException(`Default value provided for unknown addon config key: ${key}`);
      }

      continue;
    }

    const trimmed = value?.trim() ?? '';

    if (trimmed.length === 0) {
      delete merged[key];
    } else {
      merged[key] = trimmed;
    }
  }

  return merged;
}

export function interpolateAddonScriptTemplate(
  scriptTemplate: string,
  env: Record<string, string>,
  allowedEnvKeys: string[],
): string {
  const context: CloudInitTemplateContext = {
    hostname: 'addon-host',
    fqdn: 'addon-host.example.com',
    workDir: '/opt/addon',
    sshPublicKey: '',
    dockerImage: '',
    containerPort: 0,
    hostPort: 0,
    environment: env,
  };

  return interpolateCloudInitTemplate(scriptTemplate, context, allowedEnvKeys, 'shell');
}

export function assertAddonConfigsMatchSelection(
  addonIds: string[],
  addonConfigs: Record<string, Record<string, string>> | undefined,
): void {
  if (!addonConfigs) {
    return;
  }

  const selected = new Set(addonIds);

  for (const addonId of Object.keys(addonConfigs)) {
    if (!selected.has(addonId)) {
      throw new BadRequestException(`addonConfigs includes addon ${addonId} which is not in addonIds`);
    }
  }
}
