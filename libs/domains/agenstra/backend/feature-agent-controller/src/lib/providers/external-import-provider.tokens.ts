/**
 * Nest injection token: resolves to {@link ExternalImportProviderFactory} after all import providers are registered.
 * Same pattern as {@code PROVISIONING_PROVIDERS} in {@link ClientsModule}.
 */
export const CONTEXT_IMPORT_PROVIDERS = 'CONTEXT_IMPORT_PROVIDERS';
