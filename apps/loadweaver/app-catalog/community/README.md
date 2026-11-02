# Loadweaver community apps

Third-party apps for the Loadweaver app store. Anyone can submit an app by pull request. Every submission is checked automatically, reviewed by a maintainer, and signed with its publisher's own key. Clusters show these apps with the **Community** label, or **Verified publisher** for publishers the maintainers verified, and only when their admin enabled this catalog and allows that label.

> This catalog lives in the `forepath/one` monorepo for now (`apps/loadweaver/app-catalog/community`) and moves to its own repository later. Paths in this document are relative to this folder.

## Layout

```
catalog.yaml                 name, title, trust: community, OCI repository, report link
keys/                        public keys of the catalog maintainers (they sign index.yaml)
publishers/<name>.yaml       registered publishers and their public keys
takedowns.yaml               taken-down apps / versions (maintainers only)
<app>/app.yaml               optional: summary override, deprecated
<app>/<version>/
  compose.yaml               Docker Compose with x-loadweaver, images pinned by digest
  manifest.yaml              apps.loadweaver.com/v1 manifest
  README.md                  shown on the app page
  package.sig                publisher's signature of the package archive (lw app sign)
  package.oci.sig            publisher's signature of the OCI artifact (lw app sign --oci)
  release.yaml               optional: published time, channel
```

## Submission rules

1. **Free apps only**: an OSI-approved / free SPDX licence (`MIT`, `Apache-2.0`, `GPL-3.0-or-later`, …). A free tier of a commercial product (`LicenseRef-…`) needs a maintainer's explicit approval. Payments and licence keys are handled outside the store.
2. **Images pinned by digest** (`image: registry/repo:tag@sha256:…`), pulled from a public registry, built from public sources.
3. **No host access without a reason**: host networking, privileged containers, host PID / IPC and host-path mounts fail the lint unless the manifest's `exceptions` give a reason. Expect questions about every exception.
4. **No secrets in the package**: secrets are `${secret:name}` references declared in the manifest; the user creates them in their project. A secret only an optional feature needs is conditional (`requiredWhen: { parameter: … }`, optionally `equals: …`) and referenced only in the compose's top-level `secrets`.
5. **No placeholders but the package's own**: `${parameter}`, `${secret:name}`, `$$` for a literal `$`. Every required parameter without a default needs an `examples` value (CI renders with it).
6. **Signed** by a key registered for the publisher in `publishers/` (your first PR registers it).
7. **One app per PR**, a new version is a new folder: published versions are immutable.
8. The app must do what its README says, and nothing it doesn't say (no telemetry without opt-in, no miners, no backdoors).

Read [CONTRIBUTING.md](./CONTRIBUTING.md) for the step-by-step flow.

## What CI checks

The `Loadweaver App Catalog` workflow runs on every PR that touches the catalog:

- `lw app validate` (manifest / compose parse, render with defaults and with every provided dependency, the control plane's compose parser) and `lw app lint` (policy lint) for every changed package;
- Trivy scan of every image of the changed packages (critical findings fail);
- signature check: `package.sig` against the keys registered for the publisher, no private key anywhere;
- a test install: a dry-run plan of the rendered deployment (and a real plan in the sandbox cluster when it is configured).

Then a maintainer reviews the PR (see CONTRIBUTING.md). After the merge, the publish workflow signs the index with the catalog key and pushes the catalog to `oci://ghcr.io/forepath/loadweaver-community-apps`.

## Reports and takedowns

Found a problem with an app (malware, licence violation, broken or abandoned)? Open a [report](https://github.com/forepath/one/issues/new?template=loadweaver-app-report.yml); the console's **Report** button links there. Maintainers investigate; a takedown goes into `takedowns.yaml`, the next signed index hides the app or version, and clusters that installed it get an inbox warning. There is no central service and no telemetry: clusters only learn about takedowns by refreshing the index.
