# Audit Log

Every change is recorded in the audit log **in the same transaction** as the change itself, so no change can exist without its entry.

- **Append-only**: the database rejects updates, deletes and truncation of audit entries.
- **Hash-chained**: each entry stores the hash of the previous one; modifying, removing or reordering entries breaks the chain.
- **Verify**: `GET /api/cluster/audit/verify` (auditors and cluster admins, PAT scope `audit:read`) recomputes the chain, reports the first broken entry and compares it with the chain-head anchors.
- Secret values are never recorded, only versions or hashes.

Recorded today: cluster bootstrap, join token creation and revocation, node join / re-join / cordon / drain / leave, certificate and WireGuard key rotation, plan applies, terminal sessions (`terminal.open` / `terminal.close`), file writes in replicas and volumes (`files.*`), debug tunnels (`tunnel.open` / `tunnel.close`, see [Terminals, files and tunnels](./terminals-files-and-tunnels.md#audit)) and every Git action (`git.connection.*`, `git.sync`, `git.push-rejected`, `git.pr-opened`, `git.commit-back`, `git.export`, `git.sops.identity-created`, see [GitOps](./gitops.md#audit)) and of the plan bot (`git.pr.*`, `git.command.*`, `git.review-approval`, `git.account.link` / `unlink`, see [Plan bot](./plan-bot.md#audit)).

**Acting through a fleet service** ([Fleet service](./fleet.md#access)): requests a fleet relays carry the acting fleet user in `X-Loadweaver-On-Behalf-Of`. When the caller is a PAT with the opt-in scope `fleet:on-behalf-of` (the fleet's service user; only accounts with a cluster-wide role can mint a PAT with this scope, the control plane refuses it for everyone else at token creation / change), every entry recorded for the request gets `details.onBehalfOf` (control characters dropped, at most 255 characters); the actor stays the service user. Other callers' headers are ignored.

Search, export, the mirror in the log store, chain-head anchoring and SIEM forwarding: see [Audit and export](./audit-and-export.md).
