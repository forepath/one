# @forepath/desktop-release

Nx project **`desktop-release`**: the shared desktop release pipeline of every ForePath Electron app (Loadweaver plan 3.32). It sits next to [`tools/release-integrity`](../release-integrity/README.md), which still writes `SHA256SUMS` / `integrity-manifest.json` and the signed product release manifest on top of everything this tool produces.

| Platform | What the pipeline does                                                                                                                                                                                                                   | Secret(s)                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| macOS    | Developer ID signing (hardened runtime, the app's entitlements, `@electron/osx-sign`), notarization with an App Store Connect API key (`@electron/notarize` → notarytool), stapling, Gatekeeper check, `ditto` zip                       | `DESKTOP_MACOS_CERTIFICATE_P12`, `DESKTOP_MACOS_CERTIFICATE_PASSWORD`, `DESKTOP_APPLE_API_KEY_P8`, `_KEY_ID`, `_ISSUER` |
| Windows  | Authenticode (`signtool`, SHA-256, RFC 3161 timestamp) of the app's `.exe` / `.dll` / `.node` files and of the NSIS installer; the Windows zip is made from the signed app                                                               | `DESKTOP_WINDOWS_CERTIFICATE_PFX`, `DESKTOP_WINDOWS_CERTIFICATE_PASSWORD`                                               |
| Linux    | rpm built from Forge's packaged app (same layout as the deb); rpms signed (`rpmsign --addsign`); signed apt repository (`apt-ftparchive`, `InRelease` / `Release.gpg`) and rpm repository (`createrepo_c`, `repomd.xml.asc`) per channel | `DESKTOP_LINUX_GPG_PRIVATE_KEY`, `DESKTOP_LINUX_GPG_PASSPHRASE` (optional)                                              |
| All      | In-app update feeds `updates/desktop/<channel>.json` pointing at the signed release manifest                                                                                                                                             | none here (the manifest is signed with the product's release key by `release-integrity`)                                |

Zip archives keep their checksums (`SHA256SUMS`, signed release manifest) on top of the signatures. Mobile signing (3.33) is not part of this tool yet.

## Graceful degradation

Every signing step checks its secrets first. While a secret is missing the step is **skipped with a warning** (`::warning` annotation) and the release continues, like the Loadweaver bundle signing step:

- macOS: the zip is ad-hoc signed (Gatekeeper asks the user to confirm; Squirrel.Mac auto-update needs a Developer ID signature, so the app offers the download instead);
- Windows: app and installer stay unsigned (SmartScreen warning); in-app updates still require the signed release manifest;
- Linux: rpms stay unsigned and no apt / rpm repository is published (packages remain plain downloads);
- feeds: without the product's signed release manifest (`AGENSTRA_RELEASE_SIGNING_KEY` unset) no feed is written, so apps are not offered the release in-app.

## Key handling (CI)

Same rule as the release manifest signing (M6 review L5): **no key in a build step**. The release workflow bundles the CLI first (`nx run desktop-release:bundle` → `tmp/desktop-release/desktop-release.cjs`), and only the signing steps get the secrets as environment variables; they run that bundle (no nx, no npm, no download). The tool writes key material only into a fresh temporary directory (mode 0600) — a throw-away macOS keychain, a PFX file, a throw-away GnuPG home — and deletes it in a `finally`, also on failure. The Authenticode PFX is imported into the runner's CurrentUser certificate store (password passed through the environment as a SecureString, never on a command line), `signtool` selects it by thumbprint (`/sha1`), and certificate + key are removed from the store afterwards. Passwords that still have to be command arguments (`security` for the throw-away keychain and the p12 import) are flagged so they never appear in error messages; GitHub masks secret values in logs.

**Isolation is per step, not per job** (accepted): the signing steps run in the same job — same runner, same workspace, same user — as the steps before them that install dependencies and build / package the app. The secrets are never in those steps' environment, but code that ran earlier in the job (a compromised dependency's install script, a build plugin) could leave something behind on the runner — a modified file, a background process — that acts during a later signing step. Moving signing into separate jobs that only download a hash-checked CLI bundle and the artifacts to sign would close this, at the cost of up- / downloading the packaged apps (hundreds of MB per platform) between jobs and splitting macOS / Windows packaging around the signing; it is not done yet. Mitigations: dependencies come from the lockfile (`npm ci`), the signing steps run the pre-built bundle with nothing else, the signing jobs run only in the manually dispatched release workflow in the `production` environment, and every signed artifact is additionally covered by the signed release manifest.

The jobs that sign (`Build Windows Installer`, `Build macOS Applications`, `Publish Native Applications`) run in the `production` environment, where the secrets are stored.

## Commands

```bash
npx nx run desktop-release:desktop-release -- <command> --app agenstra …   # or node tmp/desktop-release/desktop-release.cjs after :bundle
```

| Command        | Arguments                                                        | Purpose                                                                                       |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `config`       | `--app`                                                          | Print the app's settings                                                                      |
| `sign-macos`   | `--app --arch arm64\|x64`                                        | Sign, notarize, staple the packaged `.app` (key-only step)                                    |
| `zip-macos`    | `--app --arch --version`                                         | Download / Squirrel.Mac zip (`<exe>-darwin-<arch>-<version>.zip`); ad-hoc signs unsigned apps |
| `sign-windows` | `--app --path <file\|dir>… [--top-level]`                        | Authenticode via `signtool` (key-only step; `SIGNTOOL_PATH` overrides the SDK lookup)         |
| `linux-rpm`    | `--app --version [--arch x64]`                                   | rpm from `out/<exe>-linux-<arch>` into `out/make/rpm/<arch>/`                                 |
| `channels`     | `--app --version`                                                | Channels this release goes to (stable → stable + beta, prerelease → beta; never backwards)    |
| `linux-repo`   | `--app --channels <c,…> [--packages <dir>] --out <dir>`          | Sign rpms in place, build the signed apt / rpm repositories (key-only step)                   |
| `feed`         | `--app --version --channels <c,…> --manifest <file> --out <dir>` | Verify the signed release manifest with the compiled-in keys, write `<channel>.json`          |

## Published layout (product bucket, e.g. `https://downloads.agenstra.com`)

```text
releases/<version>/desktop/…                         installers, zips, deb, rpm, SHA256SUMS, integrity-manifest.json
releases/<version>/<product>-release-manifest-<version>.json(.sig)
updates/desktop/stable.json, beta.json               in-app update feeds
apt/pool/main/<p>/<package>/*.deb                    apt repository (dists/stable, dists/beta; InRelease, Release.gpg)
apt/<package>-<channel>.sources                      ready-made deb822 source
rpm/<channel>/<arch>/…, rpm/<channel>/<package>.repo rpm repository (signed packages, repomd.xml.asc)
forepath-desktop.asc                                 public GPG key of the repositories
```

## Re-publishing the apt metadata

The apt `Release` files carry `Valid-Until` (`APT_RELEASE_VALID_DAYS` = 30 days after signing, set through apt-ftparchive's `ValidTime`; `linux-repo` fails if a `Release` comes out without it — `src/lib/linux.ts`), so a stale mirror or an attacker can't hold clients on old metadata indefinitely; apt refuses an expired `Release` (`apt update` fails for the repository). Every release re-signs it. **If no release reaches a channel within 30 days**, re-publish before the date in `dists/<channel>/Release` passes: re-run the _Publish Native Applications_ job of the latest release run (it rebuilds and re-signs the repositories from that release's packages and uploads them again), or run `linux-repo` with the GPG key for the current packages and upload `apt/dists/` (metadata only, `no-cache`). The rpm repository has no equivalent field (dnf's `metadata_expire` is a client-side cache setting).

## In-app updates

An app checks `updates/desktop/<channel>.json` (unsigned pointer), downloads the signed release manifest it names and decides with `evaluateDesktopUpdate` from `@forepath/shared/shared/util-release-signing`: signature with the product's compiled-in keys (`RELEASE_SIGNING_KEYS.<product>`), canonical form, product, version equal to the feed's, channel (stable installs take stable only, beta installs both), strictly newer than the running version (never a downgrade). The platform file is downloaded and checked against the manifest's SHA-256 and size, then handed to Squirrel.Mac (which additionally enforces the Developer ID signature) or the NSIS installer (Authenticode publisher must match the running app's when that is signed). Linux installs update through apt / dnf. Agenstra Desktop: `apps/agenstra/native-agent-console/src/update/`.

## Adding an app (e.g. Loadweaver Desktop)

1. Add an entry to `DESKTOP_APPS` in `src/apps.ts` (product, Nx project, dist dir, Forge executable name, package name, download base URL, entitlements file, rpm dependencies, secret names — the ForePath identity is shared by default).
2. Add the app to the matrices / commands in `.github/workflows/release.yml` (`--app <name>`; the feed job's matrix with the product bucket secrets).
3. Embed the updater: use `parseDesktopUpdateFeed` / `evaluateDesktopUpdate` / `verifyDesktopUpdateDownload` with the product's keys, as `apps/agenstra/native-agent-console/src/update/` does. Loadweaver additionally needs the Network Extension entitlement (3.31) in its entitlements file and provisioning profile.

## Secrets setup (by the key owner, once)

All secrets go into the GitHub Actions environment **`production`**. Keep offline backups; never commit them, paste them into chats or print them in CI.

### Apple (macOS)

1. Apple Developer Program membership of the company (Team ID).
2. Certificates, Identifiers & Profiles → Certificates → **Developer ID Application** (create a CSR in Keychain Access, download the certificate, double-click to import).
3. Keychain Access → export the certificate **with its private key** as `.p12` with a strong password.
   - `DESKTOP_MACOS_CERTIFICATE_P12` = `base64 -i DeveloperID.p12 | pbcopy`
   - `DESKTOP_MACOS_CERTIFICATE_PASSWORD` = the export password
4. App Store Connect → Users and Access → Integrations → **App Store Connect API** → team key with the _Developer_ role; download `AuthKey_<KEYID>.p8` (only once).
   - `DESKTOP_APPLE_API_KEY_P8` = the file contents (including the `BEGIN/END PRIVATE KEY` lines)
   - `DESKTOP_APPLE_API_KEY_ID` = the key id, `DESKTOP_APPLE_API_ISSUER` = the issuer id (UUID)

### Windows (Authenticode)

1. Code-signing certificate (OV or EV) issued to the company.
2. Export certificate + private key as `.pfx` with a password.
   - `DESKTOP_WINDOWS_CERTIFICATE_PFX` = `base64 -w0 codesign.pfx`
   - `DESKTOP_WINDOWS_CERTIFICATE_PASSWORD` = the PFX password

Certificates issued since June 2023 keep their private key in an HSM / cloud signing service and can't be exported as a PFX. For those, replace the body of the two _Sign … (Authenticode)_ steps with the provider's `signtool` integration (e.g. Azure Artifact Signing's `/dlib`, DigiCert KeyLocker, SSL.com eSigner); the rest of the pipeline is unchanged.

### Linux (GPG)

1. Create a dedicated signing key (offline machine): `gpg --quick-generate-key "ForePath Desktop Packages <hi@forepath.io>" rsa4096 sign 3y` (or a signing subkey of the ForePath key).
2. `DESKTOP_LINUX_GPG_PRIVATE_KEY` = `gpg --armor --export-secret-keys <fingerprint>`; `DESKTOP_LINUX_GPG_PASSPHRASE` = its passphrase (leave unset for a key without one).
3. Publish the fingerprint in the product docs so users can compare it; the pipeline exports the public key to `forepath-desktop.asc` with every release. Rotate by switching the secret before expiry; clients re-import the key file.

## Tests

```bash
nx test desktop-release
nx test shared-shared-util-release-signing   # feed / manifest / channel / downgrade logic
nx test agenstra-native-agent-console        # platform file selection, Authenticode publisher check
```

Signing, notarization and the repository tools themselves only run in CI on the respective runners (macOS, Windows, Ubuntu).
