# Catalog keys (public only)

`*.pub` here are the public keys that sign this catalog's `index.yaml` (and, for the official catalog, its packages).

**`forepath-official.dev.pub` is a DEVELOPMENT key.** Its private key exists only on the developer machine that
generated it (`~/.cache/forepath-loadweaver-app-catalog/`, never committed). Indexes signed with it are for local tests
and CI dry runs; no cluster should trust it.

Before the first real publish:

1. Generate the production key offline: `loadweaver app keygen -o forepath-official` (ECDSA P-256).
2. Store the private key as the repository secret `LOADWEAVER_APP_CATALOG_OFFICIAL_KEY` (environment `production`),
   with its passphrase in `LOADWEAVER_APP_CATALOG_OFFICIAL_KEY_PASSPHRASE` if it is encrypted.
3. Replace `forepath-official.dev.pub` with `forepath-official.pub`, update `publishers/forepath.yaml`, and ship the
   same public key with Loadweaver as the official catalog key.

Never commit a private key. The catalog CI refuses any `PRIVATE KEY` in a catalog.
