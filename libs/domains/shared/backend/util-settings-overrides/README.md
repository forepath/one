# util-settings-overrides

Database-backed overrides of environment-variable settings for the Agenstra controller and the Decabill billing manager.

- Each backend registers its catalog (`SettingDefinition[]`) and loads its override rows into the registry.
- `installSettingsOverridesEnv()` makes `process.env` reads of registered keys resolve **tenant override → global override → environment variable** (tenant taken from the async context, see `runWithTenantId`). The original environment is never mutated, so resetting an override lets the environment variable apply again.
- `resolveSettingValue(key, tenantId)` resolves for an explicit tenant.
- `normalizeSettingValue()` validates writes by type; `describeSettings()` builds the console view (secrets are never returned).

Settings read once at startup carry `restartRequired: true`. Only settings that are read per request / job inside the tenant context may use `scope: 'tenant'`.
