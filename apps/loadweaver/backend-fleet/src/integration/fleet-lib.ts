// Loaded lazily by the integration specs (after the lab has set the environment); a relative module keeps the
// library itself statically imported, which `@nx/enforce-module-boundaries` requires app-wide.
export { FleetIdentityService, mintFleetClaim } from '@forepath/loadweaver/backend/feature-fleet';
