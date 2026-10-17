# shared-shared-util-release-signing

Signed release documents for every ForePath product (`@forepath/shared/shared/util-release-signing`):

- **`canonicalJson`** the exact bytes a signature covers (sorted keys, no whitespace)
- **`signManifest` / `verifyManifestSignature` / `releaseKeyId` / `generateReleaseKeyPair`** ECDSA P-256 / SHA-256 signatures with a key id; verifiers pass their own trusted public keys (PEM)
- **`resolveTrustedReleaseKeys`** a product's compiled-in key set plus optional development keys from an environment variable (never in `NODE_ENV=production`)
- **`createProductReleaseManifest` / `verifyProductReleaseManifest` / `checkReleaseFiles`** the per-product release manifest (images by digest, files by SHA-256, source commit)
- **`sha256File` / `listFilesRecursive`** streamed file digests

No product, key or pin lives here. Users: Loadweaver's release bundles (`loadweaver-shared-util-release` delegates its canonical JSON, signatures and trusted keys here) and the Agenstra / Decabill / ForePath release manifests (`tools/release-integrity/signing`, see its README for the key setup).

```bash
nx test shared-shared-util-release-signing
```
