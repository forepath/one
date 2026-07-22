# Operator Runbook

Actionable install and day-2 checklists for operators who deploy Agenstra. Use this after reading **[System Requirements](./system-requirements.md)** (capacity baselines) and before or alongside the **[Production Checklist](./production-checklist.md)** (full go-live hardening). Security disclosure and artifact obligations live under **[Vulnerability reporting and artifacts](../security/vulnerability-reporting-and-artifacts.md)**.

## When to use this runbook

| Situation                              | Start here                                                              |
| -------------------------------------- | ----------------------------------------------------------------------- |
| First install or capacity upgrade      | [Install capacity checklist](#install-capacity-checklist)               |
| Bring-up of a new environment          | [Install verification checklist](#install-verification-checklist)       |
| Ongoing operations                     | [Day-2 operations checklist](#day-2-operations-checklist)               |
| Security incident or researcher report | [Disclosure and artifact checklist](#disclosure-and-artifact-checklist) |

## Install capacity checklist

Map your intended profile to **[System Requirements](./system-requirements.md)** before provisioning hosts. Do not start production agents on undersized manager hosts.

### Platform

- [ ] Host OS is Linux **amd64** or **arm64** (prefer amd64 for busy manager hosts)
- [ ] Docker **20.10+** (recommended **24+**) and Compose **2.0+** on manager hosts
- [ ] Node.js **24.14.1** only if running local Nx (containers already pin this version)
- [ ] Manager host has Docker socket access; permissions restricted per [Container image security](../security/container-images.md)
- [ ] Host path **`/opt/agents`** exists and is writable by UID **10001** (or entrypoint `chown` after bind mount)

### Controller stack

- [ ] PostgreSQL (pgvector) sized for profile (local ≥2 GiB / production small ≥4 GiB RAM; disk per [System Requirements](./system-requirements.md#postgresql-pgvector))
- [ ] Redis 7 sized for BullMQ history (production ≥1–2 GiB)
- [ ] API, worker, and scheduler roles split for production (`QUEUE_ROLE`); **one** scheduler per Redis key prefix
- [ ] Worker concurrency (`QUEUE_WORKER_CONCURRENCY`) aligned with CPU and embedding provider rate limits
- [ ] Container memory limits set on API (2–4 GiB), worker (4–8 GiB production), scheduler (≤1 GiB)

### Manager host and agents

- [ ] Manager API + Postgres capacity reserved separately from agent workloads
- [ ] Per concurrent agent (worker + VNC): plan ~4 vCPU and 4–8 GiB plus disk under `/opt/agents/{uuid}`
- [ ] Host totals match expected concurrent agents (see manager host totals table in system requirements)
- [ ] Image **`DOCKER_GID`** matches host `docker` group GID at build time
- [ ] Manager **API, worker, VNC, SSH, and AGI** images planned on the **same release tag**

### Frontend and network

- [ ] Console host sized (≥0.5 vCPU, 512 MiB–1 GiB)
- [ ] Ingress plan covers console (**4200**), controller API (**3100**) / WS (**8081**), manager API (**3000**) / WS (**8080**)
- [ ] Bull Board (`/admin/queues` on controller **3100**) restricted to operations networks
- [ ] Outbound HTTPS available for provider and proxied agent traffic

## Install verification checklist

Run after Compose or orchestrated bring-up. Prefer staging before production.

### Bring-up order

- [ ] Controller Postgres and Redis healthy
- [ ] Controller API healthy (migrations applied); then worker and scheduler
- [ ] Manager Postgres and API healthy; Docker socket usable from manager
- [ ] Agent console reachable over intended URL (HTTPS in production)
- [ ] Controller can reach manager API for at least one workspace

### Smoke checks

- [ ] Create or open a client/workspace and spawn one agent worker (no VNC if capacity is tight)
- [ ] Confirm agent workspace path under `/opt/agents` is writable
- [ ] Confirm WebSocket namespaces used by the console stay connected under normal load
- [ ] Confirm BullMQ jobs appear for controller background work when triggered
- [ ] Confirm health endpoints and centralized logs receive traffic from all roles

### Security baseline (minimum)

- [ ] No default database or API credentials left in production
- [ ] `NODE_ENV=production`, CORS origins, and rate limiting set
- [ ] `ENCRYPTION_KEY` and `CLIENT_ENDPOINT_ALLOWED_HOSTS` set for agent-controller in production
- [ ] HTTPS/WSS terminated for browser and API traffic
- [ ] Full go-live items completed via **[Production Checklist](./production-checklist.md)**

## Day-2 operations checklist

### Capacity and queues

- [ ] Monitor controller worker CPU/memory during embedding reindex and import batches
- [ ] Watch Redis memory growth from retained BullMQ history; trim or expand as needed
- [ ] Monitor manager host Docker stats; stop idle agents to reclaim memory
- [ ] Revisit host sizing when concurrent agent count or knowledge corpus grows
- [ ] Keep `QUEUE_WORKER_CONCURRENCY` within embedding/provider rate limits

### Reliability

- [ ] Automated Postgres backups configured and restore tested for controller and manager databases
- [ ] Alert on API/manager health failures, elevated queue failure rates, and disk pressure on `/opt/agents`
- [ ] Upgrade manager image family together on the same release tag
- [ ] Document and practice rollback to previous image tags

### Logging and access

- [ ] Centralize structured logs; retain correlation IDs across controller and manager
- [ ] Restrict Bull Board and Docker socket access to operators only
- [ ] Do not log API keys, tokens, or unnecessary PII

## Disclosure and artifact checklist

Operators who redistribute or operate Agenstra should keep disclosure and supply-chain hygiene aligned with **[Vulnerability reporting and artifacts](../security/vulnerability-reporting-and-artifacts.md)** and root **`SECURITY.md`**.

### Supported versions

- [ ] Deploy only **supported 2.x.x** lines for security updates
- [ ] If you market a product with digital elements in the EU, define **your** support-period end date (month/year) using upstream 2.x practice as input — do not invent unsupported lines as “supported”

### Receiving reports (if you are the operator of record)

- [ ] Route security reports to **soc@forepath.io** (or your contracted security mailbox if you maintain a fork/product skin)
- [ ] Do **not** ask reporters to open public GitHub issues for vulnerabilities
- [ ] Acknowledge within **48 hours**; use severity targets (Critical 24h / High 48h / Medium 1 week / Low 2 weeks after acknowledgment)
- [ ] Reject mass-scanner and unverified AI-generated reports without treating them as valid findings
- [ ] Coordinate disclosure before publishing details; there is **no official bug bounty**

### Artifacts and integrity

- [ ] Record the deployed release version and retain matching CycloneDX SBOMs (`releases/<version>/sboms/`)
- [ ] For desktop console artifacts, verify **`SHA256SUMS`** / `integrity-manifest.json` before distribution (`sha256sum -c SHA256SUMS`)
- [ ] Track accepted residual risks in **[Accepted risks](../security/accepted-risks.md)** on your review cadence
- [ ] Prefer images and packages that passed PR Trivy gates; document any `.trivyignore` exceptions you inherit

## Related documentation

- **[System Requirements](./system-requirements.md)** — Capacity baselines by role
- **[Production Checklist](./production-checklist.md)** — Full production hardening
- **[Docker Deployment](./docker-deployment.md)** — Compose layout and socket mounts
- **[Environment Configuration](./environment-configuration.md)** — Variables that affect load and security
- **[Vulnerability reporting and artifacts](../security/vulnerability-reporting-and-artifacts.md)** — Disclosure, SBOM, desktop integrity
- **[Operational hardening](../security/operational-hardening.md)** — Implemented controls

---

_Tune limits from observed CPU, memory, Docker stats, and queue depth after go-live._
