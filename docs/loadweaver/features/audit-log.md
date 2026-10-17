# Audit Log

Every change is recorded in the audit log **in the same transaction** as the change itself, so no change can exist without its entry.

- **Append-only**: the database rejects updates, deletes and truncation of audit entries.
- **Hash-chained**: each entry stores the hash of the previous one; modifying, removing or reordering entries breaks the chain.
- **Verify**: `GET /api/cluster/audit/verify` (auditors and cluster admins, PAT scope `audit:read`) recomputes the chain and reports the first broken entry.
- Secret values are never recorded, only versions or hashes.

Recorded today: cluster bootstrap, join token creation and revocation, node join / re-join / cordon / drain / leave, certificate and WireGuard key rotation, plan applies.
