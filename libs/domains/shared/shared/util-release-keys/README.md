# shared-shared-util-release-keys

The public release signing keys of every ForePath product (`@forepath/shared/shared/util-release-keys`): one key set
per product (`RELEASE_SIGNING_KEYS`), the CI secret holding each private key (`RELEASE_SIGNING_KEY_SECRETS`). Used by
the release tooling (`tools/release-integrity/signing`) and by Loadweaver, whose control plane, node agent and CLI
verify release bundles with `RELEASE_SIGNING_KEYS.loadweaver`.

Keys are created and held by the product owner: `npx nx run release-integrity:generate-release-key -- --product
<product> --private-key-out <file>` (see `tools/release-integrity/README.md`, "Key setup"). Only public keys go here.

```bash
nx test shared-shared-util-release-keys
```
