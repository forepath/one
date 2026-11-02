# App Store

The app store installs apps from signed catalogs into a project with a few clicks: the official ForePath catalog (Agenstra, Decabill first), private catalogs (a Git repository or an OCI registry) and the catalog a [fleet](./fleet.md) hosts. An installed app is a normal [deployment](./deployments-and-jobs.md): it goes through plan and apply, Git, approvals and Terraform like everything else. Publishing apps is covered in [App store publishing](./app-store-publishing.md).

The app store is an **additional** way to deploy Agenstra and Decabill; their Docker Compose setups, Decabill's bundled server stacks and Agenstra Cloud stay available.

## Catalog sources

Catalogs are configured in `Cluster.spec.appStore` and changed through plans (cluster admins):

```yaml
kind: Cluster
spec:
  appStore:
    allowedTrust: [official, verified] # default; add community to allow community apps
    catalogs:
      - name: official # preconfigured, disabled until enabled
        type: oci
        url: oci://ghcr.io/forepath/loadweaver-apps
        official: true
        enabled: true
      - name: acme
        type: git
        url: https://git.example.com/acme/apps.git#catalog # optional #<dir>: the catalog's folder in the repository
        ref: main # a branch, a tag (refs/heads/… / refs/tags/… to be explicit) or a full commit SHA; default main
        publicKey: |
          -----BEGIN PUBLIC KEY-----
          ...
          -----END PUBLIC KEY-----
        enabled: true
      - name: fleet
        type: fleet
        url: https://fleet.example.com # key from the trusted-fleet registration when no publicKeys are given
        enabled: true
```

- Without `appStore` the official catalog is listed, **disabled**. A list without an official catalog gets it added, disabled.
- The official catalog verifies with the ForePath key that ships with Loadweaver: `LOADWEAVER_APP_CATALOG_OFFICIAL_KEY` (PEM; `\n` escapes accepted). Its location is `LOADWEAVER_APP_CATALOG_OFFICIAL_URL` (default `oci://ghcr.io/forepath/loadweaver-apps`; a Git `https://` URL works too, with `LOADWEAVER_APP_CATALOG_OFFICIAL_REF`). **A catalog without a key is `untrusted` and never fetched**, so the official catalog can't be used until its key is configured.
- Projects only see enabled catalogs. `allowedTrust` decides which trust labels projects may install; other apps are listed with `installable: false` and `notInstallableReason: trust`.
- **Git `ref`**: a branch (`main`), a tag (`v1.2.0`), either spelled out (`refs/heads/main`, `refs/tags/v1.2.0`), or a full commit SHA (40 or 64 hex). A bare name is looked up on the remote; a name that is both a branch and a tag is refused (spell it out). Branches and tags are fetched with `--depth 1`; a commit too where the server allows fetching it directly, otherwise the branches and tags are fetched and the commit must be on one of them. The cache is bound to the `ref` as written: a moving branch is followed on every refresh, a commit stays put, and so does a tag unless it is moved (an index older than the cached one is refused either way). The commit the `ref` resolved to at the last successful refresh is shown: `resolvedCommit` in `GET /api/apps/catalogs` and, in **Setup**, the catalog row's short SHA (the full one on hover). It keeps the commit of the index being served after a failed refresh, and is empty after the source changed until the next successful refresh (and for OCI / fleet catalogs).
- **`minLoadweaver`**: an app version that needs a newer Loadweaver than the control plane runs (`VERSION`) is listed with `installable: false`, `notInstallableReason: loadweaver-version`, `minLoadweaver` and `loadweaverVersion`; install and update answer 400 (`<app> <version> needs Loadweaver 4.2.0 or newer; this cluster runs 4.1.0`). Lists use the version's `minLoadweaver` from the index (official and community indexes get it from `lw app index build`, a fleet's index from the uploaded package's manifest; packages a fleet stored before it recorded the field are filled by the fleet's startup backfill), the app page and the plans the signed manifest. A development build (no or an unknown `VERSION`, `0.0.0…`, a `-dev` pre-release) isn't checked; the plan answer then carries a warning.
- **The catalog of a trusted fleet is a fixed entry.** For every [trusted fleet](./fleet.md) whose registration carries a catalog, the configuration in effect has a `type: fleet` entry for that catalog URL, enabled, with the keys of the registration. A stored `type: fleet` entry for the same URL (origin + path) becomes that entry and keeps its name; otherwise one is added under the name **pinned with the registration**: the fleet sends its `FLEET_CATALOG_NAME` (default `fleet`) along with the catalog, and the first name the cluster sees stays (a renamed fleet or a later `FLEET_CATALOG_NAME` doesn't change it; installed apps reference it). Registrations from older fleets without a name get one derived from the fleet's name (else its issuer), slugified (`Acme fleet` → `acme-fleet`), pinned the same way. When another catalog already has the name, `-2`, `-3`, … is appended (the same on every read). Writes to `Cluster.spec.appStore` (API, drafts, plans, the fleet's "apply catalog settings") are accepted as they are, but they can't remove or disable it: the entry is derived again on every read, and a stored `enabled: false` for it is ignored. A plan or draft that removes or disables a stored entry for it gets a **warning** (`<name> is managed by fleet <fleet>; disabling or removing it has no effect …`) and still goes through. It disappears by itself once the fleet is removed from the trusted fleets (a stored entry then counts as written again). It changes nothing else: `allowedTrust` still applies to its apps (fleet catalogs list `verified` apps), like the other settings. `GET /api/apps/catalogs` marks it with `fleetManaged: true` and `fleet: { issuer, name }`; **Setup** shows it as "Managed by fleet …" without edit, and **Delivery › Apps** lists its apps.

| Type    | Where the index and packages come from                                                                                                                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oci`   | Registry HTTP API: index `<repo>:index`, packages `<repo>/<app>:<version>` (`+` in a version is `_` in the tag), cosign simple-signing signatures (`sha256-<hex>.sig`). Anonymous pulls with the registry's token flow                                   |
| `git`   | A shallow, detached checkout at `ref`: `index.yaml` + `index.yaml.sig`, `<app>/<version>.tar.gz` + `.sig` (cosign `sign-blob`). Credentials of the cluster's [Git connection](./gitops.md) for the same repository URL when there is one, else anonymous |
| `fleet` | `<url>/api/catalog/index.yaml` (+ `.sig`) and `<url>/api/catalog/packages/<app>/<version>.tar.gz` (+ `.sig`), signed with the fleet's catalog key                                                                                                        |

**Network**: catalog sources must use https and resolve to public addresses (checked on every redirect; registry credentials never follow a redirect to another host). Exceptions: the built-in registry (`oci://registry.lw/<project>/<repo>`, reached over the overlay with a short pull token), the cluster's [registry mirrors](./built-in-registry.md) (a catalog on a mirrored registry is pulled through the mirror first, upstream as fallback, so air-gapped clusters work), and a fleet registered as trusted for that catalog URL (private addresses allowed). Plain http for a trusted fleet's catalog only with `LOADWEAVER_APP_CATALOG_FLEET_ALLOW_INSECURE_HTTP=true` (never in production; local labs where the fleet has no TLS endpoint): it applies to the catalog URL of the registration and to the fetch; the index and packages are verified against the keys either way. A trusted fleet with a self-signed certificate: `LOADWEAVER_APP_CATALOG_FLEET_TLS_REJECT_UNAUTHORIZED=false` (default `true`, ignored in production) skips the certificate check for that fleet's catalog fetches only (a dedicated agent; a redirect to another origin is verified again, every other request keeps verifying). A private CA can instead be trusted with `NODE_EXTRA_CA_CERTS`.

**Fleet catalog keys**: a fleet registers its catalog with its trusted-fleet registration (`PUT /api/trusted-fleets/{issuer}` with `catalog: { url, publicKeys, name? }`; natively by a cluster admin or by the fleet itself). A `type: fleet` catalog without `publicKeys` uses the keys of the trusted fleet whose catalog URL matches (origin + path). The fleet's "apply catalog settings" operation can also pin the keys in `publicKeys`. A new registration with a catalog, or a changed catalog (URL, keys) at re-registration, starts a refresh right away (on one replica); otherwise the next tick (every 5 minutes) fetches the new entry, so no restart is needed.

## Verification and the cache

- Every index is verified against the catalog key(s) **before** it is parsed: ECDSA P-256 / Ed25519, cosign `sign-blob` or simple-signing format. Publisher keys listed in the index must match their key ids.
- Packages are fetched on demand (app page, install, update), must be listed in the index with the archive's digest, and must be signed by a key of the app's publisher.
- Verified indexes and packages are cached in Postgres. The cache is bound to the source it was verified for (type, URL, ref, keys): after a configuration change the old cache is never served.
- A failed refresh keeps serving the last verified index and shows the error (`status: error`). An index older than the cached one is refused, so nobody can roll a catalog back to before a takedown.
- Refreshes run every `LOADWEAVER_APP_CATALOG_REFRESH_MINUTES` (default 360, at least 5) on one control-plane replica, and on demand (`POST /api/apps/catalogs/refresh`, cluster admins). Only enabled catalogs with a key are fetched.
- While the cluster database is read-only, the store serves the cache and refreshes pause (manual refresh answers 503).

## Install

`POST /api/apps/{catalog}/{app}/{version}/plan` (console: Delivery › Apps → Install) with the project, parameters and secret references:

```json
{
  "project": "shop",
  "deployment": "wiki",
  "parameters": { "hostname": "wiki.example.com", "bundlePostgres": true },
  "secrets": { "db-password": "secret://shop/wiki-db" },
  "suggestions": ["groups", "policies", "ingress", "dns", "backups"]
}
```

- Renders the package: parameters checked against the manifest's JSON Schema (form strings are converted), bundled dependencies switched off are removed, `${param}` / `${secret:name}` substituted. Secret references must name secrets of the install's project.
- **Conditional secrets**: a secret with `requiredWhen` (e.g. a payment provider's key, needed only with payments on) is required only while its condition holds; a missing one then refuses the install (422, `secret … needs a secret reference (required while stripeEnabled is true)`). While the condition is off the secret is not wired: the rendered compose has no entry for it (the top-level `secrets` entry and every service's mount, anchored lists included, are removed), exactly as if no reference had been given; a reference given anyway is ignored (not checked, mounted or recorded). The install form shows and requires such a secret only while its condition holds (and sends it only then); the app page names the condition. The same applies to updates: the recorded references are reused, switching the condition on needs the secret, switching it off removes the mount (and the reference from the record).
- Refuses a version whose `minLoadweaver` is newer than the cluster (400).
- Runs the policy lint. Errors (host networking, privileged, host paths, plaintext secrets, unpinned images, non-free licences, …) refuse the install unless the manifest declares an exception with a reason.
- Taken-down versions and trust labels outside `allowedTrust` are refused; an existing deployment of that name is a conflict.
- Creates a **Workspace draft** with the Deployment and, as separate ops, every suggested group, policy, ingress, DNS record and backup policy. Keep or drop them, preview the plan, submit. Suggested resources that exist already are left alone; cluster-level kinds are never suggested.
- The Deployment records its origin in annotations: `apps.loadweaver.com/{catalog,name,version,channel,digest}` (the API shows them as `app`), plus the install inputs `apps.loadweaver.com/parameters` and `apps.loadweaver.com/secrets` (secret references, never values). Suggested resources carry `apps.loadweaver.com/installation: <deployment>`.

Rights: like drafting the Deployment (developer of the project). Browsing needs any project membership or cluster role.

## Update

`POST /api/apps/installed/{project}/{deployment}/update-plan` with `{ "version": "1.3.0" }`:

- Newer versions only (roll back through the plan history), and not beyond the cluster's version (`minLoadweaver`, 400). The recorded parameters and secret references are reused; values in the body win.
- **Backup first**: when the target version's manifest declares `backups`, the Deployment gets the marker `apps.loadweaver.com/backup-before-update` (`{"version":…,"volumes":[…]}`: the volumes the declared backups name, all volumes for a backup without `volumes`), and the answer lists them as `backups` with `status: planned`. **Applying** the plan then backs them up first: the plan goes to `applying` with `progress.phase: backup` (its resources locked, nothing changed yet), the tracker starts the backups (a backup of the volume that is already running counts), and only once all succeeded the update is applied as usual. A failed backup, one that can't be started (e.g. no backup repository), a cancel or no success within `LOADWEAVER_PRE_UPDATE_BACKUP_TIMEOUT_MINUTES` (default 60) fails the plan: status `failed` with the backup error, nothing applied, locks released, the webhook event `plan.failed`; the failed backup itself shows in the inbox like every failed backup. Retry by fixing the backup and planning the update again (or with `"backup": "skip"`). Apps that declare no backups update without one, as does `"backup": "skip"` (in the draft's title and the audit log). Planning needs the developer role only; the backups run with the apply.
- The manifest's **migrations** for the versions after the installed one up to the target become one-off [jobs](./deployments-and-jobs.md#one-off-jobs) in a copy of their service (`before` holds the new version back until they succeeded, `after` runs once everything is up). They run once per apply of the deployment until the next update replaces them.
- Creates a draft with the updated Deployment (based on its current generation, so concurrent edits show as conflicts).

## Uninstall

`POST /api/apps/installed/{project}/{deployment}/uninstall-plan` with a required `dataPolicy`:

| `dataPolicy` | What happens                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `keep`       | The deployment goes, its volumes stay                                                                                |
| `backup`     | Applying the plan backs up every volume first; the deployment goes only once all backups succeeded; the volumes stay |
| `delete`     | Needs `confirm` = the deployment's name. The same plan deletes the volumes once it is applied                        |

The draft also removes the resources the install suggested (`removeSuggested: false` keeps them).

**Final backup** (`backup`): planning starts nothing, so the developer role is enough. The draft's Deployment delete op names the volumes to back up first (`backupFirst`), which the plan carries as `backupVolumes` (also accepted by `POST /api/plans`, only for volumes of Deployments the same plan deletes):

- The draft tray and the draft page show the Deployment's delete op with "Backs up first: data, uploads".
- The plan lists each one as a `backup-volume` workload change (with the nodes holding a copy) and an info warning; the answer of the uninstall route lists them as `backups` with `status: planned`.
- **Applying** the plan runs the same backup phase as an [update](#update): `applying` with `progress.phase: backup` (resources locked, nothing removed yet, the app still running so its backup hooks such as `pg_dump` work), the tracker starts the backups (a running backup of the volume counts) and removes the app only once all succeeded. A failed or unstartable backup, a cancel or no success within `LOADWEAVER_PRE_UPDATE_BACKUP_TIMEOUT_MINUTES` fails the plan (`failed`, `plan.failed`, nothing removed, locks released). Retry by fixing the backup and planning again, or pick another data policy.
- The volumes stay, as with `keep`.

**Deleting the data** (`delete`): the draft gets one `Volume` delete op per volume of the deployment (named `<deployment>/<volume>`), which the plan carries as `deleteVolumes` (also accepted by `POST /api/plans`):

- The plan shows each one as a `delete-volume` workload change (with the nodes holding a copy) and a warning `deletes volume … and its data …` (`destructive: true`), so the preview shows the data loss. The project's part counts as risky (the `risky` approval mode needs an approval), the usual approval rules apply, and the apply needs `confirm: true` (the console asks to confirm the data loss).
- A volume is only deleted together with its Deployment in the same plan; a plan that deletes volumes of a deployment it keeps (or doesn't delete) is refused.
- The volumes are deleted only after the plan was **applied**: a failed or rolled-back apply never loses data. Their placement goes, and the nodes remove the DRBD replica, the LUKS mapping and the logical volume like any copy the control plane moves away. Each deletion is audited (`volume.deleted`); a volume whose deployment exists again by then is kept.
- **Backups are not deleted**: they follow their normal retention and can still be restored.

`keep` and `backup` never delete a volume: an install under the same deployment name uses the kept volumes again.

## Installed apps and takedowns

- `GET /api/apps/installed` lists the installed apps of the projects the caller may read, with newer versions of their channel and the catalog's state.
- Takedowns live in the signed index. On every refresh, installs of a taken-down app version are flagged: an **inbox warning** per install, `app.takedown` in the audit log, and `app.takedown` on the deployment status (`GET /api/projects/{project}/deployments/{deployment}/status`). Taken-down versions are hidden and can't be installed or updated to. The flag clears once the install is updated or removed (or the takedown is lifted).

## API

| Route                                                            | Who                      |
| ---------------------------------------------------------------- | ------------------------ |
| `GET /api/apps/catalogs`                                         | any role                 |
| `GET /api/apps` (`?q`, `?catalog`, `?trust`)                     | any role                 |
| `GET /api/apps/{catalog}/{app}` (`?version`)                     | any role                 |
| `GET /api/apps/installed` (`?project`)                           | readers of the project   |
| `POST /api/apps/{catalog}/{app}/{version}/plan`                  | developer of the project |
| `POST /api/apps/installed/{project}/{deployment}/update-plan`    | developer                |
| `POST /api/apps/installed/{project}/{deployment}/uninstall-plan` | developer                |
| `POST /api/apps/catalogs/refresh`                                | cluster admins           |

Through a fleet the routes are relayed like every page: reads for any grant, plans like drafts (project grants as the signed person), refresh for cluster-wide admins. The full shapes are in the OpenAPI spec.
