export type IntegratedProvisioningService = 'controller' | 'manager';

export type PlanProvisioningOption =
  | { type: 'integrated'; service: IntegratedProvisioningService }
  | { type: 'custom'; cloudInitConfigId: string };

export interface ResolvedOrderProvisioningSelection {
  service: 'controller' | 'manager' | 'custom';
  cloudInitConfigId?: string;
}

export const DEFAULT_INTEGRATED_PROVISIONING_OPTIONS: PlanProvisioningOption[] = [
  { type: 'integrated', service: 'controller' },
  { type: 'integrated', service: 'manager' },
];

const INTEGRATED_SERVICES = new Set<IntegratedProvisioningService>(['controller', 'manager']);

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
    const service = trimmed.slice('integrated:'.length) as IntegratedProvisioningService;

    return INTEGRATED_SERVICES.has(service) ? { type: 'integrated', service } : null;
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
  const type = entry['type'];

  if (type === 'integrated') {
    const service = entry['service'];

    if (typeof service === 'string' && INTEGRATED_SERVICES.has(service as IntegratedProvisioningService)) {
      return { type: 'integrated', service: service as IntegratedProvisioningService };
    }

    return null;
  }

  if (type === 'custom') {
    const cloudInitConfigId = entry['cloudInitConfigId'];

    if (typeof cloudInitConfigId === 'string' && cloudInitConfigId.trim()) {
      return { type: 'custom', cloudInitConfigId: cloudInitConfigId.trim() };
    }

    return null;
  }

  return null;
}

function dedupeOptions(options: PlanProvisioningOption[]): PlanProvisioningOption[] {
  const seen = new Set<string>();
  const result: PlanProvisioningOption[] = [];

  for (const option of options) {
    const key = encodeProvisioningOptionKey(option);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(option);
  }

  return result;
}

function parseExplicitProvisioningOptionsArray(rawOptions: unknown): PlanProvisioningOption[] {
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return [];
  }

  const parsed = rawOptions
    .map((entry) => parseProvisioningOptionEntry(entry))
    .filter((entry): entry is PlanProvisioningOption => entry !== null);

  return dedupeOptions(parsed);
}

/**
 * Reads plan provisioning options from providerConfigDefaults.provisioningOptions only.
 */
export function parsePlanProvisioningOptions(
  providerConfigDefaults: Record<string, unknown> | undefined,
): PlanProvisioningOption[] {
  if (!providerConfigDefaults) {
    return [];
  }

  return parseExplicitProvisioningOptionsArray(providerConfigDefaults['provisioningOptions']);
}

export function planHasCustomerProvisioningChoice(
  providerConfigDefaults: Record<string, unknown> | undefined,
): boolean {
  return resolvePlanProvisioningOptions(providerConfigDefaults).length > 1;
}

function inferLegacyPlanProvisioningOptions(
  providerConfigDefaults: Record<string, unknown> | undefined,
): PlanProvisioningOption[] {
  if (!providerConfigDefaults) {
    return [];
  }

  const legacyService = providerConfigDefaults['service'];

  if (legacyService === 'manager' || legacyService === 'controller') {
    return [{ type: 'integrated', service: legacyService }];
  }

  const customOptions = collectLegacyCustomProvisioningOptions(providerConfigDefaults);

  if (customOptions.length > 0) {
    return customOptions;
  }

  if (legacyService === 'custom') {
    return [];
  }

  return [{ type: 'integrated', service: 'controller' }];
}

/**
 * Reads explicit provisioningOptions, falling back to legacy service/custom fields when absent.
 */
export function resolvePlanProvisioningOptions(
  providerConfigDefaults: Record<string, unknown> | undefined,
): PlanProvisioningOption[] {
  const explicit = parsePlanProvisioningOptions(providerConfigDefaults);

  if (explicit.length > 0) {
    return explicit;
  }

  return inferLegacyPlanProvisioningOptions(providerConfigDefaults);
}

function collectLegacyCustomProvisioningOptions(
  providerConfigDefaults: Record<string, unknown>,
): PlanProvisioningOption[] {
  const options: PlanProvisioningOption[] = [];
  const legacyIds = providerConfigDefaults['cloudInitConfigIds'];

  if (Array.isArray(legacyIds)) {
    for (const id of legacyIds) {
      if (typeof id === 'string' && id.trim()) {
        options.push({ type: 'custom', cloudInitConfigId: id.trim() });
      }
    }
  }

  if (providerConfigDefaults['service'] === 'custom') {
    const cloudInitConfigId = providerConfigDefaults['cloudInitConfigId'];

    if (typeof cloudInitConfigId === 'string' && cloudInitConfigId.trim()) {
      options.push({ type: 'custom', cloudInitConfigId: cloudInitConfigId.trim() });
    }
  }

  return dedupeOptions(options);
}

/**
 * One-time migration helper for legacy service plans without explicit provisioningOptions.
 */
function hasBothIntegratedOptions(options: PlanProvisioningOption[]): boolean {
  const integrated = options.filter(
    (option): option is Extract<PlanProvisioningOption, { type: 'integrated' }> => option.type === 'integrated',
  );

  return (
    integrated.some((option) => option.service === 'controller') &&
    integrated.some((option) => option.service === 'manager')
  );
}

function applyProvisioningOptionsToDefaults(
  providerConfigDefaults: Record<string, unknown>,
  options: PlanProvisioningOption[],
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...providerConfigDefaults };

  if (options.length === 0) {
    delete normalized['provisioningOptions'];
    delete normalized['service'];
    delete normalized['cloudInitConfigId'];
    delete normalized['cloudInitConfigIds'];

    return normalized;
  }

  normalized['provisioningOptions'] = options;

  if (options.length === 1) {
    const only = options[0];

    if (only.type === 'integrated') {
      normalized['service'] = only.service;
      delete normalized['cloudInitConfigId'];
    } else {
      normalized['service'] = 'custom';
      normalized['cloudInitConfigId'] = only.cloudInitConfigId;
    }

    delete normalized['cloudInitConfigIds'];
  } else {
    delete normalized['service'];
    delete normalized['cloudInitConfigId'];
    delete normalized['cloudInitConfigIds'];
  }

  return normalized;
}

/**
 * Corrects rows touched by the initial dual-option backfill when legacy metadata still
 * implies a single integrated or custom-only plan.
 */
export function correctOverBackfilledProvisioningOptions(
  providerConfigDefaults: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!providerConfigDefaults) {
    return undefined;
  }

  const options = parsePlanProvisioningOptions(providerConfigDefaults);

  if (options.length === 0) {
    return undefined;
  }

  const legacyService = providerConfigDefaults['service'];
  const customOptions = options.filter(
    (option): option is Extract<PlanProvisioningOption, { type: 'custom' }> => option.type === 'custom',
  );
  const bothIntegrated = hasBothIntegratedOptions(options);

  if (bothIntegrated && customOptions.length > 0) {
    return applyProvisioningOptionsToDefaults(
      { ...providerConfigDefaults, provisioningOptions: customOptions },
      customOptions,
    );
  }

  if (bothIntegrated && customOptions.length === 0 && options.length === 2) {
    const resolvedService: IntegratedProvisioningService =
      legacyService === 'manager' || legacyService === 'controller' ? legacyService : 'controller';
    const singleOption: PlanProvisioningOption[] = [{ type: 'integrated', service: resolvedService }];

    return applyProvisioningOptionsToDefaults(
      { ...providerConfigDefaults, provisioningOptions: singleOption },
      singleOption,
    );
  }

  return undefined;
}

export function migrateLegacyPlanProviderConfigDefaults(
  providerConfigDefaults: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!providerConfigDefaults) {
    return undefined;
  }

  const existing = parsePlanProvisioningOptions(providerConfigDefaults);

  if (existing.length > 0) {
    return providerConfigDefaults;
  }

  const options = inferLegacyPlanProvisioningOptions(providerConfigDefaults);

  if (options.length === 0) {
    return providerConfigDefaults;
  }

  return applyProvisioningOptionsToDefaults({ ...providerConfigDefaults, provisioningOptions: options }, options);
}

/**
 * Idempotently repairs plan defaults for persistence (legacy fields, bad backfills, normalization).
 */
export function reconcilePlanProviderConfigDefaults(
  providerConfigDefaults: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return normalizePlanProviderConfigDefaults(providerConfigDefaults);
}

/**
 * Normalizes provider defaults for persistence, promoting legacy fields when explicit options are absent.
 */
export function normalizePlanProviderConfigDefaults(
  providerConfigDefaults: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!providerConfigDefaults) {
    return undefined;
  }

  let working: Record<string, unknown> = { ...providerConfigDefaults };
  let options = parsePlanProvisioningOptions(working);

  if (options.length === 0) {
    options = inferLegacyPlanProvisioningOptions(working);

    if (options.length > 0) {
      working = { ...working, provisioningOptions: options };
    }
  } else {
    const corrected = correctOverBackfilledProvisioningOptions(working);

    if (corrected) {
      return corrected;
    }
  }

  return applyProvisioningOptionsToDefaults(working, options);
}

function optionsMatchSelection(
  options: PlanProvisioningOption[],
  selection: ResolvedOrderProvisioningSelection,
): boolean {
  return options.some((option) => {
    if (selection.service === 'custom') {
      return option.type === 'custom' && option.cloudInitConfigId === selection.cloudInitConfigId;
    }

    return option.type === 'integrated' && option.service === selection.service;
  });
}

function resolveLegacyRequestedProvisioningSelection(
  requestedConfig: Record<string, unknown> | undefined,
): ResolvedOrderProvisioningSelection | null {
  const service = requestedConfig?.['service'];

  if (service === 'manager' || service === 'controller') {
    return { service };
  }

  if (service === 'custom') {
    const cloudInitConfigId = requestedConfig?.['cloudInitConfigId'];

    if (typeof cloudInitConfigId === 'string' && cloudInitConfigId.trim()) {
      return { service: 'custom', cloudInitConfigId: cloudInitConfigId.trim() };
    }
  }

  return null;
}

/**
 * Resolves and validates the customer's provisioning choice against plan options.
 */
export function resolveOrderProvisioningSelection(
  providerConfigDefaults: Record<string, unknown> | undefined,
  requestedConfig: Record<string, unknown> | undefined,
): ResolvedOrderProvisioningSelection {
  const options = resolvePlanProvisioningOptions(providerConfigDefaults);

  if (options.length === 0) {
    throw new Error('Plan has no provisioning options configured');
  }

  const requestedKey = requestedConfig?.['provisioningOptionKey'];

  if (typeof requestedKey === 'string' && requestedKey.trim()) {
    const parsed = parseProvisioningOptionKey(requestedKey);

    if (!parsed) {
      throw new Error('Invalid provisioning option');
    }

    const selection: ResolvedOrderProvisioningSelection =
      parsed.type === 'custom'
        ? { service: 'custom', cloudInitConfigId: parsed.cloudInitConfigId }
        : { service: parsed.service };

    if (!optionsMatchSelection(options, selection)) {
      throw new Error('Provisioning option is not available for this plan');
    }

    return selection;
  }

  if (options.length === 1) {
    const only = options[0];

    return only.type === 'custom'
      ? { service: 'custom', cloudInitConfigId: only.cloudInitConfigId }
      : { service: only.service };
  }

  const legacySelection = resolveLegacyRequestedProvisioningSelection(requestedConfig);

  if (legacySelection && optionsMatchSelection(options, legacySelection)) {
    return legacySelection;
  }

  throw new Error('provisioningOptionKey is required when the plan offers multiple provisioning options');
}

export function collectCustomCloudInitConfigIdsFromPlanDefaults(
  providerConfigDefaults: Record<string, unknown> | undefined,
): string[] {
  return resolvePlanProvisioningOptions(providerConfigDefaults)
    .filter((option): option is Extract<PlanProvisioningOption, { type: 'custom' }> => option.type === 'custom')
    .map((option) => option.cloudInitConfigId);
}

const ADMIN_ONLY_PROVISIONING_KEYS = ['provisioningOptions', 'provisioningOptionKey', 'cloudInitConfigIds'] as const;

/**
 * Applies the resolved customer provisioning choice onto the merged effective config.
 */
export function applyResolvedProvisioningSelectionToConfig(
  effectiveConfig: Record<string, unknown>,
  selection: ResolvedOrderProvisioningSelection,
): void {
  for (const key of ADMIN_ONLY_PROVISIONING_KEYS) {
    delete effectiveConfig[key];
  }

  effectiveConfig['service'] = selection.service;

  if (selection.cloudInitConfigId) {
    effectiveConfig['cloudInitConfigId'] = selection.cloudInitConfigId;
  } else {
    delete effectiveConfig['cloudInitConfigId'];
  }
}
