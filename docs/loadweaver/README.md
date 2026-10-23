# Loadweaver Documentation

**Loadweaver** turns a handful of servers into a resilient multi-site cluster: an encrypted network between your sites, shared storage on every node and ingress that fails over on its own. A single node is already a complete cluster; clusters grow to around 1,000 nodes across many sites.

## Documentation Structure

### [Getting Started](./getting-started.md)

Create a cluster on one server, add nodes, write your first policy.

### [Architecture](./architecture/README.md)

- [Overview](./architecture/README.md) Control plane, node agents, the policy compiler and how desired state reaches every node

### [Features](./features/README.md)

- [Nodes and joining](./features/nodes-and-joining.md) Join tokens, the one-line installer, control-plane growth, cordon / drain / leave
- [Importing Docker hosts and former nodes](./features/import.md) Read-only discovery (`--discover`), the import wizard, one join plan with rsync pre-copy / final pass and port handover, former-node rejoin
- [Groups and policies](./features/groups-and-policies.md) Node and workload groups, allow-only policies and what they compile to
- [Plan and apply](./features/plan-and-apply.md) Declarative YAML, plans, locks, tracked applies, rollback, drift
- [GitOps](./features/gitops.md) Configuration in Git per scope: sync, commit statuses, secret scanning, SOPS, pull requests or commit-back, export, memberships
- [Plan bot](./features/plan-bot.md) GitHub App and GitLab: pull requests planned with locks and one sticky comment, `loadweaver apply` / `plan` / `approve` / `unlock` / `drift`, merge after apply, account linking
- [Projects and access](./features/projects-and-access.md) Cluster and project roles, approvals, cross-project policies, quotas, access as YAML
- [Deployments and jobs](./features/deployments-and-jobs.md) Compose deployments, migration, drain and failover, one-off and cron jobs
- [Autoscaling](./features/autoscaling.md) Horizontal autoscaling on CPU, memory, requests or custom metrics, within quota, capacity and the N+1 reserve
- [Migration](./features/migration.md) Live migration with CRIU / gVisor, eligibility per service, phases, automatic fallback, kept addresses, history
- [Backups](./features/backups.md) Volume backups with Kopia (schedules, retention, hooks, restore tests), recovery kit and backup key, external targets with object lock, deletion with a second admin and delay, catalog / diff / file restore, restores as plans; control-plane data with PITR, cut-over and an encrypted external copy
- [Disaster recovery](./features/disaster-recovery.md) Whole-cluster restore on a fresh node (`loadweaver-agent bootstrap --restore`): what to prepare, the phases, manual steps
- [Updates](./features/updates.md) Signed release bundles, update plans, rollout with health gates and rollback, maintenance windows, OS / kernel rolling upgrades, agent self-update
- [Volumes](./features/volumes.md) Replicated, always encrypted volumes
- [Secrets and encryption](./features/secrets-and-encryption.md) Envelope-encrypted secrets, the master key, external KMS / Vault
- [Built-in registry](./features/built-in-registry.md) Pull-through cache, private images, the object store
- [Ingress](./features/ingress.md) Hostnames and port forwards, ACME and uploaded certificates, rate limits, WAF
- [Public addresses](./features/public-addresses.md) IP pools, VRRP / BGP / provider failover, egress from own prefixes, reverse DNS
- [DNS](./features/dns.md) Records as desired state, Cloudflare, hosted bind9, AXFR secondaries, DNSSEC
- [DNS failover](./features/dns-failover.md) Probes with quorum, fail-back, weighted / geo / latency steering
- [External BGP](./features/external-bgp.md) Own ASN and prefixes, peers, announcements, RPKI, graceful shutdown
- [Service mesh](./features/service-mesh.md) East-west traffic through the node proxies, mTLS with workload identities, L7 rules
- [Egress filtering](./features/egress-filtering.md) Hostname allow / deny lists for web egress, monitor / enforce / offline
- [Image policies](./features/image-policies.md) cosign signatures, Trivy vulnerability scans, enforcement at plan and on the node
- [Remote access](./features/remote-access.md) WireGuard for people, machines and offices, split tunnel and DNS, posture
- [Device posture](./features/device-posture.md) MDM / EDR integrations, device certificates, posture conditions and restricted groups
- [Terminals, files and tunnels](./features/terminals-files-and-tunnels.md) Terminals in replicas and node shells with recording, the file browser API over containers and volumes, debug tunnels
- [Logs](./features/logs.md) Container, platform, firewall, tunnel and BGP logs, labelled and access-scoped, query / live tail / export, retention
- [Metrics](./features/metrics.md) Node, replica, network, WireGuard and ingress metrics every 10 s, flows per policy edge, roll-ups, TimescaleDB or plain Postgres
- [Alerting](./features/alerting.md) Built-in alerts and `AlertRule` policies, pending / firing / resolved, silences, acknowledgement, escalation, webhooks and email
- [Audit log](./features/audit-log.md) Hash-chained, append-only record of every change
- [Audit and export](./features/audit-and-export.md) Audit search and export, chain anchoring, SIEM forwarding (syslog / OTLP / webhook), Prometheus and OpenTelemetry, CSV exports
- [Dashboards](./features/dashboards.md) `Dashboard` resources with widgets on a 12-column grid, the query builder, Grafana data source
- [Overview and health](./features/overview-and-health.md) Explained health tree with roll-up rules and history, overview headline, needs-attention inbox and summary
- [Topology map](./features/topology-map.md) Sites, nodes, replicas, groups and policy edges, tunnels, volumes, hostnames and addresses; live and historical flows, plan overlay, path trace
- [SLOs and status pages](./features/slos-and-status-pages.md) Availability and latency SLOs at the ingress, error budget and burn rate, public `StatusPage`s and incident notes
- [Search and wallboard](./features/search-and-wallboard.md) Global search with favourites and command palette, read-only wallboard tokens for the kiosk view
- [Periodic reports](./features/periodic-reports.md) Monthly cluster and project reports (HTML / JSON) in the object store, file tree, downloads and ZIP archives
- [Usage metering](./features/usage-metering.md) Hourly CPU, memory, storage, traffic and public-IP usage per project, CSV export, billing through Decabill's usage meters
- [Fleet service](./features/fleet.md) Multi-cluster console backend: encrypted cluster connections, per-cluster / per-project grants, REST and socket relay with on-behalf-of audit, fleet cards / inbox / world map / comparison, cross-cluster restore and cloning, Loadweaver Cloud final backup and read-only grace

### [Guides](./guides/README.md)

- [Agenstra on Loadweaver](./guides/agenstra-on-loadweaver.md) Agenstra's agent manager as a Loadweaver deployment, environments as sandboxed deployments with egress compiled from Agenstra's policy, or on the node's Docker as delegated containers
- [Terraform](./guides/terraform.md) The `forepath/loadweaver` provider: dry-run Loadweaver plans on `terraform plan`, applied plans (with approvals) on `terraform apply`, resources, data sources and import

### [Console](./console.md)

The web console next to each control plane: runtime configuration, authentication, views per role, command palette, resource editor, kiosk

### [CLI](./cli.md)

`loadweaver` login (token or email + password + 2FA), plan / apply / watch, port-forward, VPN enrollment

### [Deployment](./deployment/README.md)

- [Host requirements](./deployment/host-requirements.md) Supported systems, ports, kernel features
- [Fleet service](./features/fleet.md#deployment) The multi-cluster backend next to your clusters: own database, encryption key, endpoint allowlist, limits

## API

- REST: [openapi.yaml](/spec/control-plane/openapi.yaml) (source: `libs/domains/loadweaver/backend/feature-control-plane/spec/openapi.yaml`)
- WebSocket (Socket.IO, plans, logs, terminals and tunnels): [asyncapi.yaml](/spec/control-plane/asyncapi.yaml) (source: `libs/domains/loadweaver/backend/feature-control-plane/spec/asyncapi.yaml`)
- Fleet service REST: [openapi.yaml](/spec/fleet/openapi.yaml), socket relay: [asyncapi.yaml](/spec/fleet/asyncapi.yaml) (source: `libs/domains/loadweaver/backend/feature-fleet/spec/`)
- Node agent stream (gRPC): `libs/domains/loadweaver/shared/util-agent-protocol/proto/agent.proto`
- JSON Schemas of every resource kind: `GET /api/schemas/{kind}`
