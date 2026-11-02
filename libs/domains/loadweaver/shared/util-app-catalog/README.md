# loadweaver-shared-util-app-catalog

The app store's shared format library (plan P1): what the control plane, console, fleet, `lw app` CLI and catalog CI agree on. Import from `@forepath/loadweaver/shared/util-app-catalog`.

Every parser returns `ParseResult<T>`: `{ ok: true, value }` or `{ ok: false, errors: string[] }`. Each error reads `path: message`.

| Area                                     | API                                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest (`manifest.yaml`)               | `appManifestSchema`, `parseManifest`, `AppManifest`                                                                                                                               |
| Catalog index (`index.yaml`)             | `catalogIndexSchema`, `parseIndex`, `findTakedown`, `listedApps`, `latestVersion`, `effectiveTrust`                                                                               |
| Cluster config (`Cluster.spec.appStore`) | `appStoreConfigSchema`, `parseAppStoreConfig`, `defaultAppStoreConfig`, `isTrustAllowed`                                                                                          |
| Package archive                          | `buildPackageArchive`, `readPackageArchive`, `loadPackage`, `sha256Digest`                                                                                                        |
| Install rendering                        | `resolveParameters`, `renderCompose`, `findPlaceholders`, `findUnpinnedImages`                                                                                                    |
| Signing (cosign key-based)               | `generateSigningKeyPair`, `publicKeyId`, `signBlob`, `verifyBlob`, `buildSimpleSigningPayload`, `verifySimpleSigning`, `buildOciArtifactManifest`, `verifyIndex`, `verifyPackage` |
| Policy lint                              | `lintPackage`, `hasLintErrors`, `checkLicense`, `FREE_LICENSES`                                                                                                                   |
| Takedowns                                | `findAffectedInstalls`                                                                                                                                                            |

## Conventions

- **Placeholders in `compose.yaml`:**
  - `${param}` takes a manifest parameter.
  - `${secret:name}` takes the secret reference given at install, e.g. under `secrets.<name>.x-loadweaver-ref`.
  - `$$` is a literal `$`.
  - Anything else is refused: `$VAR`, `${VAR:-x}`.
  - Substitution works on the YAML tree, so values can't inject structure. A plain scalar that is exactly one placeholder keeps the value's type.
- **Bundled dependencies:** when the boolean `bundled.parameter` is false, the dependency's services and volumes are removed, and their `depends_on` entries go with them.
- **Lint exceptions:** declare them in the manifest under `exceptions: [{ rule, service?, reason }]`. A service can also declare them in `x-loadweaver-exceptions: { <rule>: <reason> }`. `x-loadweaver` itself can't hold them, because the compose parser validates it strictly.
- **Keys:**
  - Supported keys are ECDSA P-256 and Ed25519 in PEM. The key id is the SHA-256 hex of the SPKI DER.
  - Blob signatures use the `cosign sign-blob` format: base64, ECDSA-SHA256 DER or pure Ed25519.
  - OCI signatures use cosign's simple-signing payload over the artifact's manifest digest.
  - cosign's encrypted private key format is not read. Signatures made by cosign verify all the same.
- **Trust:** `official` only comes from the catalog configured with `official: true`. Other catalogs are capped at `verified`. Publisher labels in an index may be `official | verified | community`, and an app's trust can't exceed its publisher's label.
- **Node only:** the archive and signing helpers use `node:crypto` / `node:zlib`. Browser code should import only types and schemas.

## Tests

`nx test loadweaver-shared-util-app-catalog`. The tests generate throwaway key pairs; no private key is committed.
