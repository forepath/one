# @forepath/release-integrity

Nx project **`release-integrity`**: hashes **Electron Forge** build artifacts and writes checksum files next to them (default `out/make`). Used after `electron-forge make` so releases ship with verifiable integrity (repo root **`SECURITY.md`**).

## Outputs

In the chosen directory:

- **`SHA256SUMS`** — GNU `sha256sum` format (`<hex>  <path>`, two spaces)
- **`integrity-manifest.json`** — same digests in JSON (`schemaVersion`, `algorithm`, `generatedAt`, `artifacts[]`)

## Usage

**Nx:**

```bash
nx run release-integrity:build
nx run release-integrity:test
```

**CLI** (after build):

```bash
# Generate SHA256SUMS + integrity-manifest.json (default command)
node tools/release-integrity/dist/src/cli.js
node tools/release-integrity/dist/src/cli.js --input path/to/make/output

# Verify files on disk against SHA256SUMS (or integrity-manifest.json if sums missing)
node tools/release-integrity/dist/src/cli.js verify
node tools/release-integrity/dist/src/cli.js verify --input path/to/make/output
```

(From the repository root, after `nx run release-integrity:build`.)

- Default input: **`out/make`** (relative to cwd), or **`RELEASE_INTEGRITY_INPUT`** / **`DESKTOP_RELEASE_INTEGRITY_INPUT`** (legacy).
- **Verify** reads **`SHA256SUMS`** first if present; otherwise **`integrity-manifest.json`**. Only manifest-listed files are checked (extra files in the directory do not fail verification).

**TypeScript** (same package name):

```typescript
import { buildIntegrityArtifactsForDirectory, verifyDirectoryAgainstManifest } from '@forepath/release-integrity';
```

## CI

**Production** ([`release.yml`](../../.github/workflows/release.yml)): on a published version, the workflow builds this CLI, runs it on the consolidated **`release/`** directory (desktop installers from Linux + Windows), **verifies** the manifests, then uploads **`SHA256SUMS`**, **`integrity-manifest.json`**, and the binaries to **Cloudflare R2** at `s3://<bucket>/releases/<version>/desktop/`.

**Pull requests** ([`pull-request-checks.yml`](../../.github/workflows/pull-request-checks.yml)): the same generate + **verify** steps run on **`release/`**; outputs are attached to the **`binary-bundle`** artifact (installers + **`SHA256SUMS`** + **`integrity-manifest.json`**) instead of uploading to R2. If no desktop binaries were built, integrity generation is skipped.

## Signed release manifests

`signing/` adds **signed per-product release manifests** for Agenstra, Decabill, ForePath and Loadweaver. All products' public keys live in one registry, `@forepath/shared/shared/util-release-keys` (`RELEASE_SIGNING_KEYS.<product>`), which Loadweaver's control plane, agent and CLI also compile in to verify release bundles; Loadweaver's key signs both its bundle and its manifest. The generic part (canonical JSON, ECDSA P-256 signatures with key ids, manifest schema, file checks) is the shared library `@forepath/shared/shared/util-release-signing`.

- **`<product>-release-manifest-<version>.json`** canonical JSON: product, version, channel (prereleases = `beta`), source repository + commit, container images by digest (discovered from the `release` tags of the container-image targets under `apps/<product>/`), files by SHA-256 + size (Agenstra: `desktop/…`, `agentctx/…`)
- **`….json.sig`** `{ "algorithm": "ecdsa-p256-sha256", "keyId", "signature" }` over exactly the manifest bytes

```bash
npx nx run release-integrity:release-manifest -- create --product decabill --release 3.5.0 --commit <sha> \
  --images-from-projects [--image name=repo:tag@sha256:…] [--files desktop=release] --out dist/release-manifests [--sign]
npx nx run release-integrity:release-manifest -- verify --product decabill --manifest <file> [--files <dir>] [--trust-key <pem>]
```

`--sign` reads the private key from the product's environment variable and refuses keys whose public half is not in the registry. `sign --product <p> --manifest <file>` signs a manifest `create` wrote earlier; the release workflow builds without the key and signs in a separate step that is the only one with it. Operator verification (OpenSSL or this CLI) is described in each product's `security/vulnerability-reporting-and-artifacts.md`.

**CI**: the job _Sign Release Manifest_ in [`release.yml`](../../.github/workflows/release.yml) (one matrix entry per product, after the container images and desktop binaries) builds, signs and attaches the manifest to the GitHub release. Without the product's secret it is skipped with a warning and succeeds; it never gates other release jobs.

### Key setup (done by the key owner, once per product)

Key material is created and held by the product owner; it never goes into the repository, CI logs or chat.

1. `npx nx run release-integrity:generate-release-key -- --product <agenstra|decabill|forepath|loadweaver> --private-key-out <secure path>` — prints the key id and the **public** key; writes the private key only to the given file (0600, never overwritten).
2. Add the public PEM to `RELEASE_SIGNING_KEYS.<product>` in `libs/domains/shared/shared/util-release-keys/src/lib/release-keys.ts` and merge it.
3. Store the private PEM as the GitHub Actions secret of the `production` environment: `AGENSTRA_RELEASE_SIGNING_KEY`, `DECABILL_RELEASE_SIGNING_KEY`, `FOREPATH_RELEASE_SIGNING_KEY` or `LOADWEAVER_RELEASE_SIGNING_KEY`. Keep an offline backup, then delete the file.
4. Rotation: add the new public key, switch the secret, and remove the old public key only once no supported release is signed with it.

## Note

Checksums detect tampering or corruption; they do not replace OS code signing. OS signing (Developer ID + notarization, Authenticode, GPG-signed apt / rpm repositories) and the in-app update feeds come from the shared desktop release pipeline, [`tools/desktop-release`](../desktop-release/README.md); the checksums and the signed release manifest (over the files exactly as published, signed rpms and macOS zips included) stay on top. See **`SECURITY.md`**.
