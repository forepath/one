# feature-settings

Shared **Administration → Settings** page: a category sidebar with one row per overridable backend setting (environment variable). Each row shows where the effective value comes from, saves an override and resets it to the default (removing the override lets the next layer apply again). Backends with tenants (Decabill) add a level switch: the override for all tenants or one tenant.

Consumers provide `SETTINGS_ADMIN_ENVIRONMENT`, `SETTINGS_ADMIN_LABELS` and `settingsAdminProviders`, then mount `createSettingsAdminRoutes([...guards])`.
