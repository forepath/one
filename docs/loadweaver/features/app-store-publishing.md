# App Store Publishing

How apps get into the Loadweaver app store: the package format, the `loadweaver app` CLI, signing, the two catalogs and their CI, review and takedowns. Installing apps (Delivery › Apps in the console, install plans, updates, uninstall) is covered with the cluster features; this page is for publishers and catalog maintainers.

The app store is an **additional** way to deploy software on Loadweaver. Agenstra and Decabill stay available as Docker Compose setups, as Decabill's bundled server stacks and as Agenstra Cloud; their app packages use the same images and versions.

## Packages

A package is one version of one app: a folder `<app>/<version>/` with three files.

| File            | Content                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `compose.yaml`  | Docker Compose with `x-loadweaver` (a normal [deployment](./deployments-and-jobs.md)), images pinned by digest |
| `manifest.yaml` | `apiVersion: apps.loadweaver.com/v1`: name, version, parameters, secrets, dependencies, backups, …             |
| `README.md`     | Shown on the app page                                                                                          |

### manifest.yaml

```yaml
apiVersion: apps.loadweaver.com/v1
name: wiki # DNS label; the folder name
version: 1.2.0 # semantic version; the folder name
title: Wiki
description: A small wiki for teams.
publisher: Acme # a publisher registered in the catalog
license: AGPL-3.0-only # SPDX; free / open source only
homepage: https://example.com/wiki
docs: https://example.com/wiki/docs
channels: [stable] # the first one is the version's channel in the index
minLoadweaver: 1.0.0 # optional: older clusters list the app as not installable and refuse install / update
parameters: # JSON Schema of the install form; values replace ${name} in the compose
  type: object
  properties:
    domain: { type: string, title: Domain, pattern: '^[a-z0-9.-]+$', examples: [wiki.example.com] }
    replicas: { type: integer, default: 2, minimum: 1, maximum: 10 }
    bundlePostgres: { type: boolean, default: true }
    dbHost: { type: string, default: postgres }
    mailer: { type: string, enum: [none, smtp], default: none }
  required: [domain]
secrets: # the user creates them in the project; ${secret:name} in the compose
  - { name: db-password, description: Database password }
  - name: smtp-password # conditional: needed only while the condition holds
    description: SMTP password
    requiredWhen: { parameter: mailer, equals: smtp } # a boolean parameter needs no equals (true)
dependencies: # bundled (part of the compose, toggled by a boolean parameter), provided (connection parameters), or both
  - name: postgres
    bundled: { parameter: bundlePostgres, services: [postgres], volumes: [pgdata] }
    provided: { parameters: [dbHost] }
backups: # suggested backup policies; an update backs these volumes up before it is applied (none = all volumes)
  - { name: database, schedule: '0 2 * * *', volumes: [pgdata], retention: 14d }
healthChecks:
  - { service: web, type: http, port: 8080, path: /health }
migrations: # steps the update plan runs when updating to `version`
  - version: 1.2.0
    steps: [{ name: migrate schema, service: web, command: [wiki, migrate], phase: before }]
exceptions: # reasons for policy-lint exceptions (host networking, privileged, host paths, …)
  - { rule: host-network, service: vpn, reason: The VPN server must own the node's UDP port. }
```

Give every required parameter without a default an `examples` value: `validate` and CI render the package with it.

- **`minLoadweaver`** is copied into the version's entry of the index (`lw app index build`), so store lists can show that an older cluster can't install it without fetching the package; the cluster also checks the signed manifest at install and update. Development builds of Loadweaver (unknown version) aren't checked. A fleet copies it from the uploaded package's manifest into its index (packages uploaded before the fleet recorded it are read once by a background backfill at the fleet's start).
- **`backups`** decide what an update backs up first: applying an update plan backs up the volumes the declared backups name (a backup without `volumes` means every volume of the deployment) and applies the update only once those backups succeeded. Apps that declare no backups are updated without one.
- **Secrets** are required at install, unless they are **conditional**: `requiredWhen: { parameter: <name> }` (a boolean parameter, needed while it is `true`) or `requiredWhen: { parameter: <name>, equals: <value> }` (needed while the parameter has exactly that value, e.g. an enum option). Use it for secrets only an optional integration needs. `parseManifest` (so `validate`, `lint`, CI, the fleet and the control plane) refuses an unknown parameter, a non-boolean parameter without `equals` and a value the parameter's schema refuses. While the condition is off, the secret is not wired: the control plane removes the compose's top-level `secrets` entry that refers to it and every service's mount of that entry (anchored lists included), also when a reference was given (it is then ignored: neither checked, mounted nor recorded), so a conditional secret must be used only there (mounted as a file; lint rule `conditional-secret`). An update that switches the condition off removes the mount the same way. The install form shows and sends such a secret only while its condition holds.

### compose.yaml

```yaml
services:
  web:
    image: ghcr.io/acme/wiki:1.2.0@sha256:… # pinned by digest
    environment:
      DB_HOST: ${dbHost}
      DB_PASSWORD_FILE: /run/secrets/db-password
    secrets: [db-password]
    depends_on: [postgres] # removed automatically when postgres is not bundled
    x-loadweaver:
      replicas: ${replicas} # a plain scalar that is exactly one placeholder keeps the parameter's type
      exposure: { http: [{ host: '${domain}', port: 8080 }] }
  postgres:
    image: postgres:17@sha256:…
    environment: { POSTGRES_PASSWORD_FILE: /run/secrets/db-password }
    secrets: [db-password]
    volumes: [pgdata:/var/lib/postgresql/data]
volumes:
  pgdata: { x-loadweaver: { size: 20g } }
secrets:
  db-password:
    x-loadweaver-ref: ${secret:db-password}
```

- **Placeholders**: `${parameter}`, `${secret:name}`, and `$$` for a literal `$`. Nothing else: `$VAR` and `${VAR:-default}` are refused (packages are self-contained). Substitution works on the YAML tree, so a value can't inject structure. Quote placeholders inside flow maps (`{ host: '${domain}' }`).
- **Secrets** are files under `/run/secrets/`. Apps that read secrets from environment variables can mount a secret under an upper-case target (`{ source: db-password, target: DB_PASSWORD }`) and export the files in their entrypoint, as the official packages do.
- **Bundled dependencies** whose toggle is `false` are removed with their volumes and `depends_on` entries.
- Everything else is a normal Loadweaver deployment: `x-loadweaver` replicas, placement, isolation (`runtime`), exposure with rate limits / WAF, backup hooks, SLOs, autoscaling, and volume sizes.

### Policy lint

`loadweaver app lint` (and CI, and the control plane at install) refuses:

| Rule                                                              | Error unless                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `host-network`, `privileged`, `host-pid`, `host-ipc`, `host-path` | the manifest's `exceptions` (or the service's `x-loadweaver-exceptions`) give a reason    |
| `plaintext-secret`                                                | environment keys named like secrets have no literal value                                 |
| `unpinned-image`                                                  | every image is pinned by digest                                                           |
| `license`                                                         | the SPDX licence is free / OSS; `LicenseRef-…` (free tiers) is a warning for human review |
| `undeclared-reference`, `invalid-placeholder`                     | every placeholder is declared and supported                                               |
| `conditional-secret`                                              | conditional secrets (`requiredWhen`) are referenced only in the top-level `secrets`       |
| `manifest`                                                        | services / volumes the manifest names exist in the compose                                |

## The CLI

`loadweaver app` (the Loadweaver CLI, often called `lw`) works offline; only `publish oci` and `bump` talk to a registry.

| Command                                                                                   | What it does                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app init <name> [-o dir] [--version v] [--publisher p]`                                  | Scaffolds `compose.yaml`, `manifest.yaml`, `README.md` (lint-clean)                                                                                                                                                                                                                                                                                                            |
| `app validate [dir] [--set k=v] [--values f] [--render f] [--deployment f] [--project p]` | Manifest / compose parse, pinned images, render with defaults (+ `examples`, given values; a dry-run reference for every secret, conditional ones that are off dropped as in an install), once per provided dependency and once per conditional secret's condition switched on, each through the control plane's compose parser; writes the rendered compose or a `Deployment` |
| `app lint [dir] [--json]`                                                                 | Policy lint; exit code 1 on errors                                                                                                                                                                                                                                                                                                                                             |
| `app package [dir] [-o file]`                                                             | Deterministic `tar.gz` (sorted, mode 0644, owner 0/0, mtime 0); prints the `sha256:` digest                                                                                                                                                                                                                                                                                    |
| `app keygen -o <prefix> [--type ecdsa-p256\|ed25519]`                                     | `<prefix>.key` (PKCS#8, mode 0600) and `<prefix>.pub`                                                                                                                                                                                                                                                                                                                          |
| `app sign <file> [--key k] [-o f] [--oci oci://repo]`                                     | cosign `sign-blob` signature (`<file>.sig`); with `--oci` also the simple-signing signature of the package's OCI artifact (`<file>.oci.sig`)                                                                                                                                                                                                                                   |
| `app verify <file\|dir> [--key k ...] [--require-signatures]`                             | A package / index with its `.sig`, a built Git catalog (index + every package), a package folder with `package.sig`, or a catalog source folder (structure, lint, publisher signatures)                                                                                                                                                                                        |
| `app index build <catalog> [--key k] [--package-key k] [-o dir] [--now t]`                | Builds every package, checks / makes the signatures, writes and signs `index.yaml` (Git catalog layout)                                                                                                                                                                                                                                                                        |
| `app publish oci <catalog> [--repo oci://…] [--key k] [--dry-run] [--force]`              | Pushes packages, cosign signatures and the index to an OCI registry                                                                                                                                                                                                                                                                                                            |
| `app bump <package dir> --version v [-o dir]`                                             | New version of a package; images tagged with the old version are re-pinned to the new tag's digest                                                                                                                                                                                                                                                                             |

**Keys**: `--key` takes a PEM file or `env:VAR`; without it `LW_APP_SIGNING_KEY` holds the PEM. Encrypted PKCS#8 keys read their passphrase from `LW_APP_SIGNING_KEY_PASSPHRASE` (or `--passphrase-env VAR`). Keys are ECDSA P-256 or Ed25519. cosign's own encrypted key format is not read: make the key with `lw app keygen` or openssl and `cosign import-key-pair` it to use it with cosign too. **Registry credentials** for `publish oci` / `bump`: `LW_REGISTRY_USERNAME` / `LW_REGISTRY_PASSWORD` (the registry's token flow; anonymous pulls work for public images).

## Signing

Key-based cosign, so it works air-gapped:

| What      | Git catalogs                                          | OCI catalogs                                                                                                                                                    |
| --------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package   | `<app>/<version>.tar.gz` + `.tar.gz.sig` (blob)       | `<repo>/<app>:<version>` (`+` written as `_` in the tag; layer `application/vnd.loadweaver.app.v1+tar+gzip`) + `<repo>/<app>:sha256-<hex>.sig` (simple signing) |
| Index     | `index.yaml` + `index.yaml.sig`                       | `<repo>:index` (layer `application/vnd.loadweaver.app-index.v1+yaml`) + `<repo>:sha256-<hex>.sig`                                                               |
| Signed by | packages: the publisher's key; index: the catalog key | same                                                                                                                                                            |

- The package archive is deterministic, so a publisher signs exactly what CI and clusters rebuild from the folder. Any change to the three files needs a new signature.
- The OCI artifact manifest is deterministic too; its simple-signing payload names the repository (`<registry>/<repo>/<app>`), so `--oci` must name the catalog's repository.
- Signatures made with `cosign sign-blob --key` / `cosign sign --key` verify the same way; `cosign verify --key catalog.pub ghcr.io/forepath/loadweaver-apps:index` works on the published artifacts.
- A cluster verifies the index against the catalog keys it registered (the official key ships with Loadweaver), then each package against the keys the index lists for the app's publisher.

## Catalogs

Both catalogs live in this repository for now:

| Folder                                  | Catalog                | Trust     | Registry                                           | Key secret                             |
| --------------------------------------- | ---------------------- | --------- | -------------------------------------------------- | -------------------------------------- |
| `apps/loadweaver/app-catalog/official`  | `forepath-official`    | official  | `oci://ghcr.io/forepath/loadweaver-apps`           | `LOADWEAVER_APP_CATALOG_OFFICIAL_KEY`  |
| `apps/loadweaver/app-catalog/community` | `loadweaver-community` | community | `oci://ghcr.io/forepath/loadweaver-community-apps` | `LOADWEAVER_APP_CATALOG_COMMUNITY_KEY` |

```
catalog.yaml            apiVersion, kind: Catalog, name, title, trust, oci, reportUrl
keys/*.pub              catalog keys (public): they sign index.yaml
publishers/<name>.yaml  name, label (official | verified | community), contact, keys (inline PEM or a path)
takedowns.yaml          takedowns: [{ app, versions: all | [..], reason, at }]
<app>/app.yaml          optional: summary, deprecated
<app>/<version>/        compose.yaml, manifest.yaml, README.md
                        package.sig / package.oci.sig (publisher signatures; community)
                        release.yaml (optional: published, channel)
```

- An app's trust label is its publisher's label, capped by the catalog's trust; clusters show **Official** only for the catalog they configured as the official one.
- The official packages are not signed in the repository: the publish job signs them with the catalog key, which is also the `ForePath` publisher key.
- **Development keys**: the committed `keys/*.dev.pub` files and the example publisher's key are development keys. Their private keys exist only on the machine that generated them and must never be trusted by a cluster. Production keys are generated offline (`lw app keygen`), the private keys go into the repository secrets above (environment `production`, optional `…_PASSPHRASE`), and the public keys replace the `.dev.pub` files. `index build` refuses a key that isn't in `keys/`, so nothing is published with a production key until its public key is committed.

## CI

`.github/workflows/loadweaver-app-catalog.yml` runs on every change to the catalogs (and to the `app` CLI or the format library):

| Job                      | Checks                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validate and Policy Lint | `lw app verify` on both catalogs (structure, publishers, takedowns, lint), `validate` + `lint` of every changed package, the catalog content tests       |
| Signature Checks         | No private key in the catalogs; community `package.sig` against the keys registered for the publisher                                                    |
| Trivy                    | Every image of the changed packages (`aquasecurity/trivy-action`, the repository's gate: critical findings with a fix fail)                              |
| Test Install             | Renders each changed package into the `Deployment` an install plans (dry run, artifact); with a sandbox cluster configured, `loadweaver plan` against it |

### Test install

Without a sandbox the job is a dry run: the same rendering and compose parsing the control plane does for an install plan, with secret references into the project `app-dry-run`. For real plans, set up a sandbox cluster:

1. A small Loadweaver cluster (a lab or a single node) with a project, by default `app-dry-run` (repository variable `LOADWEAVER_APP_SANDBOX_PROJECT` to change it).
2. In that project, a secret for every secret name the packages use (dummy values).
3. A personal access token of a project operator (`resources:read plans:create`), stored with the cluster URL as the repository secrets `LOADWEAVER_APP_SANDBOX_URL` and `LOADWEAVER_APP_SANDBOX_TOKEN`. Secrets don't reach pull requests from forks, so those PRs stay dry runs; a maintainer re-runs the job from a branch after the review.

The job then runs `loadweaver plan -f <deployment>` per package: failure analysis, quotas, policies, image resolution and secret references against a real control plane, without applying.

### Publishing

`.github/workflows/loadweaver-app-catalog-publish.yml` runs on `main` when a catalog changes, by hand (dry run by default) and from the release workflow (`publish-loadweaver-app-catalog`, after the container images are pushed). Per catalog, skipped with a warning without its key secret:

1. Release only: `lw app bump` creates the release's version of every official app from its newest version, re-pinning the ForePath images to the digests the release pushed; then validate and lint.
2. `lw app verify` (community: `--require-signatures`).
3. `lw app index build` with the key from the secret: the Git catalog layout, verified and uploaded as an artifact.
4. `lw app publish oci`: packages and signatures first, the index last. Published versions are immutable; a version tag that points at a different artifact is refused.
5. Release only: a pull request with the bumped packages, so the repository and the registry agree. Merge it soon: a publish from `main` without it would list the release's versions no more.

## Review

Community submissions are pull requests (template and rules in the catalog's `README.md` / `CONTRIBUTING.md`). After CI passes, a maintainer checks the publisher (identity for new publishers; `verified` only after confirming control of the upstream project), the upstream images and digests, every lint exception, that the README matches the compose, and the licence (`LicenseRef-…` free tiers need two maintainers). Official packages are reviewed like any other change of this repository.

## Reports and takedowns

- The console's **Report** button opens the catalog's issue form (`reportUrl` in `catalog.yaml`, here `.github/ISSUE_TEMPLATE/loadweaver-app-report.yml`). There is no central service.
- A takedown is an entry in `takedowns.yaml` (`app`, `versions: all` or a list, a `reason` users read, `at`). The next publish signs it into the index; refreshing clusters hide the versions and flag installed copies (inbox warning, badge). Urgent cases are taken down first and investigated after.
- Lifting a takedown removes the entry; a fix is a new version.

## Moving the catalogs to their own repositories

The catalogs are self-contained folders, so the move is mostly a copy:

1. Create the repositories (e.g. `forepath/loadweaver-apps`, `forepath/loadweaver-community-apps`) and copy each folder's content to the repository root, with history if wanted (`git filter-repo --subdirectory-filter apps/loadweaver/app-catalog/community`). `community/.github/` (PR template, issue forms) becomes active there.
2. Copy the two workflows, changing `apps/loadweaver/app-catalog/<catalog>` to `.` and installing the CLI from the Loadweaver release (`loadweaver` binary) instead of building it.
3. Move the key secrets and the sandbox secrets to the new repositories; set `reportUrl` in `catalog.yaml` to the new repository's issue form.
4. Keep the registry repositories (`ghcr.io/forepath/loadweaver-apps`, `…-community-apps`) and the catalog keys: clusters keep working without a change. For Git catalogs, clusters point their catalog URL at the new repository.
5. Remove the folders, the workflows and the `publish-loadweaver-app-catalog` job here (the official catalog's release bump then runs in its own repository, triggered by the release).
