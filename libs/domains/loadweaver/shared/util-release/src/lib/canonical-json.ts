/**
 * Canonical JSON of a release manifest (3.26): object keys sorted by code unit, no whitespace, `undefined` members
 * dropped, numbers as JavaScript prints them (manifests contain integers only). The signature covers exactly these
 * bytes, so every producer (CI, the dev bundle script) and every verifier (control plane, agent, CLI) agree.
 * Implemented once for every ForePath product in `@forepath/shared/shared/util-release-signing`.
 */
export { canonicalJson } from '@forepath/shared/shared/util-release-signing';
