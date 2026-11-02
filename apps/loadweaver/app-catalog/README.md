# Loadweaver app catalogs

The two catalogs of the Loadweaver app store, kept in this monorepo until they move to their own repositories:

| Folder                      | Catalog                | Trust     | Published to                                       |
| --------------------------- | ---------------------- | --------- | -------------------------------------------------- |
| [`official/`](./official)   | `forepath-official`    | official  | `oci://ghcr.io/forepath/loadweaver-apps`           |
| [`community/`](./community) | `loadweaver-community` | community | `oci://ghcr.io/forepath/loadweaver-community-apps` |

Each catalog: `catalog.yaml`, `keys/` (public catalog keys only), `publishers/`, `takedowns.yaml` and the packages in
`<app>/<version>/` (`compose.yaml`, `manifest.yaml`, `README.md`). The format, the CLI and the review process are in
the [publishing guide](../../../docs/loadweaver/features/app-store-publishing.md).

```sh
loadweaver app lint official/agenstra-controller/4.1.0
loadweaver app validate official/agenstra-controller/4.1.0
loadweaver app verify community --require-signatures
loadweaver app index build official --key <catalog key> -o dist/app-catalog/forepath-official
loadweaver app publish oci official --key <catalog key> --dry-run
```

CI: `.github/workflows/loadweaver-app-catalog.yml` (checks on every change) and
`.github/workflows/loadweaver-app-catalog-publish.yml` (signs and publishes; also called by the release workflow).
The committed keys are **development** keys; production keys come from repository secrets (see `*/keys/README.md`).
