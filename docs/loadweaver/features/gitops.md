# GitOps

Everything declarative can live in Git. The UI, the API and Git are editors of the same YAML ([Plan and apply](./plan-and-apply.md)): a push to the connected branch becomes a **plan**, and the commit status shows how that plan is doing. Runtime actions, secret values and live state stay out of Git.

## Connections

The cluster scope and every project can connect **their own** repository, branch and path (a monorepo with one directory per scope works too). Connections are managed directly through the API, like memberships, never through plans:

- the cluster connection by cluster admins;
- a project connection by that project's admins.

| Field                   | Meaning                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`               | Omitted for the cluster scope.                                                                                                                             |
| `provider`              | `github`, `gitlab`, `gitea` (also Forgejo) or `git` (plain Git: no commit statuses, no pull requests).                                                     |
| `repoUrl`               | `https://…`, `ssh://user@host[:port]/path` or `user@host:path`. Nothing else: no `file://`, `git://`, `ext::`, plain HTTP, local paths or URL credentials. |
| `branch`, `path`        | The branch and the directory inside the repository (`''` = the root). The default branch is what runs.                                                     |
| `mode`                  | `authoritative` or `bidirectional`, see [Modes](#modes).                                                                                                   |
| `credentials`           | A secret reference (`secret://<project>/<name>`), see [Credentials](#credentials). A project connection can only use that project's own secrets.           |
| `apiUrl`                | Provider API base for self-hosted GitLab / Gitea / GitHub Enterprise; derived from the repository host otherwise.                                          |
| `caCertificate`         | PEM CA certificate(s) for a Git host behind a private CA (Git over HTTPS and the provider API).                                                            |
| `webhook`               | Accept signed webhooks (default on).                                                                                                                       |
| `pollIntervalSeconds`   | Poll the branch (10 s to 1 day); null = webhooks only. At least one of webhook and polling is required.                                                    |
| `membershipsFromGit`    | Import `access.yaml` from the path and commit direct changes back, see [Memberships](#memberships-from-git). Cluster admins and the project creator only.  |
| `sops`                  | Decrypt SOPS-encrypted files with the cluster's age identity (see [SOPS](#sops)); `sopsRecipient` shows the recipient to encrypt to.                       |
| `approvalByMergeReview` | A merge review counts as the approval ([plan bot](./plan-bot.md#approvals-by-review)).                                                                     |
| `autoMerge`             | Merge the pull request after a bot-triggered apply ([plan bot](./plan-bot.md)).                                                                            |
| `githubApp`             | GitHub without own `credentials`: use the cluster's GitHub App ([plan bot](./plan-bot.md#github-app)). Only cluster admins may turn it on.                 |

One connection per scope. Creating a connection returns its **webhook secret** once; admins can read it again (`GET …/webhook-secret`, audited). It is derived from the cluster's `ENCRYPTION_KEY`, the connection id and a random salt, so nothing secret is stored with the connection. A leaked secret is revoked with `POST …/webhook-secret/rotate` (admins of the scope, audited as `git.connection.webhook-secret-rotated`): a new salt, the old secret stops working at once, the response has the new one (`webhookGeneration` counts rotations); update it at the provider.

`PATCH` keeps omitted fields; `null` only clears the optional ones (`credentials`, `apiUrl`, `caCertificate`, `pollIntervalSeconds`) and is a `400` for the others. Another repository, branch or path starts from scratch: the synced head and the per-resource sync state are forgotten.

### Credentials

The referenced secret holds one of:

- a token (HTTPS): GitHub PAT / app installation token, GitLab project / group / personal access token, Gitea / Forgejo token;
- an SSH private key (deploy key) for SSH repositories;
- JSON with both and an optional user name: `{ "token": "…", "sshPrivateKey": "…", "username": "…" }` (an SSH repository on GitHub / GitLab / Gitea still needs the token for commit statuses and pull requests).

Over HTTPS the token is sent as an `Authorization: Basic` header (`x-access-token` on GitHub, `oauth2` on GitLab, any user on Gitea, `git` for plain Git unless `username` is set), through Git's environment, never in the URL, the command line or logs. Over SSH the key is written to a temporary file (`0600`) and used alone (`IdentitiesOnly=yes`, no agent).

### SSH host keys

The first contact pins the server's host key on the connection (trust on first use; `hostKey`, audited as `git.connection.host-key-pinned`). Afterwards a different key stops every operation of that connection with an error until an admin resets it (`POST …/host-key/reset`), for example after a legitimate key rotation. The next contact pins the new key.

## Sync

A new head commit on the branch (webhook, polling or `POST …/sync`) is synced:

1. The `*.yaml` / `*.yml` files below the path are read (at most 5,000 YAML files, 1 MiB per file, 8 MiB together; other files don't count, but the walk stops after 100,000 entries). A checkout larger than 256 MiB is refused.
2. [Secret scanning](#secret-scanning): a plaintext secret rejects the push.
3. SOPS-encrypted files are decrypted.
4. The resources are validated. Invalid documents, duplicates across files and resources outside the connection's scope fail the sync with the file and the reason.
5. The scope's Git content is **complete**: resources of the scope that are missing in Git are planned as **deletions** (never the `Cluster` resource or nodes). A path without any resource files is refused instead of deleting everything; [export](#export-to-repo) first.
6. A plan is created with the changed resources and the deletions, with `source = { kind: 'git', connection, commit, ref, author }`. A commit without differences creates no plan (`no-changes`).

Git authors aren't Loadweaver users: a Git plan counts as a **developer's** in every project it touches, so the project's approval rules apply; whoever applies it needs the rights for it. Where the author is known through a linked account (the pusher of the head, from the push webhook's sender; the author of a pull request, [plan bot](./plan-bot.md#authors-cant-approve)), the plan lists them in `source.authors` and they can't approve it.

**Scope rule:** a project connection carries only that project's resources. The cluster connection carries cluster-level resources and the resources of projects without their own connection.

### Conflicts

For every resource Loadweaver keeps the file it lives in and the generation that matched Git at the last sync or write. If a resource was changed (or created) outside Git since then and the push changes or deletes it, the plan gets a `git-conflict` warning naming the resource. Nothing is overwritten silently: the plan shows both, and applying it is a decision.

Loadweaver's own writes follow the same rule: if a commit-back or pull request branch would touch a file that changed in Git while it was being written, it isn't overwritten; the write fails and the next sync shows the conflict.

### Commit status

On GitHub, GitLab and Gitea the commit gets the status `loadweaver/plan`, which follows the plan:

| Commit state                       | Status                       |
| ---------------------------------- | ---------------------------- |
| plan pending / approved / applying | `pending`                    |
| plan applied, or no changes        | `success`                    |
| plan failed / rolled back          | `failure` (GitLab: `failed`) |
| plan discarded                     | `error` (GitLab: `canceled`) |
| push rejected or not plannable     | `failure` with the reason    |

With `LOADWEAVER_CONSOLE_URL` (or `LOADWEAVER_PUBLIC_URL`) set, the status links to the plan in the console. Statuses that couldn't be reported are retried for 7 days. Plain Git has no status API.

## Secret scanning

Every push is scanned before anything else. A finding **rejects** the push: no plan, a failed commit status, a `git.push-rejected` audit entry and a critical inbox item. The reason names the file, the line and the rule, never the value.

- Known token formats: GitHub, GitLab, AWS access keys, Slack tokens and webhooks, Stripe, Google API keys, npm, PyPI, Anthropic, OpenAI, SendGrid, Twilio, DigitalOcean, bearer tokens, JWTs, private key blocks.
- Credentials in URLs (`postgres://user:password@…`).
- Credential-named keys (`password`, `token`, `apiKey`, `client_secret`, …, in YAML, env lists and JSON) with a literal high-entropy value, also as block scalars (`password: |` with the value on the next lines) and in flow maps / one-line JSON (`{"password": "…"}`).
- The `data` / `stringData` values of Kubernetes `Secret` manifests, whatever their keys.

Fine in Git: secret references (`secret://project/name`), values that are exactly SOPS ciphertext (`ENC[AES256_GCM,data:…,iv:…,tag:…,type:…]`; text around it is still scanned), the `sops:` metadata block of files that really are SOPS-encrypted (only SOPS keys, the MAC as ciphertext, armored age / PGP envelopes; a hand-written `sops:` block is scanned), image digests, public keys, certificates, `*_FILE` paths, `${VARIABLES}` and placeholders.

**Loadweaver's own writes** are scanned the same way: every file of an export, a commit-back or a pull request branch is checked before the commit. A finding refuses the write (`409` for an export; commit-backs and pull requests fail with the reason), audited as `git.write-refused` and shown on the connection (`lastError`, inbox). Nothing with a plaintext secret is ever committed.

Fix the commit (remove the value, use a secret reference) and push again; also rotate the leaked secret, since it is in the repository's history.

## Modes

### Authoritative

Git is the only way changes are applied. A UI or API plan (and a [drift](./plan-and-apply.md#drift) proposal) touching the scope is still created, so its effect can be reviewed, but it **can't be applied**: Loadweaver pushes the change to a branch `loadweaver/plan-<id>` (changed resources in their synced files, new ones at `<path>/<project|cluster>/<kind>-<name>.yaml`) and opens a pull / merge request. This happens in the background: `POST /api/plans` answers right away with `source.pullRequests: [{ connection, branch, pending: true }]`, and the entry gets the pull request's `url` and `number` (or an `error`) when it is open (a restart retries entries still pending after 5 minutes). Apply answers `409` with a blocker pointing to it. On GitHub and GitLab the [plan bot](./plan-bot.md) plans that pull request, replaces the UI plan with its own (`source.supersededBy` / `supersedes`) and applies it on `loadweaver apply`. On Gitea / Forgejo, merging creates the Git plan that is then applied. On plain Git the branch is pushed without a pull request.

Fix-forward plans of failed rollbacks (`source.kind = system`) stay applicable.

### Bidirectional

UI and API changes apply as usual. After a non-Git plan applied, Loadweaver commits the changed and deleted resources back to the branch (message `Loadweaver plan <id> by <author>`); the commit counts as synced, so it doesn't create a new plan. A failed commit-back is recorded on the connection (`lastError`, inbox) and shows up as a conflict at the next push; [export](#export-to-repo) writes the whole current state again.

## Default branch ahead of cluster

The branch head is what should run. When its plan isn't applied (pending, failed, discarded), or the push was rejected or couldn't be planned, the scope is **ahead of the cluster**: listed in `GET /api/drift` (`gitAhead`) and in the needs-attention inbox. It clears once the head's plan is applied or a later commit matches the cluster.

## Export to repo

`POST /api/git/connections/{id}/export` writes the scope's current state as one commit, one file per resource at `<path>/<project|cluster>/<kind>-<name>.yaml` (and `access.yaml` with memberships from Git). It refuses a path that already has YAML files unless `force: true`, which replaces them. This is how setups built in the UI move to Git; the commit becomes the synced state.

SOPS-encrypted files are never deleted or overwritten by an export, and resources that came from SOPS files are never written in clear: they are skipped and listed in the response (`skipped`). Like every write, the export is [scanned](#secret-scanning) and refused if it would commit a plaintext secret.

## Memberships from Git

Memberships and roles stay direct API (instant revoke, [Projects and access](./projects-and-access.md)), but with `membershipsFromGit` they can also be managed in `access.yaml` in the connection's path, in the [access export format](./projects-and-access.md):

- A sync imports it immediately (direct-API semantics, audited as `access.import` with the commit). A project connection may only list its own project and no cluster members; the cluster connection lists cluster members and the projects it carries.
- `access.yaml` can grant project admin roles, so only cluster admins and the project's creator may turn it on. The same holds for pointing such a connection at other content: changing the repository, branch, path, credentials, provider, API URL or CA by anyone else turns `membershipsFromGit` off (setting it explicitly with such a change is `403`).
- Direct API changes (members, roles, project settings) are committed back to `access.yaml`, so the repository stays complete.

## SOPS

Teams that want secrets versioned with the configuration can keep SOPS-encrypted resource files (age recipients) in the path. With `sops` enabled on the connection, they are decrypted with the **cluster's age identity** during the sync and then handled like any other resource file (validation, scope rule, plan).

- The cluster has **one X25519 age identity**, generated on first need (the first `GET /api/git/sops/recipient` or the first SOPS file), audited as `git.sops.identity-created`. Its public **recipient** (`age1…`) is shown by `GET /api/git/sops/recipient` and on connections with `sops` (`sopsRecipient`).
- The identity itself is stored envelope-encrypted with the cluster [master key](./secrets-and-encryption.md#master-key) and re-wrapped whenever the master key changes. It never leaves the control plane and is decrypted in memory for one decryption only.
- Encrypt to the recipient with the `sops` CLI, for example `sops encrypt --age age1… --in-place loadweaver/shop/db.yaml`, or once for the repository with a `.sops.yaml`:

  ```yaml
  creation_rules:
    - path_regex: loadweaver/.*\.ya?ml$
      age: age1…
  ```

- The decryption (age + SOPS on `node:crypto`: AES-256-GCM values, the SOPS MAC) supports age recipients only; KMS / PGP / Vault recipients, Shamir key groups, comment regexes and YAML aliases are not supported.
- Failures fail the sync with the file and the reason, never a value: SOPS not enabled on the connection, a file encrypted for other recipients, a broken MAC, or a **sealed master key** ("the cluster master key is not available …; SOPS files can't be decrypted until it is unsealed").
- Loadweaver never rewrites encrypted files, and never writes a resource that came from one in clear: such resources are marked in the sync state (`sops`), a commit-back or pull request branch touching one fails with the reason, an export skips it.
- Not there yet: secret **values** in SOPS files are not imported into the secret store. Resources reference secrets (`secret://…`); importing values would go through the secret store's own write path, which the Git sync doesn't use. Decrypted files are resource definitions only.

## Webhooks

Point the repository's push webhook at `https://<api>/api/git/webhooks/<connection>` (`webhookPath` of the connection) with the webhook secret:

- GitHub and Gitea / Forgejo: the secret signs the body (`X-Hub-Signature-256`, Gitea also `X-Gitea-Signature`);
- GitLab: the secret is the token (`X-Gitlab-Token`).

Signatures are checked in constant time over the raw body; unknown connections and wrong signatures get `401`. A push to the connection's branch queues a sync (`202`, `{ status: 'queued' }`). On GitHub and GitLab, pull / merge request and comment events go to the [plan bot](./plan-bot.md); on Gitea / Forgejo and plain Git they are ignored.

- Deliveries are handled once: a repeated delivery id (`X-GitHub-Delivery`, `X-Gitea-Delivery`, `X-Gitlab-Event-UUID`) is answered `{ status: 'ignored' }`.
- Deliveries about another repository (`repository.full_name`, GitLab `project.path_with_namespace`) are ignored (plain Git connections accept deliveries without it).

## Operations

- One control-plane replica runs the polling and status loop; operations on one connection (sync, commit-back, pull requests, export) are serialized across replicas. Both use **leases** in `lw_git_locks` (taken and renewed with single statements, expiring after 2 minutes without renewal), so no database connection is held while git clones or pushes. At most `LOADWEAVER_GIT_CONCURRENCY` (default 4) Git operations run at once per replica. `LOADWEAVER_GIT_SYNC=off` turns the loop off on a replica.
- Git runs as the `git` CLI in a temporary directory per operation (removed afterwards; leftovers of a killed process are removed at startup), shallow, without hooks, user / system configuration or prompts, with timeouts and output limits; on a timeout the whole process group (with ssh / remote helpers) is killed. Checkouts are capped at 256 MiB and 32 MiB read per operation. Only HTTPS and SSH are allowed.
- `POST …/test` answers fixed messages (and the provider API's status code), never a remote response body.
- Commits are made as `LOADWEAVER_GIT_AUTHOR_NAME` / `LOADWEAVER_GIT_AUTHOR_EMAIL` (default `Loadweaver <loadweaver@localhost>`); the Loadweaver user is in the commit message.
- Redirects are not followed over HTTPS (the token header must not reach another host): use the repository's final URL.

## Audit

| Action                                              | When                                                      |
| --------------------------------------------------- | --------------------------------------------------------- |
| `git.connection.create` / `update` / `delete`       | connection changes (with what changed)                    |
| `git.connection.webhook-secret`                     | the webhook secret was read                               |
| `git.connection.webhook-secret-rotated`             | the webhook secret was rotated (generation)               |
| `git.write-refused`                                 | an export / commit-back / PR branch had plaintext secrets |
| `git.connection.host-key-pinned` / `host-key-reset` | SSH host key pinned on first contact, reset by an admin   |
| `git.sync`                                          | a head commit was synced (commit, author, state, plan)    |
| `git.push-rejected`                                 | secret scanning rejected a push (file, line, rule)        |
| `git.pr-opened`                                     | a pull request (or branch) for an authoritative plan      |
| `git.commit-back`                                   | applied changes or access changes committed back          |
| `git.export`                                        | export to repo                                            |
| `git.sops.identity-created`                         | the cluster's SOPS age identity was generated             |

The plan bot's actions are listed in [Plan bot](./plan-bot.md#audit).

## API

| Endpoint                                               | Who / PAT scope                              | Purpose                                                                     |
| ------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/git/connections`                             | readers of the scope / `resources:read`      | connections the caller may see                                              |
| `POST /api/git/connections`                            | scope admins / `git:admin`                   | create (returns the webhook secret once)                                    |
| `GET /api/git/connections/{id}`                        | readers / `resources:read`                   | one connection                                                              |
| `PATCH /api/git/connections/{id}`                      | scope admins / `git:admin`                   | change settings (another URL / branch / path resyncs)                       |
| `DELETE /api/git/connections/{id}`                     | scope admins / `git:admin`                   | disconnect (pending pull request plans are discarded, their locks released) |
| `GET /api/git/connections/{id}/commits`                | readers / `resources:read`                   | synced and written commits with plan and state                              |
| `GET /api/git/connections/{id}/webhook-secret`         | scope admins / `git:admin`                   | the webhook secret (audited)                                                |
| `POST /api/git/connections/{id}/webhook-secret/rotate` | scope admins / `git:admin`                   | a new webhook secret; the old one stops working (audited)                   |
| `POST /api/git/connections/{id}/test`                  | scope admins / `git:admin`                   | reach the repository, pin the SSH host key                                  |
| `POST /api/git/connections/{id}/sync`                  | scope admins / `git:admin`                   | sync the branch head now                                                    |
| `POST /api/git/connections/{id}/export`                | scope admins / `git:admin`                   | export the scope (`force` to replace files; `skipped`: SOPS resources)      |
| `POST /api/git/connections/{id}/host-key/reset`        | scope admins / `git:admin`                   | forget the pinned SSH host key                                              |
| `GET /api/git/sops/recipient`                          | cluster / project members / `resources:read` | the cluster's SOPS age recipient (created on first need)                    |
| `POST /api/git/webhooks/{connection}`                  | public, signed                               | webhook deliveries                                                          |

Account linking and the plan bot's endpoints are in [Plan bot](./plan-bot.md#api).

**Through a fleet** (3.41) the same rules apply to the acting person: cluster-wide admin grants manage every scope; project grants reach the connections only with the fleet's signed identity (the cluster lists what the person may read and lets project admins manage their own project's connection, audited on behalf of them). Webhooks always point at the cluster's own public URL. See [Fleet](./fleet.md#access).
