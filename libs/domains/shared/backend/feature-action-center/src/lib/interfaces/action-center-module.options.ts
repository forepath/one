export interface ActionCenterModuleOptions {
  /** Product id stored with silences and used in socket rooms / Valkey keys (`decabill`, `agenstra`). */
  applicationId: 'agenstra' | 'decabill';
  /** Scope of the current request / job (Decabill: tenant id, Agenstra: instance key). */
  resolveScopeKey: () => string;
  /**
   * Runs `fn` with `scopeKey` active (Decabill binds the tenant so repositories stay tenant-scoped).
   * Defaults to calling `fn` directly.
   */
  runInScope?: <T>(scopeKey: string, fn: () => Promise<T>) => Promise<T>;
  /**
   * Register the global interceptor that signals a change after every successful mutating HTTP request
   * (POST/PUT/PATCH/DELETE). Default `true`.
   */
  trackHttpMutations?: boolean;
}
