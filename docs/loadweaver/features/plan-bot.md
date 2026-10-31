# Plan bot (GitHub and GitLab)

On GitHub and GitLab, Loadweaver plans every pull / merge request of a [connected scope](./gitops.md) and applies it when someone comments `loadweaver apply`, like Atlantis. **Merging does not apply anything**: the apply comes first, and the bot merges afterwards, so the default branch matches what runs.

Gitea / Forgejo and plain Git keep the basic flow of [GitOps](./gitops.md) (a plan per push to the branch, commit statuses).

## Flow

1. A pull request against the connection's branch is opened, reopened or pushed to. Loadweaver fetches its head (`refs/pull/<n>/head`, GitLab `refs/merge-requests/<n>/head`, so forks work too) and plans it against the cluster, exactly like a push ([sync](./gitops.md#sync): secret scanning, SOPS, validation, scope rule, conflicts). The plan's `source` names the connection, commit, ref and `pr`.
2. The plan **locks** the resources it changes (the same locks applies take, [Plan and apply](./plan-and-apply.md)). Other plans can't be applied while a pull request holds them, and other pull requests show them as "locked by others". Locks are all or nothing: if another pull request holds one of them, this one gets none until it is planned again.
3. The bot posts **one sticky comment** (marker `<!-- loadweaver:plan -->`) and updates it on every push; the commit gets the status `loadweaver/plan` (can be made a required check).
4. `loadweaver apply` by a linked account with the role for it: the pull request must be **mergeable** and the scope's **approval rules** must be met. The plan is applied like any other ([tracked apply, rollback](./plan-and-apply.md)).
5. After a successful apply the bot **merges** the pull request (`autoMerge`, default on) and posts the result. It merges exactly the applied commit (the provider's `sha` parameter): if the head moved since the plan, nothing is merged and the comment says the pull request needs a new plan. A plan limited to one project or path (`loadweaver plan <x>`) is never merged afterwards (only part of the pull request runs). A failed apply rolls back, the bot posts why, and the pull request stays open.
6. A closed pull request releases its locks and discards its plan.

A new push replaces the plan: the previous one is discarded and its locks move to the new one.

**Forks.** A pull request from another repository (fork, also a deleted fork whose head repository GitHub reports as `null`) is not planned automatically: planning resolves images and talks to registries named in the files, and a fork's head is anyone's code. The comment says so; a linked account with the role for it plans it with `loadweaver plan`. A new push to the fork drops that plan again.

### Merged without apply

A pull request merged without `loadweaver apply`, or a direct push to the default branch, applies nothing. The default branch's new head becomes a pending plan and the scope is **"default branch ahead of cluster"**: in `GET /api/drift`, in the needs-attention inbox and in every following pull request comment (the plans of later pull requests contain those changes too, since they are planned against the cluster).

### Authoritative scopes

In [authoritative mode](./gitops.md#authoritative), UI and API changes become a pull request (branch `loadweaver/plan-<id>`). When the bot plans that pull request, the original UI plan is discarded with `source.supersededBy` pointing to the pull request's plan (which has `source.supersedes`).

A pull request's plan can only be applied through `loadweaver apply` on the pull request; applying it from the console or the API answers `409` with that reason.

## The comment

- status (pending and which projects still need an approval, applying, applied, rolled back) and the last command's result;
- links to the plan (`/activity/plans/<id>`) and the map overlay (`/observe/topology?mode=plan&plan=<id>`) in the console (`LOADWEAVER_CONSOLE_URL`, else `LOADWEAVER_PUBLIC_URL`);
- changes per resource, grouped by layer (deployments, policies and groups, DNS, BGP, IPAM, cluster / sites / nodes / projects);
- effects per layer (tunnels, routing, filtering, DNS, ...) and replica starts / stops / moves;
- pins (`loadweaver apply --confirm` applies unacknowledged ones), failure analysis, quota and capacity (N+1, capacity findings, risky projects), image scan and policy results, other warnings;
- drift of the touched resources: "default branch ahead of cluster", resources changed outside Git since the last sync (`git-conflict`), failed rollbacks on the same resources;
- locks held by other pull requests or plans of this connection; locks of other scopes say "another change" without naming their pull request or plan, and failed rollbacks of other scopes are listed without id or error (the comment is public).

Long comments are capped (60,000 characters) with a note; long lists end with "… and N more". Text from plans is escaped (no HTML, no mentions). A plan that can't be made (secret scanning, invalid YAML, quota) shows the reason instead.

## Commands

The first non-empty line of a comment, case-insensitive:

| Command                           | Needs                                                                                       | Does                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `loadweaver plan [project\|path]` | developer in the scope's project (cluster scope: infrastructure rights)                     | plans again, optionally only one project or the files below one path     |
| `loadweaver apply [--confirm]`    | the rights for the plan's changes, a mergeable pull request, the approvals the project asks | applies the plan, merges after success                                   |
| `loadweaver approve`              | operator or admin of a touched project ([approvals](./projects-and-access.md))              | approves the plan                                                        |
| `loadweaver unlock`               | developer in the scope's project                                                            | releases the locks and discards the plan (`loadweaver plan` plans again) |
| `loadweaver drift`                | read access to the scope                                                                    | lists the scope's drift                                                  |
| `loadweaver help`                 | a linked account                                                                            | lists the commands                                                       |

Commands only count from **linked accounts** (see below); the roles are the linked user's cluster and project memberships, as for any API call (a global admin login gives no extra rights here, like a personal access token). Anything else gets a reply with the reason. The bot reacts with 👀 when it picks a command up and 👍 / 👎 with the outcome. Its own comments and other bots are ignored.

How a comment is trusted:

- **The comment is read back from the provider.** The webhook payload only decides whether to look; author (numeric user id), body and creation time come from `GET /repos/{o}/{r}/issues/comments/{id}` (GitHub, must belong to this pull request) or `GET /projects/:id/merge_requests/:iid/notes/:note_id` (GitLab, no system notes). A payload claiming another author changes nothing.
- **Once.** Delivery ids (`X-GitHub-Delivery`, `X-Gitea-Delivery`, `X-Gitlab-Event-UUID`) and comment ids are recorded (`lw_git_webhook_deliveries`, kept 7 days): a replayed delivery is answered `{ status: 'ignored' }`, a comment acts at most once.
- **Only on the plan it saw.** `apply`, `approve` and `unlock` refuse comments written before the pull request's current plan was created ("comment again to act on the new plan"; provider times have second precision, one second of slack).
- **Only on the linked instance.** Accounts are linked on the instance of `Cluster.spec.git` (`github.apiUrl`, `gitlab.url`). Commands on a connection whose API is another instance get "accounts aren't linked for this instance"; reviews there don't count either.
- **Rate limit.** At most 10 commands per commenter and connection in 10 minutes (`LOADWEAVER_GIT_BOT_COMMANDS_PER_10MIN`); more are ignored without a reply (logged).
- **Repository.** Deliveries whose `repository.full_name` / `project.path_with_namespace` isn't the connection's repository are ignored.

Every command of a linked account is audited as `git.command.<name>` with the pull request, the head commit, the comment id, the provider login, the Loadweaver user and the outcome (and the reason of a refusal). Commands of unlinked accounts are audited once per login, connection and hour (`unauditedSince` counts the ones in between).

### Authors can't approve

The plan of a pull request records the Loadweaver user linked to the pull request's author (`source.authors`, from the provider API's numeric author id); a plan of a default-branch push records the linked user of the push's sender (`sender.id` / `user_id` of the push delivery, a hint that only excludes). Authors can't approve the plan (`loadweaver approve`, the console, the API: "the author of a change cannot approve it"), approvals they gave don't count when it is applied, and the pull request author's own review never counts as an approval. Authors without a linked account aren't known and don't block anything.

### Mergeable

- not a draft, not closed, no merge conflicts (GitHub `mergeable`, GitLab `detailed_merge_status`);
- every other check green: GitHub commit statuses and check runs, GitLab commit statuses and pipeline jobs (allowed failures don't count); Loadweaver's own `loadweaver/plan` status is ignored;
- GitHub: not behind the base branch, and the **review decision** of branch protection / code owners (GraphQL `pullRequest.reviewDecision`): `REVIEW_REQUIRED` ("it needs the reviews GitHub requires") and `CHANGES_REQUESTED` block, like GitLab's `not_approved`; no answer blocks until GitHub answers;
- GitLab: no unresolved discussions, approvals GitLab requires, rebase needed, and the other merge blockers GitLab reports.

### Approvals by review

With `approvalByMergeReview` on the connection, the latest approving review of a linked account on the current head commit counts as that user's Loadweaver approval when `loadweaver apply` runs, if the user is an operator or admin of the project and not an author of the change (audited as `git.review-approval`). Otherwise approvals come from `loadweaver approve` or the console.

- GitHub: reviews carry the commit they were given on; only reviews of the current head count.
- GitLab keeps approvals across pushes unless the project resets them. Approvals count if the project has **reset approvals on push** (`GET /projects/:id/approvals` → `reset_approvals_on_push`), or if the approval (its "approved this merge request" system note) is newer than the push of the current head (the merge request version of that head). Otherwise they are ignored, and the reply says so ("N GitLab approval(s) ignored ...").

## Account linking

Users link their GitHub / GitLab account in the console (**Account › Git accounts**):

1. `POST /api/git/accounts/{github|gitlab}/authorize` returns the provider's authorize URL with a **state** signed with HMAC-SHA256 (user, provider, nonce, expiry ≤ 10 minutes; key derived from `ENCRYPTION_KEY`). The nonce is stored and deleted on first use (single use).
2. The provider redirects to `GET /api/git/accounts/{provider}/callback` (public). The state is checked in constant time, the code is exchanged (`https://github.com/login/oauth/access_token`, `<gitlab>/oauth/token`), the user is read once (`/user`). Nothing is linked yet: the provider's **user id and login** are kept as a **pending link** for the user who started the flow (new nonce, 10 minutes, `lw_git_pending_links`). The OAuth token is discarded.
3. The callback redirects to `<console>/account/git-accounts?confirm=<nonce>` or `?error=<code>` (`invalid-state`, `denied`, `not-configured`, `exchange-failed`, `already-linked`). The target is fixed: nothing from the callback request decides where the browser goes (a flow started through a trusted fleet returns to the fleet console page recorded in the signed state, below).
4. The console asks "Link `<login>` on GitHub / GitLab to your account?" (`GET /api/git/accounts/pending/{nonce}`) and confirms with `POST /api/git/accounts/confirm` `{ nonce }` (or cancels with `DELETE /api/git/accounts/pending/{nonce}`). Only the signed-in user who started the flow sees and confirms it (others get `404`); unconfirmed links expire. So a victim lured into finishing someone else's flow links nothing.

One account per provider and user; one Loadweaver user per provider account. Commands are matched by the provider's numeric user id, so renaming the login doesn't break the link.

**Through a fleet** (3.41): the links are the signed fleet person's (`fleet:<issuer>:<user>`, never the fleet's service user); the callback stays on the cluster's public URL and returns to the fleet console's page the fleet named in its signed request (kept in the signed state; see [Fleet](./fleet.md)). A fleet grant is only known on requests the fleet signs, so commands and merge-review approvals of a fleet-linked account act with the roles the cluster itself grants that person id — today none: the bot refuses them with a reply saying so (plan, approve and apply through the console instead). A grant remembered from an earlier claim is never used.

## Setup

### Cluster settings

`Cluster.spec.git` (changed by plan, cluster admins). Secrets are references (`secret://<project>/<name>`, [Secrets](./secrets-and-encryption.md)):

```yaml
spec:
  git:
    github:
      appId: 123456 # GitHub App id
      privateKey: secret://ops/github-app-key # the app's PEM private key
      clientId: Iv1.0123456789abcdef # the app's OAuth client id (account linking)
      clientSecret: secret://ops/github-app-oauth
      # GitHub Enterprise Server:
      # webUrl: https://ghe.example.com
      # apiUrl: https://ghe.example.com/api/v3
      # caCertificate: |  (PEM, for a private CA)
    gitlab:
      url: https://gitlab.example.com # default https://gitlab.com
      applicationId: 0123abcd... # OAuth application (account linking)
      applicationSecret: secret://ops/gitlab-oauth
```

Environment of the control plane:

| Variable                 | Meaning                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `LOADWEAVER_PUBLIC_URL`  | The control plane's public URL; the OAuth callback is `<url>/api/git/accounts/.../callback`                         |
| `LOADWEAVER_CONSOLE_URL` | The console's URL for links in comments and statuses and the callback's redirect (default: `LOADWEAVER_PUBLIC_URL`) |

### GitHub App

Create a GitHub App (organization or user settings, developer settings):

- **Permissions**: Contents read and write, Pull requests read and write, Issues read and write (comments and reactions), Commit statuses read and write, Checks read (optional: check runs then count for mergeability), Metadata read.
- **Events**: Pull request, Issue comment, Push.
- **Callback URL** (user authorization): `https://<api>/api/git/accounts/github/callback`.
- **Webhook**: leave the app's webhook off and add a webhook per repository instead (`https://<api>/api/git/webhooks/<connection>`, content type JSON, the connection's webhook secret, the events above), since every connection has its own derived secret.
- Generate a private key and store it as a secret; set `appId`, `privateKey`, `clientId`, `clientSecret`.

Install the app on the repositories. A GitHub connection with `githubApp: true` and without its own `credentials` then uses an installation token (app JWT signed RS256 → `GET /repos/{owner}/{repo}/installation` → `POST /app/installations/{id}/access_tokens`, cached until shortly before it expires, limited to that repository) for Git over HTTPS, statuses, comments and merges. A connection with its own token (PAT) uses that instead.

Only **cluster admins** may set `githubApp` on a connection: the app may be installed on repositories of other teams, and a project admin must not be able to point it at one. When someone else changes the connection's repository, API URL or provider, `githubApp` is turned off.

The app's JWT and installation tokens only go to the cluster's GitHub: tokens are minted against `Cluster.spec.git.github.apiUrl` (with its `caCertificate`), never a connection's API URL or CA, and a connection only gets one if its API URL is that same API and its repository is on the host of `webUrl` / `apiUrl`.

### GitLab

- A **project or group access token** as the connection's `credentials` (role Developer or Maintainer, Maintainer if protected branches need it for merging; scopes `api`, `read_repository`, `write_repository`). The bot comments as the token's bot user.
- A **webhook** per project: `https://<api>/api/git/webhooks/<connection>`, secret token = the connection's webhook secret, triggers Push events, Merge request events, Comments.
- For account linking, an **OAuth application** (admin area or group / user settings): redirect URI `https://<api>/api/git/accounts/gitlab/callback`, scope `read_user`, confidential; set `applicationId` / `applicationSecret`.
- Self-managed: `Cluster.spec.git.gitlab.url`, and `apiUrl` / `caCertificate` on the connection where needed.

## Operations

- Events of one connection are handled one after another (and under the connection's lease across replicas); a webhook is answered right away (`202`, `{ status: 'queued' }`). At most 50 events per connection wait; more are dropped (`ignored`, logged). An event lost to a restart or dropped is recovered by the next push or `loadweaver plan`.
- Apply results are posted once (claimed atomically); results of applies tracked on another replica are picked up within 15 seconds.
- Provider errors of the bot are kept on the pull request (`lastError`), on the connection and in the logs; tokens never appear in them.

## Audit

| Action                                    | When                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `git.pr.planned`                          | a pull request head was planned (commit, plan, state)                                                      |
| `git.pr.applied`                          | the result of a bot apply (plan, status)                                                                   |
| `git.pr.closed` / `git.pr.merged`         | a pull request closed / merged (applied or not)                                                            |
| `git.command.<name>`                      | every command, with pull request, commit, comment, login, user, outcome (unlinked accounts: once per hour) |
| `git.review-approval`                     | a review counted as a Loadweaver approval                                                                  |
| `git.account.link` / `git.account.unlink` | account linking (on confirmation)                                                                          |
| `plan.superseded`                         | a UI plan replaced by its pull request's plan                                                              |

## API

| Endpoint                                      | Who / PAT scope                     | Purpose                                          |
| --------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `GET /api/git/accounts`                       | users / `git:accounts`              | the caller's linked accounts                     |
| `POST /api/git/accounts/{provider}/authorize` | users / `git:accounts`              | the provider's authorize URL (signed state)      |
| `GET /api/git/accounts/{provider}/callback`   | public (the provider's redirect)    | records a pending link, redirects to the console |
| `GET /api/git/accounts/pending/{nonce}`       | the flow's user / `git:accounts`    | the pending link (provider, login)               |
| `POST /api/git/accounts/confirm`              | the flow's user / `git:accounts`    | confirms the pending link                        |
| `DELETE /api/git/accounts/pending/{nonce}`    | the flow's user / `git:accounts`    | cancels it                                       |
| `DELETE /api/git/accounts/{id}`               | the account's user / `git:accounts` | unlink                                           |
| `POST /api/git/webhooks/{connection}`         | public, signed                      | pull request, comment and push deliveries        |

## Not there yet

- A Gitea / Forgejo bot adapter (their APIs and webhooks are GitHub-like); they keep commit statuses.
- GitHub check runs as Loadweaver's own check (the status is a commit status; check runs of other apps count for mergeability with the Checks permission).
- A queue that survives restarts for webhook deliveries (the next push or `loadweaver plan` recovers).
- Committer identities of pull request commits as authors (only the pull request author and the pusher of default-branch commits are recorded).
