# Operator Runbook

Actionable install and day-2 checklists for operators who deploy Decabill. Use this after reading **[System Requirements](./system-requirements.md)** (capacity baselines) and before or alongside the **[Production Checklist](./production-checklist.md)** (full go-live hardening). Security disclosure and artifact obligations live under **[Vulnerability reporting and artifacts](../security/vulnerability-reporting-and-artifacts.md)**.

## When to use this runbook

| Situation                              | Start here                                                              |
| -------------------------------------- | ----------------------------------------------------------------------- |
| First install or capacity upgrade      | [Install capacity checklist](#install-capacity-checklist)               |
| Bring-up of a new environment          | [Install verification checklist](#install-verification-checklist)       |
| Ongoing operations                     | [Day-2 operations checklist](#day-2-operations-checklist)               |
| Security incident or researcher report | [Disclosure and artifact checklist](#disclosure-and-artifact-checklist) |

## Install capacity checklist

Map your intended profile to **[System Requirements](./system-requirements.md)** before provisioning hosts. Do not run production PDF/provisioning load on a single undersized combined host.

### Platform

- [ ] Host OS is Linux **amd64** or **arm64** with a current kernel (LTS preferred for production)
- [ ] Docker **20.10+** (recommended **24+**) and Compose **2.0+**
- [ ] Node.js **24.14.1** only if running local Nx (containers already pin this version)
- [ ] Images planned as non-root `agenstra` (UID **10001**) for API/worker and `node` (UID **1000**) for frontends

### Data services

- [ ] PostgreSQL 16 sized for profile (production small ≥2–4 GiB RAM / 50 GiB disk; medium per system requirements)
- [ ] Redis 7 sized for BullMQ history (production ≥1–2 GiB); AOF or RDB recovery plan agreed
- [ ] Disk growth planned for invoice metadata, audit tables, PDF volume, and DATEV exports when enabled

### Billing manager roles

- [ ] Production uses split **`QUEUE_ROLE`**: `api`, `worker`, and **one** `scheduler` per Redis key prefix
- [ ] API memory limit ≥2–4 GiB (PDF path can briefly need **4 GiB**)
- [ ] Worker memory limit ≥4 GiB for heavy PDF/provisioning batches; concurrency tuned to CPU and Stripe/cloud rate limits
- [ ] Scheduler kept lightweight (≤1 GiB); never run multiple schedulers against the same Redis prefix
- [ ] Invoice PDF and DATEV export volumes mounted on **api, worker, and scheduler** when those features are enabled

### Frontend and network

- [ ] Billing console sized (≥0.5 vCPU, 512 MiB–1 GiB)
- [ ] Ingress plan covers console (**4500**), API (**3200**), and WebSocket (**8082**)
- [ ] Bull Board (`/admin/queues`) restricted to operations networks
- [ ] Production SMTP replaces Mailhog; outbound HTTPS available for Stripe and cloud providers

## Install verification checklist

Run after Compose or orchestrated bring-up. Prefer staging with production-like `TENANTS` before cutover.

### Bring-up order

- [ ] PostgreSQL and Redis healthy and reachable from all queue roles
- [ ] API container healthy (`/api/health`) with migrations applied **before** workers start
- [ ] Scheduler and worker containers started with matching `REDIS_KEY_PREFIX`
- [ ] Billing console reachable over intended URL (HTTPS in production)
- [ ] Stripe webhook endpoint registered for the production API URL when payments are enabled

### Smoke checks

- [ ] Create a test subscription and invoice in a staging tenant
- [ ] Confirm coordinator jobs appear in Bull Board
- [ ] Confirm invoice PDF generation succeeds under worker concurrency you intend to run
- [ ] Confirm WebSocket dashboard connections remain stable under normal load
- [ ] Confirm health endpoints and centralized logs receive traffic from api, worker, and scheduler

### Security baseline (minimum)

- [ ] No default database, Redis, or Bull Board credentials in production
- [ ] `NODE_ENV=production`, CORS origins, rate limiting, and `ENCRYPTION_KEY` set
- [ ] `TENANTS` / `TENANTS_ALLOW_DEFAULT` / `STATIC_API_KEY_TENANT_ID` reviewed for multi-tenant scope
- [ ] Stripe keys and webhook secret use production mode values
- [ ] Full go-live items completed via **[Production Checklist](./production-checklist.md)**

## Day-2 operations checklist

### Capacity and queues

- [ ] Monitor API and worker CPU/memory during invoice PDF batches and provisioning windows
- [ ] Watch Redis memory growth from retained BullMQ jobs (jobs are **not** auto-removed)
- [ ] Scale **worker replicas** horizontally before raising concurrency beyond CPU/rate limits
- [ ] Revisit Postgres disk and PDF/DATEV volume sizes against retention policy
- [ ] Alert on elevated job failure rates and Stripe webhook processing errors

### Reliability

- [ ] Automated Postgres backups configured and restore tested (include tenant-scoped verification)
- [ ] Invoice PDF and DATEV export volumes backed up per legal/tax retention
- [ ] Keep previous image tags available; practice rollback on staging (billing migrations may be forward-only)
- [ ] Replace or rotate SMTP, Stripe, and cloud credentials on a defined schedule

### Logging and access

- [ ] Centralize structured logs from all queue roles; correlate with `X-Correlation-Id` / `X-Request-Id`
- [ ] Restrict Bull Board and Redis/Postgres network access to application and ops subnets
- [ ] Do not log Stripe secrets, API keys, or full PII

## Disclosure and artifact checklist

Operators who redistribute or operate Decabill should keep disclosure and supply-chain hygiene aligned with **[Vulnerability reporting and artifacts](../security/vulnerability-reporting-and-artifacts.md)** and root **`SECURITY.md`**.

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

- [ ] Record the deployed release version and retain matching CycloneDX SBOMs (`releases/<version>/sboms/`, `decabill-*.cdx.json`)
- [ ] Prefer downloads from **[downloads.decabill.com](https://downloads.decabill.com/)** or your signed distribution channel
- [ ] Track accepted residual risks in **[Accepted risks](../security/accepted-risks.md)** on your review cadence
- [ ] Prefer images and packages that passed PR Trivy gates; document any `.trivyignore` exceptions you inherit

## Related documentation

- **[System Requirements](./system-requirements.md)** — Capacity baselines by role
- **[Production Checklist](./production-checklist.md)** — Full production hardening
- **[Docker Deployment](./docker-deployment.md)** — Compose layout and volumes
- **[Background Jobs](./background-jobs.md)** — Queue roles and startup order
- **[Environment Configuration](./environment-configuration.md)** — Variables that affect load and security
- **[Vulnerability reporting and artifacts](../security/vulnerability-reporting-and-artifacts.md)** — Disclosure and SBOM
- **[Operational hardening](../security/operational-hardening.md)** — Implemented controls

---

_Tune limits from observed CPU, memory, and queue depth after go-live._
