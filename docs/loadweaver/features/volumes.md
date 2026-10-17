# Volumes

Named compose volumes are replicated block devices: **DRBD** on top of **LUKS** on top of an LVM thin volume. A workload always runs next to its volume's primary copy.

```yaml
volumes:
  db-data:
    x-loadweaver: { size: 20g, replicas: 2, crossSite: async }
```

- `replicas`: copies in the workload's site, written synchronously.
- `crossSite`: `async` (default) keeps a copy in another site that may lag slightly, `sync` waits for it, `none` keeps all copies in one site (shown as a pin).
- Volumes are **always encrypted**. Each volume has its own key in the secrets system; only nodes holding a copy receive it, and only in memory.
- Deleting a deployment never deletes its volumes. Removing data is a separate, explicit action.

When a stateful workload moves, the primary moves with it (short stop). When a node drains, its volume copies are rebuilt elsewhere before it may leave.
