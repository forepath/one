# loadweaver-shared-util-release

Release bundles of Loadweaver (plan 3.26), shared by the control plane, the node agent, the CLI and the release
pipeline:

- `pins.ts` — the component pins of this source tree (images by digest, gVisor, DRBD, host packages per OS): the one
  source of truth the bundle is built from and the agent's defaults;
- `manifest.ts` — the manifest schema (forward compatible), required components, helpers;
- `canonical-json.ts`, `signature.ts` — ECDSA P-256 signatures over the canonical manifest (delegating to
  `@forepath/shared/shared/util-release-signing`);
- `bundle-trust.ts` — which bundles are accepted: Loadweaver's public keys from the shared key registry
  (`RELEASE_SIGNING_KEYS.loadweaver`, `@forepath/shared/shared/util-release-keys`); development keys / unsigned bundles
  only on explicit opt-in;
- `tar.ts`, `bundle.ts` — a minimal streaming tar reader / writer and the bundle reader that verifies the manifest
  before any artifact is read and every artifact while it streams;
- `versions.ts` — release versions, update kinds (patch / minor / major), the N-1 window;
- `source-manifest.ts` — builds a manifest from the pins and a release's artifacts.

Targets:

- `build-bundle` — builds a bundle (`--release`, `--control-plane-image`, `--agent-<arch>`, …; signs with
  `LOADWEAVER_RELEASE_SIGNING_KEY`, `--require-signature` for releases);
- `dev-bundle` — the agent's single executable plus an unsigned bundle for labs (`dist/loadweaver-dev-bundle`);

Signing keys are generated with the shared tool (`nx run release-integrity:generate-release-key -- --product
loadweaver --private-key-out <file>`). See `docs/loadweaver/features/updates.md`. Run the unit tests with `nx test loadweaver-shared-util-release`.
