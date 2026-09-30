import type { OpencodeBuiltinProvider, OpencodeBuiltinProviderModel } from './types';

/**
 * Looks up a provider by id (case-sensitive) within `catalog`.
 */
export function getBuiltinProvider(
  catalog: readonly OpencodeBuiltinProvider[],
  id: string,
): OpencodeBuiltinProvider | undefined {
  const normalized = id.trim();

  if (!normalized) {
    return undefined;
  }

  return catalog.find((provider) => provider.id === normalized);
}

/**
 * Returns catalog providers whose ids are not already present in `existingKeys`.
 */
export function unusedBuiltinProviders(
  catalog: readonly OpencodeBuiltinProvider[],
  existingKeys: string[],
): OpencodeBuiltinProvider[] {
  const used = new Set(existingKeys.map((key) => key.trim()).filter((key) => key.length > 0));

  return catalog.filter((provider) => !used.has(provider.id));
}

/** Formats a provider/model allow-deny reference (`providerId/modelId`). */
export function formatProviderModelRef(providerId: string, modelId: string): string {
  return `${providerId.trim()}/${modelId.trim()}`;
}

/**
 * Parses a `providerId/modelId` reference. Uses the first `/` as separator.
 * Returns `null` when either side is empty.
 */
export function parseProviderModelRef(ref: string): { providerId: string; modelId: string } | null {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf('/');

  if (slash <= 0 || slash >= trimmed.length - 1) {
    return null;
  }

  return {
    providerId: trimmed.slice(0, slash).trim(),
    modelId: trimmed.slice(slash + 1).trim(),
  };
}

/**
 * Applies Models-tab provider allow/deny lists to a catalog.
 * Empty allowlist → no allow restriction; empty denylist → no deny restriction.
 * When both are set, denylist wins for overlapping ids.
 */
export function filterBuiltinProvidersByAllowDeny(
  catalog: readonly OpencodeBuiltinProvider[],
  enabledProviders: string[],
  disabledProviders: string[],
): OpencodeBuiltinProvider[] {
  const enabled = enabledProviders.map((id) => id.trim()).filter((id) => id.length > 0);
  const disabled = new Set(disabledProviders.map((id) => id.trim()).filter((id) => id.length > 0));

  let result = catalog.slice();

  if (enabled.length > 0) {
    const allowed = new Set(enabled);

    result = result.filter((provider) => allowed.has(provider.id));
  }

  if (disabled.size > 0) {
    result = result.filter((provider) => !disabled.has(provider.id));
  }

  return result;
}

/**
 * Catalog providers that still have at least one model not listed in `existingRefs`
 * (`providerId/modelId` lines). Pass an already allow/deny-filtered catalog when needed.
 */
export function unusedBuiltinModelProviders(
  catalog: readonly OpencodeBuiltinProvider[],
  existingRefs: string[],
): OpencodeBuiltinProvider[] {
  const used = new Set(existingRefs.map((ref) => ref.trim()).filter((ref) => ref.length > 0));

  return catalog.filter((provider) =>
    (provider.models ?? []).some((model) => !used.has(formatProviderModelRef(provider.id, model.id))),
  );
}

/**
 * Providers offered by the Models-tab known-model picker.
 * Applies allow/deny when set (empty lists = unrestricted / full catalog).
 * Prefers providers that still have unused catalog models; if the catalog has no
 * model metadata yet, still returns in-scope providers so the picker is usable.
 */
export function providersForKnownModelPicker(
  catalog: readonly OpencodeBuiltinProvider[],
  enabledProviders: string[],
  disabledProviders: string[],
  existingModelRefs: string[],
): OpencodeBuiltinProvider[] {
  const scoped = filterBuiltinProvidersByAllowDeny(catalog, enabledProviders, disabledProviders);
  const withUnusedModels = unusedBuiltinModelProviders(scoped, existingModelRefs);

  if (withUnusedModels.length > 0) {
    return withUnusedModels;
  }

  const catalogHasAnyModels = scoped.some((provider) => (provider.models ?? []).length > 0);

  // All catalog models for in-scope providers are already selected.
  if (catalogHasAnyModels) {
    return [];
  }

  // No model metadata in the catalog yet — still offer providers in scope.
  return scoped.slice();
}

/**
 * Models for `providerId` that are not already present in `existingRefs`.
 */
export function unusedBuiltinModelsForProvider(
  catalog: readonly OpencodeBuiltinProvider[],
  providerId: string,
  existingRefs: string[],
): OpencodeBuiltinProviderModel[] {
  const provider = getBuiltinProvider(catalog, providerId);

  if (!provider?.models?.length) {
    return [];
  }

  const used = new Set(existingRefs.map((ref) => ref.trim()).filter((ref) => ref.length > 0));

  return provider.models.filter((model) => !used.has(formatProviderModelRef(provider.id, model.id)));
}
