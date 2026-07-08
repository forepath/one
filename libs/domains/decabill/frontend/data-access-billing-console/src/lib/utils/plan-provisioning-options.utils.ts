import type { PlanProvisioningOption } from '../types/billing.types';

const INTEGRATED_SERVICES = new Set(['controller', 'manager']);

export const DEFAULT_INTEGRATED_PROVISIONING_OPTION_KEYS = ['integrated:controller', 'integrated:manager'] as const;

/** Display labels for integrated Agenstra stacks (match plan editor and provisioning API). */
export const INTEGRATED_CONTROLLER_SERVICE_LABEL = 'Agenstra Controller';
export const INTEGRATED_MANAGER_SERVICE_LABEL = 'Agenstra Manager';

export type IntegratedProvisioningService = 'controller' | 'manager';

export function integratedProvisioningServiceLabel(service: IntegratedProvisioningService): string {
  return service === 'manager' ? INTEGRATED_MANAGER_SERVICE_LABEL : INTEGRATED_CONTROLLER_SERVICE_LABEL;
}

export function encodeProvisioningOptionKey(option: PlanProvisioningOption): string {
  if (option.type === 'integrated') {
    return `integrated:${option.service}`;
  }

  return `custom:${option.cloudInitConfigId}`;
}

export function parseProvisioningOptionKey(key: string): PlanProvisioningOption | null {
  const trimmed = key?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('integrated:')) {
    const service = trimmed.slice('integrated:'.length);

    return INTEGRATED_SERVICES.has(service)
      ? { type: 'integrated', service: service as 'controller' | 'manager' }
      : null;
  }

  if (trimmed.startsWith('custom:')) {
    const cloudInitConfigId = trimmed.slice('custom:'.length).trim();

    return cloudInitConfigId ? { type: 'custom', cloudInitConfigId } : null;
  }

  return null;
}

function parseProvisioningOptionEntry(value: unknown): PlanProvisioningOption | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Record<string, unknown>;

  if (entry['type'] === 'integrated' && INTEGRATED_SERVICES.has(String(entry['service']))) {
    return { type: 'integrated', service: entry['service'] as 'controller' | 'manager' };
  }

  if (
    entry['type'] === 'custom' &&
    typeof entry['cloudInitConfigId'] === 'string' &&
    entry['cloudInitConfigId'].trim()
  ) {
    return { type: 'custom', cloudInitConfigId: entry['cloudInitConfigId'].trim() };
  }

  return null;
}

export function parsePlanProvisioningOptions(
  providerConfigDefaults: Record<string, unknown> | undefined,
): PlanProvisioningOption[] {
  if (!providerConfigDefaults) {
    return [];
  }

  const rawOptions = providerConfigDefaults['provisioningOptions'];

  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const result: PlanProvisioningOption[] = [];

  for (const entry of rawOptions) {
    const parsed = parseProvisioningOptionEntry(entry);

    if (!parsed) {
      continue;
    }

    const key = encodeProvisioningOptionKey(parsed);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(parsed);
  }

  return result;
}

function collectLegacyCustomProvisioningOptionKeys(providerConfigDefaults: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const legacyIds = providerConfigDefaults['cloudInitConfigIds'];

  if (Array.isArray(legacyIds)) {
    for (const id of legacyIds) {
      if (typeof id === 'string' && id.trim()) {
        keys.push(encodeProvisioningOptionKey({ type: 'custom', cloudInitConfigId: id.trim() }));
      }
    }
  }

  if (providerConfigDefaults['service'] === 'custom') {
    const cloudInitConfigId = providerConfigDefaults['cloudInitConfigId'];

    if (typeof cloudInitConfigId === 'string' && cloudInitConfigId.trim()) {
      keys.push(encodeProvisioningOptionKey({ type: 'custom', cloudInitConfigId: cloudInitConfigId.trim() }));
    }
  }

  return [...new Set(keys)];
}

function inferLegacyPlanProvisioningOptionKeys(providerConfigDefaults: Record<string, unknown> | undefined): string[] {
  if (!providerConfigDefaults) {
    return [];
  }

  const legacyService = providerConfigDefaults['service'];

  if (legacyService === 'manager' || legacyService === 'controller') {
    return [encodeProvisioningOptionKey({ type: 'integrated', service: legacyService })];
  }

  const customKeys = collectLegacyCustomProvisioningOptionKeys(providerConfigDefaults);

  if (customKeys.length > 0) {
    return customKeys;
  }

  if (legacyService === 'custom') {
    return [];
  }

  return [encodeProvisioningOptionKey({ type: 'integrated', service: 'controller' })];
}

export function resolvePlanProvisioningOptionKeys(
  providerConfigDefaults: Record<string, unknown> | undefined,
): string[] {
  const explicit = parsePlanProvisioningOptions(providerConfigDefaults).map((option) =>
    encodeProvisioningOptionKey(option),
  );

  if (explicit.length > 0) {
    return explicit;
  }

  return inferLegacyPlanProvisioningOptionKeys(providerConfigDefaults);
}

export function planProvisioningOptionKeysFromDefaults(
  providerConfigDefaults: Record<string, unknown> | undefined,
): string[] {
  return resolvePlanProvisioningOptionKeys(providerConfigDefaults);
}

export function buildProvisioningOptionsFromKeys(keys: Iterable<string>): PlanProvisioningOption[] {
  const options: PlanProvisioningOption[] = [];

  for (const key of keys) {
    const parsed = parseProvisioningOptionKey(key);

    if (parsed) {
      options.push(parsed);
    }
  }

  return options;
}
