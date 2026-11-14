import {
  IntegratedProvisioningService,
  allIntegratedProvisioningServices,
  canonicalizeIntegratedProvisioningService,
  isIntegratedProvisioningService,
} from './integrated-provisioning-service';

export { IntegratedProvisioningService, CloudInitServiceType } from './integrated-provisioning-service';

/**
 * `none` provisions a bare server: no integrated stack and no admin CloudInit template.
 * Only the platform access key (and addon scripts) are delivered as user data.
 */
export type PlanProvisioningOption =
  | { type: 'integrated'; service: IntegratedProvisioningService }
  | { type: 'custom'; cloudInitConfigId: string }
  | { type: 'none' };

export interface ResolvedOrderProvisioningSelection {
  service: IntegratedProvisioningService | 'custom' | 'none';
  cloudInitConfigId?: string;
}

/** Option key and persisted service id for plans that provision a bare server. */
export const NO_PROVISIONING_OPTION_KEY = 'none';

export const DEFAULT_INTEGRATED_PROVISIONING_OPTIONS: PlanProvisioningOption[] =
  allIntegratedProvisioningServices().map((service) => ({ type: 'integrated' as const, service }));

export function encodeProvisioningOptionKey(option: PlanProvisioningOption): string {
  if (option.type === 'none') {
    return NO_PROVISIONING_OPTION_KEY;
  }

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

  if (trimmed === NO_PROVISIONING_OPTION_KEY) {
    return { type: 'none' };
  }

  if (trimmed.startsWith('integrated:')) {
    const rawService = trimmed.slice('integrated:'.length);
    const service = canonicalizeIntegratedProvisioningService(rawService);

    return service ? { type: 'integrated', service } : null;
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

  if (type === 'none') {
    return { type: 'none' };
  }

  if (type === 'integrated') {
    const service = entry['service'];

    if (typeof service === 'string') {
      const canonical = canonicalizeIntegratedProvisioningService(service);

      if (canonical) {
        return { type: 'integrated', service: canonical };
      }
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

  if (legacyService === NO_PROVISIONING_OPTION_KEY) {
    return [{ type: 'none' }];
  }

  if (typeof legacyService === 'string') {
    const integrated = canonicalizeIntegratedProvisioningService(legacyService);

    if (integrated) {
      return [{ type: 'integrated', service: integrated }];
    }
  }

  const customOptions = collectLegacyCustomProvisioningOptions(providerConfigDefaults);

  if (customOptions.length > 0) {
    return customOptions;
  }

  if (legacyService === 'custom') {
    return [];
  }

  return [{ type: 'integrated', service: IntegratedProvisioningService.AgenstraController }];
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
    integrated.some((option) => option.service === IntegratedProvisioningService.AgenstraController) &&
    integrated.some((option) => option.service === IntegratedProvisioningService.AgenstraManager)
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

    if (only.type === 'none') {
      normalized['service'] = NO_PROVISIONING_OPTION_KEY;
      delete normalized['cloudInitConfigId'];
    } else if (only.type === 'integrated') {
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
 *
 * Migration-only helper: it must never run on normal admin saves, otherwise it would
 * collapse legitimate multi-option selections (e.g. agenstra-controller + agenstra-manager) down to one.
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
      typeof legacyService === 'string'
        ? (canonicalizeIntegratedProvisioningService(legacyService) ?? IntegratedProvisioningService.AgenstraController)
        : IntegratedProvisioningService.AgenstraController;
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
  }

  // Trust the admin's explicit selection as-is. The over-backfill correction is a
  // one-time migration concern and must not collapse multi-option selections here.
  return applyProvisioningOptionsToDefaults(working, options);
}

function optionsMatchSelection(
  options: PlanProvisioningOption[],
  selection: ResolvedOrderProvisioningSelection,
): boolean {
  return options.some((option) => {
    if (selection.service === NO_PROVISIONING_OPTION_KEY) {
      return option.type === 'none';
    }

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

  if (typeof service !== 'string') {
    return null;
  }

  if (service === NO_PROVISIONING_OPTION_KEY) {
    return { service: NO_PROVISIONING_OPTION_KEY };
  }

  const integrated = canonicalizeIntegratedProvisioningService(service);

  if (integrated) {
    return { service: integrated };
  }

  if (service === 'custom') {
    const cloudInitConfigId = requestedConfig?.['cloudInitConfigId'];

    if (typeof cloudInitConfigId === 'string' && cloudInitConfigId.trim()) {
      return { service: 'custom', cloudInitConfigId: cloudInitConfigId.trim() };
    }
  }

  return null;
}

function toResolvedOrderProvisioningSelection(option: PlanProvisioningOption): ResolvedOrderProvisioningSelection {
  if (option.type === 'none') {
    return { service: NO_PROVISIONING_OPTION_KEY };
  }

  return option.type === 'custom'
    ? { service: 'custom', cloudInitConfigId: option.cloudInitConfigId }
    : { service: option.service };
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

    const selection = toResolvedOrderProvisioningSelection(parsed);

    if (!optionsMatchSelection(options, selection)) {
      throw new Error('Provisioning option is not available for this plan');
    }

    return selection;
  }

  if (options.length === 1) {
    return toResolvedOrderProvisioningSelection(options[0]);
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

export { isIntegratedProvisioningService, canonicalizeIntegratedProvisioningService };
