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

## Note

Checksums detect tampering or corruption; they do not replace OS code signing. See **`SECURITY.md`**.
