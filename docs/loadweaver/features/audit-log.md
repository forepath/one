# Audit Log

Every change is recorded in the audit log **in the same transaction** as the change itself, so no change can exist without its entry.

- **Append-only**: the database rejects updates, deletes and truncation of audit entries.
- **Hash-chained**: each entry stores the hash of the previous one; modifying, removing or reordering entries breaks the chain.
- **Verify**: `GET /api/cluster/audit/verify` (auditors and cluster admins, PAT scope `audit:read`) recomputes the chain, reports the first broken entry and compares it with the chain-head anchors.
- Secret values are never recorded, only versions or hashes.

Recorded today: cluster bootstrap, join token creation and revocation, node join / re-join / cordon / drain / leave, certificate and WireGuard key rotation, plan applies, terminal sessions (`terminal.open` / `terminal.close`), file writes in replicas and volumes (`files.*`), debug tunnels (`tunnel.open` / `tunnel.close`, see [Terminals, files and tunnels](./terminals-files-and-tunnels.md#audit)) and every Git action (`git.connection.*`, `git.sync`, `git.push-rejected`, `git.pr-opened`, `git.commit-back`, `git.export`, `git.sops.identity-created`, see [GitOps](./gitops.md#audit)) and of the plan bot (`git.pr.*`, `git.command.*`, `git.review-approval`, `git.account.link` / `unlink`, see [Plan bot](./plan-bot.md#audit)).

Search, export, the mirror in the log store, chain-head anchoring and SIEM forwarding: see [Audit and export](./audit-and-export.md).
