# Catalog keys (public only)

`*.pub` here are the public keys of the catalog maintainers; they sign `index.yaml`. Publishers sign their own
packages with the keys registered in `publishers/`.

**`community-maintainers.dev.pub` is a DEVELOPMENT key.** Its private key exists only on the developer machine that
generated it (`~/.cache/forepath-loadweaver-app-catalog/`, never committed). Indexes signed with it are for local tests
and CI dry runs.

Before the first real publish: generate the production key offline (`loadweaver app keygen -o community-maintainers`),
store the private key as the repository secret `LOADWEAVER_APP_CATALOG_COMMUNITY_KEY` (environment `production`), and
replace the `.dev.pub` file with the production public key. Clusters that enable the community catalog register this
public key.
